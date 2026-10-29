import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { BAKU_ZONE } from "@/server/dates";
import { dec, money } from "@/server/money";
import { getOutboundControls } from "@/server/modules/settings/settingsService";
import { attributedCashByAgent } from "@/server/modules/payments/attribution";
import { APPROVAL_TYPE_LABELS } from "@/server/modules/approvals/approvalService";
import { hasPermission } from "@/server/auth/permissions";

/**
 * Role home pages (lead / head). Everything here is a pointer into an existing screen: decisions waiting for the
 * viewer (promise-date exceptions, deceased verifications, stuck calls, failed wrap-ups), the team right now,
 * today's results from the same metric definitions as the agent dashboard, and portfolio totals for the head.
 */
export async function homeSummary(db: Db, user: SessionUser, now: Date) {
  const start = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const [sessions, pendingWrapUp, failedWrapUps, overdueCallbacks, eligibleBacklog, ptpExceptions, deceased, stuckCalls, approvalsByType, attempts, rpc, promises, controls, overdueCustomers, overdueAmount, receivedToday, ptpDueToday, criticalExceptions] = await Promise.all([
    db.agentSession.findMany({ where: { isActive: true }, select: { confirmedState: true } }),
    db.interaction.count({ where: { OR: [{ status: "DRAFT" }, { wrapUpStatus: "PENDING" }] } }),
    db.interaction.count({ where: { wrapUpStatus: "FAILED" } }),
    db.workItem.count({ where: { type: "CALLBACK", status: { in: ["ELIGIBLE", "DEFERRED"] }, dueAt: { lt: new Date(now.getTime() - 15 * 60_000) } } }),
    db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE" } }),
    db.approvalRequest.findMany({ where: { type: "PTP_EXCEPTION", status: { in: ["PENDING", "INFO_REQUESTED"] } }, include: { maker: { select: { displayName: true } } }, orderBy: { createdAt: "asc" }, take: 10 }),
    db.exceptionCase.findMany({ where: { type: "DECEASED_VERIFICATION", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, include: { customer: { select: { displayName: true } } }, orderBy: { firstSeenAt: "asc" }, take: 10 }),
    db.exceptionCase.findMany({ where: { type: { in: ["CALL_CONTROL_FAILURE", "CALL_STATE_UNKNOWN", "PROVIDER_WRAPUP_FAILURE"] }, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, include: { customer: { select: { displayName: true } } }, orderBy: { lastSeenAt: "desc" }, take: 10 }),
    db.approvalRequest.groupBy({ by: ["type"], where: { status: { in: ["PENDING", "INFO_REQUESTED"] } }, _count: { _all: true } }),
    db.dialAttempt.count({ where: { startedAt: { gte: start } } }),
    db.interaction.count({ where: { isRpc: true, startedAt: { gte: start }, status: { in: ["SAVED", "CORRECTED"] } } }),
    db.promise.count({ where: { createdAt: { gte: start } } }),
    getOutboundControls(db),
    db.collectionCase.count({ where: { status: { in: ["OPEN", "HANDOVER"] } } }),
    db.loan.aggregate({ where: { status: "ACTIVE", totalOverdue: { gt: 0 } }, _sum: { totalOverdue: true } }),
    db.payment.aggregate({ where: { status: "POSTED", eventAt: { gte: start } }, _sum: { amount: true } }),
    db.promise.count({ where: { deadline: { gte: start, lte: DateTime.fromJSDate(now, { zone: BAKU_ZONE }).endOf("day").toJSDate() }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } }),
    db.exceptionCase.count({ where: { severity: "CRITICAL", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } } }),
  ]);
  const cash = await attributedCashByAgent(db, { from: now, to: now });
  let cashTotal = dec(0);
  for (const [, v] of cash) cashTotal = cashTotal.plus(v);
  const byState = (s: string) => sessions.filter((x) => x.confirmedState === s).length;
  return {
    role: user.role,
    decisions: {
      ptpExceptions: ptpExceptions.map((a) => ({ id: a.id, title: a.title, maker: a.maker.displayName, createdAt: a.createdAt, status: a.status, canDecide: hasPermission(user.role, "ptp-exception.decide") && a.makerUserId !== user.id })),
      deceased: deceased.map((e) => ({ id: e.id, title: e.title, customerId: e.customerId, customerName: e.customer?.displayName ?? e.customerId, slaDueAt: e.slaDueAt, supportCaseId: (e.evidence as { supportCaseId?: string } | null)?.supportCaseId ?? null })),
      stuckCalls: stuckCalls.map((e) => ({ id: e.id, type: e.type, title: e.title, customerId: e.customerId, customerName: e.customer?.displayName ?? e.customerId, lastSeenAt: e.lastSeenAt })),
      failedWrapUps,
    },
    team: { signedIn: sessions.filter((s) => s.confirmedState !== "OFFLINE").length, ready: byState("READY"), talking: byState("TALKING"), acw: byState("ACW"), notReady: byState("NOT_READY") + byState("BREAK"), pendingWrapUp, overdueCallbacks, eligibleBacklog, criticalExceptions },
    today: { attempts, rpc, promises, attributedCash: money(cashTotal).toFixed(2), attributionRule: "ATTRIB-1" },
    portfolio: { overdueCustomers, overdueAmount: money(dec(overdueAmount._sum.totalOverdue?.toString() ?? "0")).toFixed(2), receivedToday: money(dec(receivedToday._sum.amount?.toString() ?? "0")).toFixed(2), ptpDueToday },
    approvals: approvalsByType.map((a) => ({ type: a.type, label: APPROVAL_TYPE_LABELS[a.type], count: a._count._all })),
    controls,
  };
}
