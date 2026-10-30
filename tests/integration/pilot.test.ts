import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import type { NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { readControlState } from "@/server/modules/dialer/contract";
import { startAgentSession } from "@/server/modules/dialer/agentSessionService";
import { processOutbox } from "@/server/modules/outbox/processor";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { saveOutcome } from "@/server/modules/interactions/outcomeService";
import { ingestIntegrationEvent, buildSimulatedPaymentEvent, buildSimulatedReversalEvent } from "@/server/modules/payments/paymentService";
import { attributedCashByAgent, attributedCashForAgent } from "@/server/modules/payments/attribution";
import { teamGrid } from "@/server/modules/operations/operationsService";
import { canAccessCustomer } from "@/server/auth/access";
import { customerScope } from "@/server/auth/scope";
import { searchCustomers } from "@/server/modules/customers/customerService";
import { listWorkQueue, queueHeader } from "@/server/modules/work/queueService";
import { createPromise } from "@/server/modules/promises/promiseService";
import { cancelReminders, dispatchDueReminders } from "@/server/modules/promises/reminderService";
import { decideApproval } from "@/server/modules/approvals/approvalService";
import { forceEndInteraction, hydrateMockAdapter, reconcileProviderState } from "@/server/modules/dialer/providerReconciliation";
import { runCatchUp } from "@/server/modules/jobs/catchUp";
import { runDailyAging } from "@/server/modules/jobs/aging";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { addDays, bakuBusinessDate, bakuDateTime, fromDbDate } from "@/server/dates";
import { DEMO_SEED_INSTANT } from "@/server/clock";
import { seedHistoricalCall } from "../../prisma/seed/scenarios";
import { GET as healthReady } from "@/app/api/health/ready/route";

/**
 * Pilot-hardening regressions through the real services: one authorization scope (lists, search, totals), versioned
 * cash attribution, durable reminders, provider-confirmed call controls with supervisor recovery, idempotent
 * catch-up and aging, the new conversation outcomes, loan-level case scope and the readiness endpoint.
 */
let prisma: PrismaClient;
let now = new Date(DEMO_SEED_INSTANT.getTime() + 3 * 3600_000); // 13:00 Baku on the seeded business date
const adapter = new MockDialerAdapter(() => now);
const pendingEvents: { delayMs: number; event: NormalizedProviderEvent }[] = [];
const scheduleEvents = async (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => { pendingEvents.push(...steps); };
async function drain() { for (let i = 0; i < 12; i++) { const n = await processOutbox(prisma, adapter, scheduleEvents, now); if (n === 0) break; } }
let seq = 0;

async function sessionUser(username: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { username }, include: { team: true, agentProfile: true } });
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, teamId: u.teamId, teamName: u.team?.name ?? null, languages: u.languages, skills: u.skills, branchScopes: u.branchScopes, seniority: u.agentProfile?.seniority ?? null, extension: u.agentProfile?.extension ?? null, providerAgentRef: u.agentProfile?.providerAgentRef ?? null, mustChangePassword: false, sessionId: `test-${username}`, sessionExpiresAt: new Date(now.getTime() + 3600_000) };
}
/** Untouched synthetic customers with an open case and arrears, no promises/support cases, not yet used by this file. */
const used = new Set<string>();
async function freshCustomer(opts: { loans?: number; verifiedMobile?: boolean } = {}) {
  const rows = await prisma.collectionCase.findMany({ where: { status: "OPEN", customerId: { startsWith: "C-SYN-", notIn: [...used] }, customer: { status: "ACTIVE", promises: { none: {} }, supportCases: { none: {} }, interactions: { none: {} }, loans: { some: { totalOverdue: { gt: 0 } } }, ...(opts.verifiedMobile ? { contactPoints: { some: { type: "MOBILE", verification: "VERIFIED" } } } : {}) } }, include: { customer: { include: { loans: { where: { status: "ACTIVE" } } } } }, orderBy: { customerId: "asc" }, take: 60 });
  const pick = rows.find((r) => (opts.loans ? r.customer.loans.filter((l) => Number(l.totalOverdue) > 0).length >= opts.loans : true));
  if (!pick) throw new Error("No suitable synthetic customer left");
  used.add(pick.customerId);
  return { customerId: pick.customerId, caseId: pick.id, loans: pick.customer.loans };
}
async function openCall(customerId: string, agentUserId: string, sessionId: string, opts: { live?: boolean; corr?: string } = {}) {
  const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId, status: { in: ["OPEN", "HANDOVER"] } } });
  const cp = await prisma.contactPoint.findFirstOrThrow({ where: { customerId, type: "MOBILE" } });
  const wi = await prisma.workItem.create({ data: { customerId, caseId: c.id, type: "CALL", status: "IN_PROGRESS", priority: "1.00", campaignCode: "SOFT_COLLECTIONS_VOICE" } });
  const corr = opts.corr ?? `res-pilot-${++seq}`;
  const live = opts.live ?? false;
  const res = await prisma.routingReservation.create({ data: { correlationId: corr, workItemId: wi.id, customerId, caseId: c.id, agentUserId, agentSessionId: sessionId, campaignCode: "SOFT_COLLECTIONS_VOICE", contactPointId: cp.id, status: live ? "CONNECTED" : "RELEASED", releasedAt: live ? null : now, expiresAt: new Date(now.getTime() + 600_000), authorizationRef: `auth-${corr}` } });
  const attempt = await prisma.dialAttempt.create({ data: { reservationId: res.id, contactPointId: cp.id, providerAttemptRef: `mock-att-${corr}`, startedAt: new Date(now.getTime() - 200_000), ringingAt: new Date(now.getTime() - 195_000), answeredAt: new Date(now.getTime() - 180_000), bridgedAt: new Date(now.getTime() - 180_000), ...(live ? {} : { endedAt: now, technicalResult: "ANSWERED" as const }) } });
  const i = await prisma.interaction.create({ data: { correlationId: corr, customerId, caseId: c.id, workItemId: wi.id, reservationId: res.id, dialAttemptId: attempt.id, agentUserId, channel: "VOICE_OUTBOUND", contactPointId: cp.id, providerInteractionRef: `mock-call-${corr}`, campaignCode: "SOFT_COLLECTIONS_VOICE", startedAt: new Date(now.getTime() - 200_000), connectedAt: new Date(now.getTime() - 180_000), endedAt: live ? null : now, acwStartedAt: live ? null : now, talkSeconds: live ? null : 180, technicalResult: live ? null : "ANSWERED", status: live ? "OPEN" : "DRAFT", wrapUpStatus: live ? "NOT_REQUIRED" : "PENDING" } });
  return { interaction: i, reservation: res, caseId: c.id };
}
const save = (interactionId: string, actorUserId: string, input: Record<string, unknown>) => saveOutcome(prisma, { interactionId, actorUserId, now, input: { idempotencyKey: `pilot-${interactionId}-${Math.random().toString(36).slice(2, 10)}`, returnReady: true, ...input } });
const overdueOf = async (customerId: string) => { const loans = await prisma.loan.findMany({ where: { customerId, status: "ACTIVE" } }); return { loans, total: loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2) }; };

