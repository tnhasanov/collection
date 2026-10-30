import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { byCustomerWhere, customerScope, scopeIsUnscoped, type CustomerScope } from "@/server/auth/scope";
import { now as domainNow } from "@/server/clock";
import { compareWork, orderWork, workStatusCode } from "@/server/modules/work/nextWork";
import { attachWork, customerAggregates, type CustomerRow } from "@/server/modules/customers/customerListService";

export interface QueueFilters {
  queue: "mine" | "all" | "senior" | "callbacks" | "blocked" | "manual" | "later";
  eligibility?: "ELIGIBLE" | "DEFERRED" | "QUEUED" | "CLAIMED" | "";
  band?: string;
  bucket?: string;
  riskClass?: string;
  language?: string;
  branch?: string;
  page: number;
  pageSize: number;
}

/**
 * Work-queue listing. The caller's customer scope is applied to every view BEFORE pagination, so a scoped agent only
 * sees items for customers they may open (owned/claimed work, live reservations, recent own interactions). Pooled work
 * reaches an agent through dialer allocation or the atomic "Get next customer" claim, never by browsing.
 */
export async function listWorkQueue(db: Db, user: SessionUser, f: QueueFilters, scope?: CustomerScope, at?: Date) {
  const now = at ?? (await domainNow());
  scope ??= await customerScope(db, user, now);
  const where: Prisma.WorkItemWhereInput = { status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] }, ...byCustomerWhere(scope) };
  const voice: Prisma.WorkItemWhereInput = { type: { in: ["CALL", "CALLBACK"] } };
  switch (f.queue) {
    case "mine":
      Object.assign(where, voice, scopeIsUnscoped(scope) ? {} : { OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }] });
      if (user.seniority !== "SENIOR" && !scopeIsUnscoped(scope)) where.requiredSkill = { not: "SENIOR" };
      break;
    case "senior":
      Object.assign(where, voice, { requiredSkill: "SENIOR" });
      break;
    case "callbacks":
      where.type = "CALLBACK";
      break;
    case "blocked":
      Object.assign(where, voice, { status: "DEFERRED" });
      break;
    case "manual":
      where.type = "MANUAL_REVIEW";
      break;
    case "later":
      where.type = { in: ["LATER_STAGE_REVIEW", "HANDOVER"] };
      break;
    default:
      Object.assign(where, voice);
  }
  if (f.eligibility) where.status = f.eligibility;
  if (f.language) where.language = f.language as never;
  if (f.branch) where.customer = { ...(where.customer as object), branch: scope.kind === "BRANCHES" && !scope.branches.includes(f.branch) ? { in: [] } : f.branch };
  if (f.bucket) where.decisionSnapshot = { ...(where.decisionSnapshot as object), actionBucket: Number(f.bucket) };
  if (f.riskClass) where.decisionSnapshot = { ...(where.decisionSnapshot as object), riskClass: Number(f.riskClass) };
  if (f.band) where.decisionSnapshot = { ...(where.decisionSnapshot as object), segment: f.band as never };

  // Group by customer BEFORE paging: every matching work item is read (a few small columns), grouped by the stable
  // customer id, and the customer is placed by its next work item in workflow order (see nextWork.ts). The total is
  // the number of distinct customers; work items themselves stay separate records.
  const matching = await db.workItem.findMany({ where, select: { id: true, customerId: true, type: true, status: true, rank: true, priority: true, dueAt: true, createdAt: true, nextEligibleAt: true, deferredReasons: true } });
  const groups = new Map<string, typeof matching>();
  for (const w of matching) groups.set(w.customerId, [...(groups.get(w.customerId) ?? []), w]);
  const firsts = [...groups.values()].map((items) => orderWork(items, now)[0]).filter(Boolean);
  firsts.sort((a, b) => compareWork(a, b, now) || (a.customerId < b.customerId ? -1 : 1));
  const total = firsts.length;
  const pageItems = firsts.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  const ids = pageItems.map((w) => w.customerId);
  const [customers, aggregates] = await Promise.all([db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, cif: true, branch: true } }), customerAggregates(db, ids)]);
  const base = pageItems.map((w) => {
    const c = customers.find((x) => x.id === w.customerId)!;
    const a = aggregates.get(w.customerId) ?? { loans: 0, totalOverdue: "0.00", maxDpd: 0 };
    return { id: c.id, displayName: c.displayName, cif: c.cif, branch: c.branch, loans: a.loans, totalOverdue: Number(a.totalOverdue).toFixed(2), maxDpd: a.maxDpd };
  });
  const withWork = await attachWork(db, base, now);
  // The displayed next work is the first item that matches this queue view; the open-work count covers all items.
  const rows: CustomerRow[] = withWork.map((r, i) => {
    const w = pageItems[i];
    return { ...r, rank: w.rank, next: { id: w.id, type: w.type, status: w.status, code: workStatusCode(w, now), dueAt: w.dueAt, nextEligibleAt: w.nextEligibleAt, reasons: w.deferredReasons } };
  });
  return { total, rows };
}

/** Header KPIs use the same scope as the list (aggregates never leak rows the user could not open). */
export async function queueHeader(db: Db, user: SessionUser, scope?: CustomerScope, now?: Date) {
  now ??= await domainNow();
  scope ??= await customerScope(db, user, now);
  const inScope = byCustomerWhere(scope);
  const mine = scopeIsUnscoped(scope) ? {} : { OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }] };
  // Counts are distinct customers, matching the one-row-per-customer list.
  const customers = async (where: Prisma.WorkItemWhereInput) => (await db.workItem.findMany({ where, distinct: ["customerId"], select: { customerId: true } })).length;
  const [assigned, eligible, callbacksDue, senior, blocked, lastRun, policy, sessions] = await Promise.all([
    customers({ type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] }, ...inScope, ...mine }),
    customers({ type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE", ...inScope }),
    customers({ type: "CALLBACK", status: { in: ["ELIGIBLE", "DEFERRED"] }, dueAt: { lte: new Date(now.getTime() + 86_400_000) }, ...inScope }),
    customers({ type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] }, requiredSkill: "SENIOR", ...inScope }),
    customers({ type: { in: ["CALL", "CALLBACK"] }, status: "DEFERRED", ...inScope }),
    db.decisionRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.contactPolicyVersion.findFirst({ where: { status: "ACTIVE" } }),
    db.agentSession.count({ where: { isActive: true, confirmedState: { in: ["READY", "RESERVED", "DIALING", "TALKING", "ACW"] } } }),
  ]);
  return { assigned, eligible, callbacksDue, senior, blocked, lastRefresh: lastRun?.finishedAt ?? null, policyVersion: policy ? `${policy.code}/${policy.version}` : "n/a", agentsActive: sessions };
}
