import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { BAKU_ZONE, bakuBusinessDate, fromDbDate } from "@/server/dates";
import { explainWorkItem, parseCallbackReason, type Blocker } from "@/server/modules/work/eligibilityExplain";
import { remindersForPromises } from "@/server/modules/promises/reminderService";

export type FollowUpKind = "CALLBACK" | "PROMISE" | "TASK" | "FAILED";
export type DueBucket = "OVERDUE" | "TODAY" | "LATER" | "NONE";

/**
 * One follow-up row for the agent: what it is, when it is due, and either the next step or the specific blocker that
 * applies now (with the time it ends). Codes only; the page renders them in the agent's language.
 */
export interface FollowUpItem {
  key: string;
  kind: FollowUpKind;
  id: string;
  customerId: string;
  customerName: string;
  due: DueBucket;
  dueAt: Date | null;
  dueDate: string | null;
  status: string;
  /** Next step code (fu.* key) and its values. */
  next: { code: string; vars?: Record<string, string> };
  eligible: boolean | null;
  blockers: Blocker[];
  nextEligibleAt: Date | null;
  openEnded: boolean;
  origin: "CUSTOMER_REQUESTED" | "AGENT_PROPOSED" | null;
  note: string | null;
  taskType?: string;
  technicalResult?: string | null;
  promise?: { amount: string; paid: string; remaining: string; reminder: { status: string; at: Date | null } | null; nextReminderAt: Date | null };
}

const OPEN_ITEM = ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] as const;
const OPEN_PROMISE = ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION", "BROKEN"] as const;
const FAILED_RESULTS = ["NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE"] as const;
const RANK: Record<DueBucket, number> = { OVERDUE: 0, TODAY: 1, LATER: 2, NONE: 3 };

function bucket(at: Date | null, now: Date, todayEnd: Date): DueBucket {
  if (!at) return "NONE";
  if (at.getTime() < now.getTime()) return "OVERDUE";
  return at.getTime() <= todayEnd.getTime() ? "TODAY" : "LATER";
}

function dateBucket(iso: string | null, today: string): DueBucket {
  if (!iso) return "NONE";
  return iso < today ? "OVERDUE" : iso === today ? "TODAY" : "LATER";
}

/** Orders follow-ups so overdue and due-today items come first, then by due time. */
export function sortFollowUps(items: FollowUpItem[]): FollowUpItem[] {
  const time = (i: FollowUpItem) => i.dueAt?.getTime() ?? (i.dueDate ? Date.parse(`${i.dueDate}T00:00:00Z`) : Number.MAX_SAFE_INTEGER);
  return [...items].sort((a, b) => RANK[a.due] - RANK[b.due] || time(a) - time(b));
}

/**
 * Callbacks, promises, tasks and failed contacts of one agent. Voice items are re-evaluated against the contact policy
 * at the current business clock, so what is shown is the restriction that applies now, not one stored at an earlier
 * refresh. Nothing here changes eligibility.
 */