let agentA: SessionUser;
let agentB: SessionUser;
let lead: SessionUser;
let sessionC = "";
let sessionD = "";

beforeAll(async () => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  agentA = await sessionUser("agent.a");
  agentB = await sessionUser("agent.b");
  lead = await sessionUser("lead");
  for (const [name, setter] of [["agent.c", (id: string) => (sessionC = id)], ["agent.d", (id: string) => (sessionD = id)]] as const) {
    const u = await prisma.user.findUniqueOrThrow({ where: { username: name }, include: { agentProfile: true } });
    const s = await startAgentSession(prisma, { userId: u.id, providerAgentRef: u.agentProfile!.providerAgentRef, extension: u.agentProfile!.extension, campaignCodes: u.agentProfile!.campaignCodes, autoContinueAllowed: true, now });
    setter(s.id);
  }
  await drain();
});
afterAll(async () => { await prisma.$disconnect(); });

describe("one authorization scope for lists, search, totals and detail access", () => {
  it("an agent cannot open, search or list another agent's customer; the history window bounds access", async () => {
    const { customerId } = await freshCustomer();
    // Agent B handled the customer yesterday; agent A never did.
    await seedHistoricalCall(prisma, { customerId, agentUserId: agentB.id, at: new Date(now.getTime() - 86_400_000), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: "NOT_STATED", talkSeconds: 90 });
    expect(await canAccessCustomer(prisma, agentB, customerId)).toBe(true);
    expect(await canAccessCustomer(prisma, agentA, customerId)).toBe(false);
    expect(await canAccessCustomer(prisma, lead, customerId)).toBe(true);
    const scopeA = await customerScope(prisma, agentA, now);
    const scopeB = await customerScope(prisma, agentB, now);
    expect(scopeA.kind).toBe("CUSTOMERS");
    const searchA = await searchCustomers(prisma, customerId, { scope: scopeA });
    expect(searchA.rows).toHaveLength(0);
    expect(searchA.hiddenByScope).toBe(1);
    const searchB = await searchCustomers(prisma, customerId, { scope: scopeB });
    expect(searchB.rows.map((r) => r.id)).toEqual([customerId]);
    // Lists and headers apply the same scope before paging: nothing outside scopeA appears for agent A.
    const q = await listWorkQueue(prisma, agentA, { queue: "all", page: 1, pageSize: 500 }, scopeA);
    for (const r of q.rows) expect(scopeA.customerIds).toContain(r.id);
    const header = await queueHeader(prisma, agentA, scopeA, now);
    expect(header.eligible).toBeLessThanOrEqual(await prisma.workItem.count({ where: { customerId: { in: scopeA.customerIds }, type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE" } }));
    // Fourteen days later the single historical interaction no longer grants agent B access.
    const later = new Date(now.getTime() + 15 * 86_400_000);
    const scopeBLater = await customerScope(prisma, agentB, later);
    const stillLinked = (await prisma.promise.count({ where: { customerId, OR: [{ ownerUserId: agentB.id }, { createdByUserId: agentB.id }] } })) + (await prisma.workItem.count({ where: { customerId, OR: [{ ownerUserId: agentB.id }, { claimedByUserId: agentB.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } } }));
    if (stillLinked === 0) expect(scopeBLater.customerIds).not.toContain(customerId);
  });
});

describe("versioned cash attribution (ATTRIB-1) used by every report", () => {
  it("credits a posted payment once to the latest verified conversation, never twice, and reversals remove it", async () => {
    const { customerId, loans } = await freshCustomer();
    const loan = loans.find((l) => Number(l.totalOverdue) > 0)!;
    await seedHistoricalCall(prisma, { customerId, agentUserId: agentA.id, at: new Date(now.getTime() - 2 * 3600_000), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: "SALARY_TIMING", talkSeconds: 120 });
    await seedHistoricalCall(prisma, { customerId, agentUserId: agentB.id, at: new Date(now.getTime() - 3600_000), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: "SALARY_TIMING", talkSeconds: 60 });
    const beforeA = await attributedCashForAgent(prisma, agentA.id, { from: now, to: now });
    const beforeB = await attributedCashForAgent(prisma, agentB.id, { from: now, to: now });
    const txn = `PILOT-ATTRIB-${customerId}`;
    const r1 = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: "100.00", now, transactionId: txn }), now);
    expect(r1.status).toBe("PROCESSED");
    const payment = await prisma.payment.findFirstOrThrow({ where: { sourceTransactionId: txn } });
    const attribution = await prisma.paymentAttribution.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(attribution.agentUserId).toBe(agentB.id); // competing agents: the latest verified conversation wins, never both
    expect(attribution.ruleVersion).toBe("ATTRIB-1");
    expect(fromDbDate(attribution.reportingDate)).toBe(bakuBusinessDate(now));
    // Replay of the same business reference: no second row, totals unchanged.
    const r2 = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: "100.00", now, transactionId: txn }), now);
    expect(r2.status).toBe("DUPLICATE");
    expect(await prisma.paymentAttribution.count({ where: { customerId } })).toBe(1);
    expect(Number(await attributedCashForAgent(prisma, agentB.id, { from: now, to: now }))).toBeCloseTo(Number(beforeB) + 100, 2);
    expect(await attributedCashForAgent(prisma, agentA.id, { from: now, to: now })).toBe(beforeA);
    // Team grid and analytics read the same rows.
    const grid = await teamGrid(prisma, now);
    const rowB = grid.agents.find((a) => a.userId === agentB.id)!;
    expect(rowB.attributedCash).toBe(await attributedCashForAgent(prisma, agentB.id, { from: now, to: now }));
    const byAgent = await attributedCashByAgent(prisma, { from: now, to: now });
    expect(byAgent.get(agentB.id)).toBe(rowB.attributedCash);
    // Reversal removes the credit; the history row stays.
    const rev = await ingestIntegrationEvent(prisma, buildSimulatedReversalEvent({ originalTransactionId: txn, now, loanRef: loan.coreLoanId }), now);
    expect(rev.status).toBe("PROCESSED");
    const reversed = await prisma.paymentAttribution.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(reversed.reversedAt).not.toBeNull();
    expect(await attributedCashForAgent(prisma, agentB.id, { from: now, to: now })).toBe(beforeB);
  });
  it("a payment with no verified conversation in the window stays unattributed", async () => {
    const { customerId, loans } = await freshCustomer();
    const loan = loans.find((l) => Number(l.totalOverdue) > 0)!;
    const txn = `PILOT-UNATTR-${customerId}`;
    await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: "10.00", now, transactionId: txn }), now);
    const payment = await prisma.payment.findFirstOrThrow({ where: { sourceTransactionId: txn } });
    const a = await prisma.paymentAttribution.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(a.agentUserId).toBeNull();
  });
});

