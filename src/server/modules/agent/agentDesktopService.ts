import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { BAKU_ZONE, fromDbDate } from "@/server/dates";
import { dec, money } from "@/server/money";
import { getAgentContext } from "@/server/modules/dialer/agentSessionService";
import { getCustomer360 } from "@/server/modules/customers/customerService";
import { maskNumber } from "@/server/modules/dialer/contract";
import type { SessionUser } from "@/server/auth/session";

/** Today's scoped personal metrics (same definitions as the supervisor view; see METRIC_DICTIONARY.md). */
export async function agentMetrics(db: Db, userId: string, now: Date) {
  const start = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const attempts = await db.dialAttempt.findMany({ where: { reservation: { agentUserId: userId }, startedAt: { gte: start } }, include: { reservation: { select: { customerId: true } } } });
  const interactions = await db.interaction.findMany({ where: { agentUserId: userId, startedAt: { gte: start }, status: { in: ["SAVED", "CORRECTED"] } } });
  const rpc = interactions.filter((i) => i.isRpc).length;
  const promises = await db.promise.findMany({ where: { createdByUserId: userId, createdAt: { gte: start } } });
  const dueToday = await db.promise.count({ where: { ownerUserId: userId, deadlineDate: { equals: new Date(DateTime.fromJSDate(now, { zone: BAKU_ZONE }).toISODate() + "T00:00:00.000Z") }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } });
  const matured = await db.promise.findMany({ where: { ownerUserId: userId, maturedAt: { not: null }, status: { in: ["KEPT", "BROKEN", "PARTIALLY_PAID"] }, createdAt: { gte: DateTime.fromJSDate(now).minus({ days: 30 }).toJSDate() } } });
  const kept = matured.filter((p) => p.status === "KEPT").length;
  // Attributed cash (demo rule): verified payment allocations credited once to the agent of the customer's latest verified RPC within 10 days.
  const myRpcCustomers = await db.interaction.findMany({ where: { agentUserId: userId, isRpc: true, startedAt: { gte: DateTime.fromJSDate(now).minus({ days: 10 }).toJSDate() } }, select: { customerId: true, startedAt: true } });
  let attributed = dec(0);
  for (const r of myRpcCustomers) {
    const later = await db.interaction.findFirst({ where: { customerId: r.customerId, isRpc: true, startedAt: { gt: r.startedAt }, agentUserId: { not: userId } } });
    if (later) continue;
    const pays = await db.payment.findMany({ where: { customerId: r.customerId, status: "POSTED", eventAt: { gte: r.startedAt, gte2: undefined } as never } });
    for (const p of pays) if (p.eventAt >= start) attributed = attributed.plus(p.amount);
  }
  const talk = interactions.filter((i) => i.talkSeconds).map((i) => i.talkSeconds!);
  const acw = interactions.filter((i) => i.acwSeconds).map((i) => i.acwSeconds!);
  const unresolved = await db.interaction.count({ where: { agentUserId: userId, OR: [{ status: "DRAFT" }, { wrapUpStatus: { in: ["PENDING", "FAILED"] } }] } });
  return {
    attempts: attempts.length,
    uniqueCustomers: new Set(attempts.map((a) => a.reservation.customerId)).size,
    rpc,
    rpcRateAttempt: attempts.length ? rpc / attempts.length : null,
    promises: promises.length,
    promisedAmount: money(promises.reduce((s, p) => s.plus(p.amount), dec(0))).toFixed(2),
    promisesDueToday: dueToday,
    attributedCash: money(attributed).toFixed(2),
    keptRate: matured.length ? kept / matured.length : null,
    keptNumerator: kept,
    keptDenominator: matured.length,
    avgTalkSeconds: talk.length ? Math.round(talk.reduce((a, b) => a + b, 0) / talk.length) : null,
    avgAcwSeconds: acw.length ? Math.round(acw.reduce((a, b) => a + b, 0) / acw.length) : null,
    unresolvedWrapUps: unresolved,
    qualityScore: null as number | null,
    period: `Today (${DateTime.fromJSDate(now, { zone: BAKU_ZONE }).toISODate()}, Asia/Baku)`,
  };
}

