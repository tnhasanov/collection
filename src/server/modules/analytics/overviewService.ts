import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { BAKU_ZONE, fromDbDate } from "@/server/dates";
import { dec, money } from "@/server/money";
import { segmentForDpd, SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import type { DecisionSegment } from "@/generated/prisma/enums";

/** Every KPI is derived from persisted rows; exposure is counted once per customer. */
export async function overviewMetrics(db: Db, now: Date) {
  const start = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const end = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).endOf("day").toJSDate();
  const loans = await db.loan.findMany({ where: { status: "ACTIVE" }, select: { customerId: true, totalOverdue: true, principalOutstanding: true, dpd: true } });
  const byCustomer = new Map<string, { overdue: ReturnType<typeof dec>; principal: ReturnType<typeof dec>; maxDpd: number; loans: number }>();
  for (const l of loans) {
    const cur = byCustomer.get(l.customerId) ?? { overdue: dec(0), principal: dec(0), maxDpd: 0, loans: 0 };
    cur.overdue = cur.overdue.plus(l.totalOverdue);
    cur.principal = cur.principal.plus(l.principalOutstanding);
    cur.maxDpd = Math.max(cur.maxDpd, l.dpd);
    cur.loans += 1;
    byCustomer.set(l.customerId, cur);
  }
  const overdueCustomers = [...byCustomer.values()].filter((c) => c.overdue.greaterThan(0));
  const overdueAmount = overdueCustomers.reduce((s, c) => s.plus(c.overdue), dec(0));
  const overduePrincipal = overdueCustomers.reduce((s, c) => s.plus(c.principal), dec(0));
  const overdueLoanAccounts = loans.filter((l) => dec(l.totalOverdue).greaterThan(0)).length;
  const callable = await db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE" } });
  const payments = await db.payment.findMany({ where: { eventAt: { gte: start, lte: end }, status: { in: ["POSTED", "REVERSED"] } }, select: { amount: true, status: true, reversalOfId: true } });
  const receivedToday = payments.reduce((s, p) => (p.status === "POSTED" ? s.plus(p.amount) : p.reversalOfId ? s.plus(p.amount) : s), dec(0));
  const ptpDueToday = await db.promise.count({ where: { deadline: { gte: start, lte: end }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } });
  const dist: Record<DecisionSegment, { customers: number; exposure: string }> = Object.fromEntries((Object.keys(SEGMENT_LABELS) as DecisionSegment[]).map((k) => [k, { customers: 0, exposure: "0.00" }])) as never;
  for (const c of overdueCustomers) {
    const seg = segmentForDpd(c.maxDpd);
    dist[seg].customers += 1;
    dist[seg].exposure = money(dec(dist[seg].exposure).plus(c.principal)).toFixed(2);
  }
  const [criticalExceptions, brokenPromises, staleFeeds, unresolvedWrapUps, decisionRun, topPriority] = await Promise.all([
    db.exceptionCase.count({ where: { status: { in: ["OPEN", "ASSIGNED", "REOPENED"] }, severity: "CRITICAL" } }),
    db.promise.findMany({ where: { status: "BROKEN" }, include: { customer: { select: { displayName: true } } }, orderBy: { maturedAt: "desc" }, take: 5 }),
    db.sourceWatermark.findMany({ where: { health: { in: ["STALE", "DEGRADED"] } } }),
    db.interaction.count({ where: { OR: [{ status: "DRAFT" }, { wrapUpStatus: "FAILED" }] } }),
    db.decisionRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.decisionSnapshot.findMany({ where: { isCurrent: true, rank: { not: null } }, orderBy: { rank: "asc" }, take: 8, include: { customer: { select: { displayName: true } }, workItems: { where: { status: { in: ["ELIGIBLE", "DEFERRED", "QUEUED", "CLAIMED", "IN_PROGRESS"] } }, include: { owner: { select: { displayName: true } } } } } }),
  ]);
  const capacity = await db.setting.findUnique({ where: { key: "capacity.planning" } });
  const cap = (capacity?.value ?? {}) as { agents?: number; successfulContactsPerAgentDay?: number };
  const attemptsToday = await db.dialAttempt.count({ where: { startedAt: { gte: start, lte: end } } });
  const rpcToday = await db.interaction.count({ where: { startedAt: { gte: start, lte: end }, isRpc: true } });
  const sessions = await db.agentSession.findMany({ where: { isActive: true } });
  return {
    businessDate: DateTime.fromJSDate(now, { zone: BAKU_ZONE }).toISODate(),
    kpis: {
      overdueCustomers: overdueCustomers.length,
      overdueLoanAccounts,
      overdueAmount: money(overdueAmount).toFixed(2),
      overduePrincipal: money(overduePrincipal).toFixed(2),
      callableNow: callable,
      receivedToday: money(receivedToday).toFixed(2),
      ptpDueToday,
    },
    distribution: (Object.keys(dist) as DecisionSegment[]).filter((k) => k !== "DPD_0").map((k) => ({ segment: k, label: SEGMENT_LABELS[k], ...dist[k] })),
    execution: {
      attemptsToday,
      rpcToday,
      agentsOnline: sessions.filter((s) => s.confirmedState !== "OFFLINE").length,
      planningReference: (cap.agents ?? 6) * (cap.successfulContactsPerAgentDay ?? 80),
      criticalExceptions,
      unresolvedWrapUps,
      staleFeeds: staleFeeds.map((s) => s.displayName),
      decisionRun: decisionRun ? { id: decisionRun.id, businessDate: fromDbDate(decisionRun.businessDate), finishedAt: decisionRun.finishedAt, population: decisionRun.populationCount, scored: decisionRun.scoredCount } : null,
    },
    topPriority: topPriority.map((d) => ({ customerId: d.customerId, name: d.customer.displayName, dpd: d.decisionDpd, overdue: d.totalOverdue.toString(), era: d.era?.toString() ?? null, bucket: d.actionBucket, action: d.effectiveAction, rank: d.rank, status: d.workItems[0]?.status ?? null, reasons: d.workItems[0]?.deferredReasons ?? [], owner: d.workItems[0]?.owner?.displayName ?? null })),
    brokenPromises: brokenPromises.map((p) => ({ id: p.id, customerId: p.customerId, name: p.customer.displayName, amount: p.amount.toString(), deadline: fromDbDate(p.deadlineDate) })),
  };
}