describe("durable promise reminders", () => {
  it("schedules on creation, dispatches with rechecks, confirms delivery, skips a changed promise and cancels with the promise", async () => {
    const { customerId, caseId, loans } = await freshCustomer({ verifiedMobile: true });
    const deadline = addDays(bakuBusinessDate(now), 3);
    const promise = await createPromise(prisma, { customerId, caseId, interactionId: null, amount: "50.00", deadlineDate: deadline, coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true, createdByUserId: agentA.id, ownerUserId: agentA.id, now, lastRpcAt: null });
    const jobs = await prisma.reminderJob.findMany({ where: { promiseId: promise.id }, orderBy: { scheduledFor: "asc" } });
    expect(jobs.map((j) => j.kind)).toEqual(["BEFORE_DEADLINE", "DEADLINE_DAY"]);
    expect(jobs[0].scheduledFor.toISOString()).toBe(bakuDateTime(addDays(deadline, -1), "10:00").toISOString());
    expect(jobs.every((j) => j.status === "SCHEDULED")).toBe(true);
    // Not due yet: nothing is sent.
    expect((await dispatchDueReminders(prisma, now)).sent).toBe(0);
    // Due slot (two days later; the worker keeps balances and the payment feed fresh by then): one reminder is queued
    // to the gateway with segments and cost; the outbox confirms delivery.
    const at = new Date(jobs[0].scheduledFor.getTime() + 60_000);
    await prisma.sourceWatermark.updateMany({ where: { sourceSystem: { in: ["PAYMENT_FEED", "CORE_BANKING"] } }, data: { sourceAsOf: at, lastSuccessfulRunAt: at } });
    await prisma.loan.updateMany({ where: { customerId }, data: { balancesAsOf: at } });
    const r = await dispatchDueReminders(prisma, at);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const sent = await prisma.reminderJob.findUniqueOrThrow({ where: { id: jobs[0].id }, include: { outboundMessage: true } });
    expect(sent.status).toBe("SENT");
    expect(sent.outboundMessage?.kind).toBe("PTP_REMINDER");
    expect(sent.outboundMessage?.segments).toBeGreaterThanOrEqual(1);
    expect(sent.outboundMessage?.estimatedCost?.toString()).toMatch(/^\d/);
    const saveNow = now; now = at; await drain(); now = saveNow;
    expect((await prisma.reminderJob.findUniqueOrThrow({ where: { id: jobs[0].id } })).status).toBe("DELIVERED");
    // Dispatching again never sends twice (the job is no longer SCHEDULED).
    expect((await dispatchDueReminders(prisma, at)).sent).toBe(0);
    // A changed promise version makes the remaining scheduled job skip instead of sending stale content.
    await prisma.promise.update({ where: { id: promise.id }, data: { version: { increment: 1 } } });
    const r2 = await dispatchDueReminders(prisma, new Date(jobs[1].scheduledFor.getTime() + 60_000));
    expect(r2.skipped).toBeGreaterThanOrEqual(1);
    expect((await prisma.reminderJob.findUniqueOrThrow({ where: { id: jobs[1].id } })).status).toBe("SKIPPED");
    // Cancellation closes whatever is still scheduled.
    const p2 = await createPromise(prisma, { customerId: (await freshCustomer({ verifiedMobile: true })).customerId, caseId: null, interactionId: null, amount: "20.00", deadlineDate: addDays(bakuBusinessDate(now), 5), coveredLoanIds: [], customerConfirmed: true, createdByUserId: agentA.id, ownerUserId: agentA.id, now, lastRpcAt: null }).catch(() => null);
    if (p2) {
      const cancelled = await cancelReminders(prisma, p2.id, "test cancel", now);
      expect(cancelled).toBe(2);
    }
  });
});