export async function agentPanels(db: Db, userId: string, now: Date) {
  const dayEnd = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).endOf("day").toJSDate();
  const callbacks = await db.workItem.findMany({ where: { type: "CALLBACK", OR: [{ ownerUserId: userId }, { ownerUserId: null, claimedByUserId: userId }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED"] } }, include: { customer: { select: { displayName: true, id: true } } }, orderBy: { dueAt: "asc" }, take: 20 });
  const promises = await db.promise.findMany({ where: { ownerUserId: userId, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION", "BROKEN", "KEPT"] }, OR: [{ deadline: { lte: new Date(dayEnd.getTime() + 2 * 86400000) } }, { status: { in: ["BROKEN", "PENDING_RECONCILIATION"] } }] }, include: { customer: { select: { displayName: true, id: true } } }, orderBy: { deadline: "asc" }, take: 20 });
  const tasks = await db.workItem.findMany({ where: { type: { in: ["PTP_FOLLOWUP", "RECONCILIATION", "DISPUTE_REVIEW", "SUPPORT_REVIEW"] }, OR: [{ ownerUserId: userId }, { claimedByUserId: userId }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, include: { customer: { select: { displayName: true, id: true } } }, orderBy: { dueAt: "asc" }, take: 20 });
  const recent = await db.interaction.findMany({ where: { agentUserId: userId, status: { in: ["SAVED", "CORRECTED"] } }, include: { customer: { select: { displayName: true, id: true } }, workItem: { select: { status: true } } }, orderBy: { startedAt: "desc" }, take: 10 });
  return {
    callbacks: callbacks.map((c) => ({ id: c.id, customerId: c.customerId, customerName: c.customer.displayName, dueAt: c.dueAt, status: c.status, reasons: c.deferredReasons, reason: c.reason, owned: c.ownerUserId === userId })),
    promises: promises.map((p) => ({ id: p.id, customerId: p.customerId, customerName: p.customer.displayName, amount: p.amount.toString(), remaining: p.remainingAmount.toString(), deadlineDate: fromDbDate(p.deadlineDate), status: p.status })),
    tasks: tasks.map((t) => ({ id: t.id, customerId: t.customerId, customerName: t.customer.displayName, type: t.type, dueAt: t.dueAt, status: t.status, reason: t.reason })),
    recent: recent.map((r) => ({ id: r.id, customerId: r.customerId, customerName: r.customer.displayName, startedAt: r.startedAt, technicalResult: r.technicalResult, identityStatus: r.identityStatus, businessOutcome: r.businessOutcome, nextAction: r.nextAction, taskStatus: r.workItem?.status ?? null, wrapUpStatus: r.wrapUpStatus })),
  };
}

export async function agentDesktopContext(db: Db, user: SessionUser, now: Date, opts: { full: boolean }) {
  const ctx = await getAgentContext(db, user.id);
  const customerId = ctx.reservation?.customerId ?? ctx.interaction?.customerId ?? null;
  const customer = customerId ? await getCustomer360(db, customerId, { now, maskContacts: true, includeEligibility: false }) : null;
  const script = ctx.interaction?.scriptVersionId ? await db.template.findUnique({ where: { id: ctx.interaction.scriptVersionId } }) : customer ? await db.template.findFirst({ where: { kind: "AGENT_SCRIPT", status: "ACTIVE", language: customer.customer.language } }) : null;
  const attempt = ctx.reservation?.dialAttempts?.[0] ?? null;
  const contact = ctx.reservation ? await db.contactPoint.findUnique({ where: { id: ctx.reservation.contactPointId } }) : null;
  const notifications = await db.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 10 });
  const base = {
    serverNow: now,
    session: ctx.session
      ? { id: ctx.session.id, requestedState: ctx.session.requestedState, confirmedState: ctx.session.confirmedState, stateSince: ctx.session.stateSince, stateReason: ctx.session.stateReason, ctiConnected: ctx.session.ctiConnected, ctiStatus: ctx.session.ctiStatus, autoContinue: ctx.session.autoContinue, campaignCodes: ctx.session.campaignCodes, extension: ctx.session.extension, providerAgentRef: ctx.session.providerAgentRef, pendingBreakAfterWrap: ctx.session.pendingBreakAfterWrap, pendingLogoffAfterWrap: ctx.session.pendingLogoffAfterWrap, lastHeartbeatAt: ctx.session.lastHeartbeatAt }
      : null,
    reservation: ctx.reservation
      ? { id: ctx.reservation.id, correlationId: ctx.reservation.correlationId, status: ctx.reservation.status, customerId: ctx.reservation.customerId, caseId: ctx.reservation.caseId, campaignCode: ctx.reservation.campaignCode, createdAt: ctx.reservation.createdAt, isManual: ctx.reservation.isManual, maskedNumber: contact ? maskNumber(contact.value) : null, withdrawalStatus: ctx.reservation.withdrawalStatus, attempt: attempt ? { startedAt: attempt.startedAt, ringingAt: attempt.ringingAt, answeredAt: attempt.answeredAt, bridgedAt: attempt.bridgedAt, endedAt: attempt.endedAt, technicalResult: attempt.technicalResult } : null }
      : null,
    interaction: ctx.interaction
      ? { id: ctx.interaction.id, status: ctx.interaction.status, correlationId: ctx.interaction.correlationId, customerId: ctx.interaction.customerId, startedAt: ctx.interaction.startedAt, connectedAt: ctx.interaction.connectedAt, endedAt: ctx.interaction.endedAt, acwStartedAt: ctx.interaction.acwStartedAt, talkSeconds: ctx.interaction.talkSeconds, ringSeconds: ctx.interaction.ringSeconds, technicalResult: ctx.interaction.technicalResult, wrapUpStatus: ctx.interaction.wrapUpStatus, draft: ctx.interaction.draftJson, draftSavedAt: ctx.interaction.draftSavedAt, scriptVersionId: ctx.interaction.scriptVersionId, identityStatus: ctx.interaction.identityStatus, businessOutcome: ctx.interaction.businessOutcome, savedAt: ctx.interaction.savedAt, providerInteractionRef: ctx.interaction.providerInteractionRef }
      : null,
    customer,
    script: script ? { id: script.id, code: script.code, version: script.version, language: script.language, title: script.title, body: script.body as { steps: { key: string; title: string; text: string; requires: string }[]; thirdParty: string; branches: { response: string; route: string }[] } } : null,
    notifications: notifications.map((n) => ({ id: n.id, kind: n.kind, message: n.message, createdAt: n.createdAt })),
    capabilities: { mute: true, hold: true, transfer: false, end: true, manualDial: !!user.seniority && user.seniority === "SENIOR" },
  };
  if (!opts.full) return base;
  const [metrics, panels] = await Promise.all([agentMetrics(db, user.id, now), agentPanels(db, user.id, now)]);
  return { ...base, metrics, panels };
}
