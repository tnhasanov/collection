import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import type { Language } from "@/generated/prisma/enums";
import { fromDbDate } from "@/server/dates";
import { customerAggregates } from "@/server/modules/customers/customerListService";
import type { FollowUpItem } from "@/server/modules/agent/followUpService";

/**
 * Data for the agent dashboard beyond the metrics: due work with the customer's overdue amount, the agent's queue
 * context, items that need attention and the last saved outcomes. Read-only; every list is the agent's own work.
 */
export async function agentDashboard(db: Db, user: SessionUser, followUps: FollowUpItem[]) {
  const due = followUps.filter((i) => i.kind !== "FAILED" && (i.due === "OVERDUE" || i.due === "TODAY"));
  const recentRows = await db.interaction.findMany({
    where: { agentUserId: user.id, status: { in: ["SAVED", "CORRECTED"] } },
    orderBy: { savedAt: "desc" },
    take: 5,
    select: { id: true, customerId: true, businessOutcome: true, savedAt: true, startedAt: true, customer: { select: { displayName: true } }, promises: { select: { amount: true, deadlineDate: true }, take: 1 } },
  });
  const callbacks = recentRows.length ? await db.workItem.findMany({ where: { sourceInteractionId: { in: recentRows.map((r) => r.id) }, type: "CALLBACK" }, select: { sourceInteractionId: true, dueAt: true } }) : [];
  const aggregates = await customerAggregates(db, [...new Set([...due.map((d) => d.customerId), ...recentRows.map((r) => r.customerId)])]);
  const languages: Language[] = user.languages.length ? user.languages : ["AZ"];
  const myInteractions = (await db.interaction.findMany({ where: { agentUserId: user.id }, select: { id: true }, orderBy: { startedAt: "desc" }, take: 500 })).map((i) => i.id);
  const [ready, broken, claims, unresolved] = await Promise.all([
    db.workItem.count({
      where: {
        status: "ELIGIBLE",
        type: { in: ["CALL", "CALLBACK"] },
        OR: [{ ownerUserId: null }, { ownerUserId: user.id }],
        AND: [{ OR: [{ language: null }, { language: { in: languages } }] }, ...(user.seniority === "SENIOR" ? [] : [{ OR: [{ requiredSkill: null }, { requiredSkill: { not: "SENIOR" as const } }] }])],
      },
    }),
    db.promise.count({ where: { status: "BROKEN", OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }] } }),
    db.paymentClaim.count({ where: { status: "OPEN", interactionId: { in: myInteractions } } }),
    db.interaction.count({ where: { agentUserId: user.id, OR: [{ status: "DRAFT" }, { wrapUpStatus: { in: ["PENDING", "FAILED"] } }] } }),
  ]);
  return {
    due: due.slice(0, 6).map((i) => ({
      key: i.key,
      kind: i.kind,
      taskType: i.taskType ?? null,
      status: i.status,
      customerId: i.customerId,
      customerName: i.customerName,
      due: i.due,
      at: i.dueAt,
      date: i.dueDate,
      amount: i.kind === "PROMISE" ? i.promise?.remaining ?? null : aggregates.get(i.customerId)?.totalOverdue ?? null,
      eligible: i.eligible,
      blockers: i.blockers.map((b) => b.code),
    })),
    dueTotal: due.length,
    queue: { ready, languages, senior: user.seniority === "SENIOR" },
    attention: { broken, claims, unresolved },
    recent: recentRows.map((r) => {
      const cb = callbacks.find((c) => c.sourceInteractionId === r.id);
      const p = r.promises[0];
      return {
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.displayName,
        outcome: r.businessOutcome,
        amount: p ? p.amount.toFixed(2) : aggregates.get(r.customerId)?.totalOverdue ?? null,
        date: p ? fromDbDate(p.deadlineDate) : cb?.dueAt ? cb.dueAt.toISOString() : null,
        at: r.savedAt ?? r.startedAt,
      };
    }),
  };
}