describe("provider-confirmed call controls and supervisor recovery", () => {
  it("MUTE is confirmed by the provider; a rejected END leaves a durable error and an exception; force-end recovers the call", async () => {
    const { customerId } = await freshCustomer();
    const ok = await openCall(customerId, "U-AGENT-C", sessionC, { live: true });
    await hydrateMockAdapter(prisma, adapter); // worker restart: provider view rebuilt from persisted facts
    expect((await adapter.getInteraction(ok.interaction.providerInteractionRef!)).state).toBe("CONNECTED");
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId: ok.interaction.id, action: "MUTE", agentRef: "mock-agent-1051" }, `ctl:MUTE:${ok.interaction.id}:1`, ok.interaction.correlationId);
    await drain();
    let state = readControlState((await prisma.interaction.findUniqueOrThrow({ where: { id: ok.interaction.id } })).controlState);
    expect(state.muted).toBe(true);
    expect(state.lastError).toBeNull();
    // Release the healthy call so agent C is free again (one active reservation per agent).
    await prisma.routingReservation.update({ where: { id: ok.reservation.id }, data: { status: "RELEASED", releasedAt: now } });
    await prisma.interaction.update({ where: { id: ok.interaction.id }, data: { status: "ABANDONED", endedAt: now } });
    // END refused by the provider.
    const { customerId: c2 } = await freshCustomer();
    const bad = await openCall(c2, "U-AGENT-D", sessionD, { live: true, corr: `res-pilot-reject-end-${++seq}` });
    await hydrateMockAdapter(prisma, adapter);
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId: bad.interaction.id, action: "END", agentRef: "mock-agent-1052" }, `ctl:END:${bad.interaction.id}:once`, bad.interaction.correlationId);
    await drain();
    state = readControlState((await prisma.interaction.findUniqueOrThrow({ where: { id: bad.interaction.id } })).controlState);
    expect(state.lastError).toMatch(/END rejected/);
    const exception = await prisma.exceptionCase.findUniqueOrThrow({ where: { dedupKey: `CALL_CONTROL_FAILURE:${bad.interaction.id}` } });
    expect(exception.status).toBe("OPEN");
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: bad.interaction.id } })).status).toBe("OPEN");
    // Reconciliation leaves a provider-connected call alone; the supervisor force-ends it.
    await reconcileProviderState(prisma, adapter, now, scheduleEvents);
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: bad.interaction.id } })).status).toBe("OPEN");
    const forced = await forceEndInteraction(prisma, { interactionId: bad.interaction.id, actorUserId: lead.id, reason: "Provider refused END; customer confirmed the call ended", now });
    expect(forced.ended).toBe(true);
    const after = await prisma.interaction.findUniqueOrThrow({ where: { id: bad.interaction.id } });
    expect(after.status).toBe("DRAFT");
    expect(after.wrapUpStatus).toBe("PENDING");
    expect((await prisma.exceptionCase.findUniqueOrThrow({ where: { dedupKey: `CALL_CONTROL_FAILURE:${bad.interaction.id}` } })).status).toBe("RESOLVED");
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionD } })).confirmedState).toBe("ACW");
    // The draft outcome can now be saved normally.
    const { total, loans } = await overdueOf(c2);
    const saved = await save(bad.interaction.id, "U-AGENT-D", { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: total, deadlineDate: addDays(bakuBusinessDate(now), 2), coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true } });
    expect(saved.duplicate).toBe(false);
  });
});

