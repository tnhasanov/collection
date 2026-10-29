import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { byCustomerWhere, customerScope, scopeIsUnscoped, type CustomerScope } from "@/server/auth/scope";
import { fromDbDate } from "@/server/dates";
import { now as domainNow } from "@/server/clock";

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
export async function listWorkQueue(db: Db, user: SessionUser, f: QueueFilters, scope?: CustomerScope) {
  scope ??= await customerScope(db, user, await domainNow());
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

  const [total, rows] = await Promise.all([
    db.workItem.count({ where }),
    db.workItem.findMany({
      where,
      include: { customer: { include: { loans: { select: { dpd: true, totalOverdue: true, status: true, oldestUnpaidDueDate: true } } } }, decisionSnapshot: true, owner: { select: { displayName: true } }, claimedBy: { select: { displayName: true } }, interactions: { orderBy: { startedAt: "desc" }, take: 1 } },
      orderBy: [{ status: "asc" }, { rank: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { dueAt: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  const promises = await db.promise.findMany({ where: { customerId: { in: rows.map((r) => r.customerId) }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION", "BROKEN"] } }, select: { customerId: true, status: true, amount: true, deadlineDate: true } });
  const lastOutcome = await db.interaction.findMany({ where: { customerId: { in: rows.map((r) => r.customerId) }, status: { in: ["SAVED", "CORRECTED"] } }, orderBy: { startedAt: "desc" }, distinct: ["customerId"], select: { customerId: true, businessOutcome: true, technicalResult: true, identityStatus: true, startedAt: true } });
  return {
    total,
    rows: rows.map((r) => {
      const active = r.customer.loans.filter((l) => l.status === "ACTIVE");
      const pr = promises.find((p) => p.customerId === r.customerId);
      const lo = lastOutcome.find((l) => l.customerId === r.customerId);
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        rank: r.rank,
        customerId: r.customerId,
        customerName: r.customer.displayName,
        cif: r.customer.cif,
        language: r.customer.language,
        branch: r.customer.branch,
        loans: active.length,
        maxDpd: active.reduce((m, l) => Math.max(m, l.dpd), 0),
        overdue: active.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2),
        exposure: r.decisionSnapshot?.exposure.toString() ?? null,
        probability: r.decisionSnapshot?.probability?.toString() ?? null,
        probabilitySource: r.decisionSnapshot?.probabilitySource ?? null,
        riskClass: r.decisionSnapshot?.riskClass ?? null,
        era: r.decisionSnapshot?.era?.toString() ?? null,
        bucket: r.decisionSnapshot?.actionBucket ?? null,
        recommended: r.decisionSnapshot?.recommendedAction ?? null,
        effective: r.decisionSnapshot?.effectiveAction ?? null,
        segment: r.decisionSnapshot?.segment ?? null,
        nextEligibleAt: r.nextEligibleAt,
        dueAt: r.dueAt,
        deferredReasons: r.deferredReasons,
        lastOutcome: lo ? `${lo.technicalResult ?? ""} / ${lo.identityStatus ?? ""} / ${lo.businessOutcome ?? ""}`.replace(/^ \/ | \/ $/g, "") : null,
        promise: pr ? { status: pr.status, amount: pr.amount.toString(), deadline: fromDbDate(pr.deadlineDate) } : null,
        owner: r.owner?.displayName ?? r.claimedBy?.displayName ?? null,
        requiredSkill: r.requiredSkill,
        reason: r.reason,
      };
    }),
  };
}

/** Header KPIs use the same scope as the list (aggregates never leak rows the user could not open). */
export async function queueHeader(db: Db, user: SessionUser, scope?: CustomerScope, now?: Date) {
  now ??= await domainNow();
  scope ??= await customerScope(db, user, now);
  const inScope = byCustomerWhere(scope);
  const mine = scopeIsUnscoped(scope) ? {} : { OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }] };
  const [assigned, eligible, callbacksDue, senior, blocked, lastRun, policy, sessions] = await Promise.all([
    db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] }, ...inScope, ...mine } }),
    db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE", ...inScope } }),
    db.workItem.count({ where: { type: "CALLBACK", status: { in: ["ELIGIBLE", "DEFERRED"] }, dueAt: { lte: new Date(now.getTime() + 86_400_000) }, ...inScope } }),
    db.workItem.count({ where: { type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] }, requiredSkill: "SENIOR", ...inScope } }),
    db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: "DEFERRED", ...inScope } }),
    db.decisionRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.contactPolicyVersion.findFirst({ where: { status: "ACTIVE" } }),
    db.agentSession.count({ where: { isActive: true, confirmedState: { in: ["READY", "RESERVED", "DIALING", "TALKING", "ACW"] } } }),
  ]);
  return { assigned, eligible, callbacksDue, senior, blocked, lastRefresh: lastRun?.finishedAt ?? null, policyVersion: policy ? `${policy.code}/${policy.version}` : "n/a", agentsActive: sessions };
}