export async function agentFollowUps(db: Db, userId: string, now: Date, opts: { limit?: number } = {}): Promise<FollowUpItem[]> {
  const take = opts.limit ?? 60;
  const today = bakuBusinessDate(now);
  const todayEnd = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).endOf("day").toJSDate();
  const owned = { OR: [{ ownerUserId: userId }, { claimedByUserId: userId }] };
  const [callbacks, promises, tasks, failed] = await Promise.all([
    db.workItem.findMany({ where: { type: "CALLBACK", ...owned, status: { in: [...OPEN_ITEM] } }, include: { customer: { select: { displayName: true } } }, orderBy: { dueAt: "asc" }, take }),
    db.promise.findMany({ where: { OR: [{ ownerUserId: userId }, { createdByUserId: userId }], status: { in: [...OPEN_PROMISE] } }, include: { customer: { select: { displayName: true } } }, orderBy: { deadline: "asc" }, take }),
    db.workItem.findMany({ where: { type: { in: ["PTP_FOLLOWUP", "RECONCILIATION", "DISPUTE_REVIEW", "SUPPORT_REVIEW", "HANDOVER"] }, ...owned, status: { in: [...OPEN_ITEM] } }, include: { customer: { select: { displayName: true } } }, orderBy: { dueAt: "asc" }, take }),
    db.interaction.findMany({ where: { agentUserId: userId, startedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) }, technicalResult: { in: [...FAILED_RESULTS] } }, include: { customer: { select: { displayName: true } }, workItem: true }, orderBy: { startedAt: "desc" }, take }),
  ]);
  const reminders = await remindersForPromises(db, promises.map((p) => p.id));
  const items: FollowUpItem[] = [];

  for (const wi of callbacks) {
    const x = await explainWorkItem(db, wi, now, todayEnd);
    const { origin, text } = parseCallbackReason(wi.reason);
    items.push({
      key: `cb-${wi.id}`,
      kind: "CALLBACK",
      id: wi.id,
      customerId: wi.customerId,
      customerName: wi.customer.displayName,
      due: x.due,
      dueAt: wi.dueAt,
      dueDate: null,
      status: wi.status,
      next: x.eligible ? { code: "fu.eligibleNow" } : { code: "fu.blocked" },
      eligible: x.eligible,
      blockers: x.blockers,
      nextEligibleAt: x.nextEligibleAt,
      openEnded: x.openEnded,
      origin,
      note: text || null,
    });
  }

  for (const p of promises) {
    const deadline = fromDbDate(p.deadlineDate);
    const jobs = reminders.get(p.id) ?? [];
    const last = [...jobs].reverse().find((j) => j.status !== "SCHEDULED") ?? null;
    const nextJob = jobs.find((j) => j.status === "SCHEDULED") ?? null;
    const next: FollowUpItem["next"] =
      p.status === "BROKEN"
        ? { code: "fu.pBroken" }
        : p.status === "PENDING_RECONCILIATION"
          ? { code: "fu.pPending" }
          : p.status === "PARTIALLY_PAID"
            ? { code: "fu.pPartial", vars: { rest: p.remainingAmount.toFixed(2) } }
            : deadline === today
              ? { code: "fu.pDueToday" }
              : deadline && deadline < today
                ? { code: "fu.pPastDue" }
                : { code: "fu.pDue", vars: { date: deadline ?? "" } };
    items.push({
      key: `p-${p.id}`,
      kind: "PROMISE",
      id: p.id,
      customerId: p.customerId,
      customerName: p.customer.displayName,
      due: p.status === "BROKEN" ? "OVERDUE" : dateBucket(deadline, today),
      dueAt: null,
      dueDate: deadline,
      status: p.status,
      next,
      eligible: null,
      blockers: [],
      nextEligibleAt: null,
      openEnded: false,
      origin: null,
      note: null,
      promise: { amount: p.amount.toFixed(2), paid: p.paidAmount.toFixed(2), remaining: p.remainingAmount.toFixed(2), reminder: last ? { status: last.status, at: last.sentAt ?? last.scheduledFor } : null, nextReminderAt: nextJob?.scheduledFor ?? null },
    });
  }

  for (const wi of tasks) {
    items.push({
      key: `t-${wi.id}`,
      kind: "TASK",
      id: wi.id,
      customerId: wi.customerId,
      customerName: wi.customer.displayName,
      due: bucket(wi.dueAt, now, todayEnd),
      dueAt: wi.dueAt,
      dueDate: null,
      status: wi.status,
      next: { code: "fu.taskOpen" },
      eligible: null,
      blockers: [],
      nextEligibleAt: null,
      openEnded: false,
      origin: null,
      note: wi.reason,
      taskType: wi.type,
    });
  }

  // Failed contacts: the latest failed attempt per customer, with the retry the contact policy allows now.
  const seen = new Set<string>();
  for (const i of failed) {
    if (seen.has(i.customerId)) continue;
    seen.add(i.customerId);
    const wi = i.workItem;
    const open = !!wi && (OPEN_ITEM as readonly string[]).includes(wi.status);
    const x = open ? await explainWorkItem(db, wi, now, todayEnd) : null;
    items.push({
      key: `f-${i.id}`,
      kind: "FAILED",
      id: i.id,
      customerId: i.customerId,
      customerName: i.customer.displayName,
      due: "NONE",
      dueAt: i.startedAt,
      dueDate: null,
      status: wi?.status ?? "COMPLETED",
      next: !x ? { code: "fu.retryPolicy" } : x.eligible ? { code: "fu.retryNow" } : { code: "fu.blocked" },
      eligible: x?.eligible ?? null,
      blockers: x?.blockers ?? [],
      nextEligibleAt: x?.nextEligibleAt ?? null,
      openEnded: x?.openEnded ?? false,
      origin: null,
      note: null,
      technicalResult: i.technicalResult,
    });
  }
  return sortFollowUps(items);
}