describe("idempotent catch-up and Baku business-day aging", () => {
  it("catch-up can run twice without duplicating effects; aging advances DPD once per business date", { timeout: 600_000 }, async () => {
    const first = await runCatchUp(prisma, adapter, now, scheduleEvents);
    const second = await runCatchUp(prisma, adapter, now, scheduleEvents);
    expect((second.aging as { loans: number }).loans).toBe(0);
    expect((second.attribution as { processed: number }).processed).toBe(0);
    expect(second.businessDate).toBe(first.businessDate);
    const audits = await prisma.auditEvent.count({ where: { action: "worker.catch_up" } });
    expect(audits).toBeGreaterThanOrEqual(2);
    // Next Baku business day at 05:30: every active loan is aged exactly once; an unpaid overdue loan gains one DPD.
    const { loans } = await freshCustomer();
    const loan = loans.find((l) => Number(l.totalOverdue) > 0 && l.dpd > 0)!;
    const tomorrow = bakuDateTime(addDays(bakuBusinessDate(now), 1), "05:30");
    const aged = await runDailyAging(prisma, tomorrow, { reason: "test" });
    expect(aged.businessDate).toBe(addDays(bakuBusinessDate(now), 1));
    expect(aged.loans).toBeGreaterThan(0);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.dpd).toBe(loan.dpd + 1);
    expect(fromDbDate(after.agedForDate)).toBe(aged.businessDate);
    expect((await runDailyAging(prisma, tomorrow, { reason: "test again" })).loans).toBe(0);
    // Keep the rest of the file on the seeded business date.
    await prisma.loan.updateMany({ data: { agedForDate: null } });
    await runDailyAging(prisma, now, { reason: "reset" });
  });
});

describe("conversation outcomes: overdue cleared, promise-date exception, death report", () => {
  it("a verified posting during the call clears the overdue: agent is notified and 'Overdue cleared' is the only sensible outcome", async () => {
    const { customerId, loans } = await freshCustomer({ loans: 1 });
    const call = await openCall(customerId, "U-AGENT-C", sessionC, { live: true });
    await hydrateMockAdapter(prisma, adapter);
    // Still overdue: the closure outcome is refused.
    await prisma.interaction.update({ where: { id: call.interaction.id }, data: { status: "DRAFT", endedAt: now, acwStartedAt: now, talkSeconds: 60, technicalResult: "ANSWERED", wrapUpStatus: "PENDING" } });
    await expect(save(call.interaction.id, "U-AGENT-C", { identityStatus: "RPC_VERIFIED", businessOutcome: "DELINQUENCY_CLOSED" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await prisma.interaction.update({ where: { id: call.interaction.id }, data: { status: "OPEN", endedAt: null, acwStartedAt: null } });
    // Payment clears every overdue loan while the reservation is CONNECTED.
    for (const l of loans.filter((x) => Number(x.totalOverdue) > 0)) {
      const r = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: l.coreLoanId, amount: Number(l.totalOverdue).toFixed(2), now, transactionId: `PILOT-CLEAR-${l.id}` }), now);
      expect(r.status).toBe("PROCESSED");
    }
    const notifies = await prisma.outboxMessage.findMany({ where: { topic: "agent.notify", OR: [{ idempotencyKey: { startsWith: `notify:${call.reservation.id}:` } }, { idempotencyKey: { startsWith: `notify-cleared:${call.reservation.id}:` } }] } });
    expect(notifies.map((n) => (n.payload as { kind: string }).kind)).toContain("PAYMENT_CLEARED_DURING_CALL");
    await drain();
    expect(await prisma.notification.count({ where: { userId: "U-AGENT-C", kind: "PAYMENT_CLEARED_DURING_CALL" } })).toBeGreaterThanOrEqual(1);
    expect((await prisma.collectionCase.findUniqueOrThrow({ where: { id: call.caseId } })).status).toBe("CURED");
    await prisma.interaction.update({ where: { id: call.interaction.id }, data: { status: "DRAFT", endedAt: now, acwStartedAt: now, talkSeconds: 60, technicalResult: "ANSWERED", wrapUpStatus: "PENDING" } });
    const r = await save(call.interaction.id, "U-AGENT-C", { identityStatus: "RPC_VERIFIED", businessOutcome: "DELINQUENCY_CLOSED" });
    expect(r.preview?.nextAction).toBe("COOLDOWN");
    expect(await prisma.promise.count({ where: { interactionId: call.interaction.id } })).toBe(0);
    expect(await prisma.workItem.count({ where: { customerId, type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } })).toBe(0);
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: call.interaction.id } })).factualSummary).toContain("Gecikmə bağlanıb");
  });
  it("an out-of-policy date becomes a proposed exception; the lead's approval creates the promise, self-approval is refused", async () => {
    const { customerId, loans } = await freshCustomer();
    const { interaction } = await openCall(customerId, agentA.id, sessionC);
    const { total } = await overdueOf(customerId);
    const farDate = addDays(bakuBusinessDate(now), 45);
    await expect(save(interaction.id, agentA.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: total, deadlineDate: farDate, coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await save(interaction.id, agentA.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP_EXCEPTION_PROPOSED", nonPaymentReason: "SALARY_TIMING", ptp: { amount: total, deadlineDate: farDate, coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true } });
    const approvalId = (r.effects as { ptpExceptionApprovalId: string }).ptpExceptionApprovalId;
    expect(approvalId).toBeTruthy();
    expect(await prisma.promise.count({ where: { customerId } })).toBe(0);
    const ar = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
    expect(ar.type).toBe("PTP_EXCEPTION");
    expect(ar.status).toBe("PENDING");
    await expect(decideApproval(prisma, approvalId, agentA, "APPROVE", "my own", now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const decided = await decideApproval(prisma, approvalId, lead, "APPROVE", "Customer's salary date documented; exception justified", now);
    expect(decided.status).toBe("APPROVED");
    const promise = await prisma.promise.findFirstOrThrow({ where: { customerId, status: "ACTIVE" } });
    expect(fromDbDate(promise.deadlineDate)).toBe(farDate);
    expect((promise.reminderPlan as { policyException: { approvalId: string } }).policyException.approvalId).toBe(approvalId);
    expect(await prisma.reminderJob.count({ where: { promiseId: promise.id } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: agentA.id, kind: "PTP_EXCEPTION_APPROVED" } })).toBeGreaterThanOrEqual(1);
  });
  it("a third-party death report is recorded as reported, stops routine contact and opens a verification exception", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, agentA.id, sessionC);
    await expect(save(interaction.id, agentA.id, { identityStatus: "THIRD_PARTY", businessOutcome: "SPECIAL_REFERRAL", note: "Spouse informed us of the death", support: { type: "DECEASED_LEGAL", reason: "Spouse informed us" } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await save(interaction.id, agentA.id, { identityStatus: "THIRD_PARTY", businessOutcome: "SPECIAL_REFERRAL", note: "Spouse informed us of the death", support: { type: "DECEASED_LEGAL", reason: "Spouse informed us", reporterRelation: "SPOUSE" } });
    const sc = await prisma.supportCase.findUniqueOrThrow({ where: { id: (r.effects as { supportCaseId: string }).supportCaseId } });
    expect(sc.reporterRelation).toBe("SPOUSE");
    expect(sc.reportSource).toBe("THIRD_PARTY_CALL");
    expect(sc.confirmedAt).toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("DECEASED_NOTIFIED");
    const ex = await prisma.exceptionCase.findUniqueOrThrow({ where: { dedupKey: `DECEASED_VERIFICATION:${customerId}` } });
    expect(ex.severity).toBe("CRITICAL");
    expect(await prisma.workItem.count({ where: { customerId, type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } })).toBe(0);
    const el = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now });
    expect(el.decision.eligible).toBe(false);
  });
});

describe("loan-level case scope", () => {
  it("clearing one of two overdue loans releases it from the case while the episode stays open; clearing both cures", async () => {
    const { caseId, loans } = await freshCustomer({ loans: 2 });
    const overdue = loans.filter((l) => Number(l.totalOverdue) > 0);
    const r1 = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: overdue[0].coreLoanId, amount: Number(overdue[0].totalOverdue).toFixed(2), now, transactionId: `PILOT-LOAN1-${overdue[0].id}` }), now);
    expect(r1.status).toBe("PROCESSED");
    const links = await prisma.caseLoan.findMany({ where: { caseId } });
    expect(links.find((l) => l.loanId === overdue[0].id)?.releaseReason).toBe("LOAN_ARREARS_CLEARED");
    expect(links.find((l) => l.loanId === overdue[1].id)?.releasedAt).toBeNull();
    expect((await prisma.collectionCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("OPEN");
    for (const l of overdue.slice(1)) await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: l.coreLoanId, amount: Number(l.totalOverdue).toFixed(2), now, transactionId: `PILOT-LOANN-${l.id}` }), now);
    expect((await prisma.collectionCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("CURED");
    expect((await prisma.caseLoan.findMany({ where: { caseId } })).every((l) => l.releasedAt)).toBe(true);
  });
});

describe("operational readiness", () => {
  it("readiness reports the database, applied migrations and the worker heartbeat", async () => {
    const res = await healthReady();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: { database: string; migrations: string; worker: { online: boolean } } };
    expect(body.ok).toBe(true);
    expect(body.checks.database).toBe("ok");
    expect(body.checks.migrations).toBe("applied");
    expect(typeof body.checks.worker.online).toBe("boolean");
  });
});
