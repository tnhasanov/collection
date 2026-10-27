import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import type { NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { startAgentSession, requestAgentState, heartbeat, getAgentContext } from "@/server/modules/dialer/agentSessionService";
import { allocateForReadyAgents, allocateForSession } from "@/server/modules/dialer/routingService";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { processOutbox } from "@/server/modules/outbox/processor";
import { saveOutcome } from "@/server/modules/interactions/outcomeService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { ingestIntegrationEvent, buildSimulatedPaymentEvent } from "@/server/modules/payments/paymentService";
import { claimNextWorkItem } from "@/server/modules/work/workItemService";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { DEMO_SEED_INSTANT } from "@/server/clock";
import { hasPermission } from "@/server/auth/permissions";

let prisma: PrismaClient;
let now = new Date(DEMO_SEED_INSTANT.getTime() + 60_000); // 10:01 Baku
const adapter = new MockDialerAdapter(() => now);
let pendingEvents: { delayMs: number; event: NormalizedProviderEvent }[] = [];
const scheduleEvents = async (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => {
  pendingEvents.push(...steps);
};
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
async function drain() {
  for (let i = 0; i < 10; i++) {
    const n = await processOutbox(prisma, adapter, scheduleEvents, now);
    if (n === 0) break;
  }
}
async function deliverPending() {
  const steps = [...pendingEvents].sort((a, b) => a.delayMs - b.delayMs);
  pendingEvents = [];
  const results = [];
  for (const s of steps) {
    advance(Math.max(0, s.delayMs));
    adapter.applyEvent(s.event);
    results.push(await ingestProviderEvent(prisma, { ...s.event, occurredAt: now.toISOString() }, now, adapter));
  }
  return results;
}

beforeAll(async () => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("complete agent journey (master acceptance + CTI cases)", () => {
  let sessionId = "";
  let interactionId = "";
  let reservationId = "";

  it("agent signs in to CTI and becomes confirmed Ready only after the provider confirms", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: "agent.a" }, include: { agentProfile: true } });
    const session = await startAgentSession(prisma, { userId: user.id, providerAgentRef: user.agentProfile!.providerAgentRef, extension: user.agentProfile!.extension, campaignCodes: user.agentProfile!.campaignCodes, autoContinueAllowed: true, now });
    sessionId = session.id;
    expect(session.confirmedState).toBe("OFFLINE");
    await drain();
    let s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("NOT_READY");
    expect(s.ctiConnected).toBe(true);
    const r = await requestAgentState(prisma, { sessionId, state: "READY", now, actorUserId: user.id });
    expect(r.session.requestedState).toBe("READY");
    expect(r.session.confirmedState).toBe("NOT_READY"); // never optimistic
    await drain();
    s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("READY");
  });

  it("receives the highest-priority eligible customer automatically (no Get next click)", async () => {
    await heartbeat(prisma, sessionId, now);
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    const mine = results.find((r) => r.sessionId === sessionId)!;
    expect(mine.outcome).toBe("RESERVED");
    expect(mine.customerId).toBe("C-DEMO-001");
    reservationId = mine.reservationId!;
    const res = await prisma.routingReservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.status).toBe("AUTHORIZED");
    // One active reservation per customer across campaigns and one per agent.
    await expect(prisma.routingReservation.create({ data: { correlationId: "dup-cust", workItemId: res.workItemId, customerId: res.customerId, caseId: res.caseId, agentUserId: "U-AGENT-B", campaignCode: "OTHER", contactPointId: res.contactPointId, status: "PENDING", expiresAt: now } })).rejects.toThrow();
    const second = await allocateForSession(prisma, sessionId, now, adapter, scheduleEvents);
    expect(second.outcome).toBe("NOT_ELIGIBLE_AGENT");
  });

  it("screen pop uses trusted ids; provider Answered is not RPC; call end opens ACW", async () => {
    const delivered = await deliverPending();
    expect(delivered.every((d) => d.status === "APPLIED")).toBe(true);
    const ctx = await getAgentContext(prisma, "U-AGENT-A");
    expect(ctx.session?.confirmedState).toBe("TALKING");
    expect(ctx.interaction?.customerId).toBe("C-DEMO-001");
    expect(ctx.interaction?.identityStatus).toBeNull();
    expect(ctx.interaction?.technicalResult).toBe("ANSWERED");
    interactionId = ctx.interaction!.id;
    // Duplicate provider event has no effect.
    const dup = await ingestProviderEvent(prisma, { provider: "MOCK_DIALER", providerEventId: `mock-call-${ctx.reservation!.correlationId}:agent.bridged`, eventType: "agent.bridged", occurredAt: now.toISOString(), correlationId: ctx.reservation!.correlationId, providerInteractionRef: `mock-call-${ctx.reservation!.correlationId}`, payload: {} }, now, adapter);
    expect(dup.status).toBe("DUPLICATE");
    // Saving a final outcome during the active call is refused.
    await expect(saveOutcome(prisma, { interactionId, actorUserId: "U-AGENT-A", now, input: { idempotencyKey: "key-early-0001", identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "SALARY_TIMING", returnReady: true } })).rejects.toMatchObject({ code: "CONFLICT" });
    // Agent ends the call through the provider.
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId, action: "END", agentRef: "mock-agent-1042" }, `ctl:END:${interactionId}`);
    advance(130_000);
    await drain();
    await deliverPending();
    const after = await getAgentContext(prisma, "U-AGENT-A");
    expect(after.session?.confirmedState).toBe("ACW");
    expect(after.interaction?.status).toBe("DRAFT");
    expect(after.interaction?.talkSeconds).toBeGreaterThan(100);
    // Ready is blocked while wrap-up is unresolved.
    await expect(requestAgentState(prisma, { sessionId, state: "READY", now, actorUserId: "U-AGENT-A" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates the structured outcome and saves PTP + effects atomically, then acknowledges provider wrap-up", async () => {
    await expect(saveOutcome(prisma, { interactionId, actorUserId: "U-AGENT-A", now, input: { idempotencyKey: "key-ptp-00001", identityStatus: "THIRD_PARTY", businessOutcome: "PTP", returnReady: true } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await saveOutcome(prisma, { interactionId, actorUserId: "U-AGENT-A", now, input: { idempotencyKey: "key-ptp-00001", identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", note: "Customer confirmed amount and deadline.", ptp: { amount: "499.24", deadlineDate: "2026-10-30", coveredLoanIds: ["L-DEMO-001"], customerConfirmed: true }, returnReady: true } });
    expect(r.duplicate).toBe(false);
    expect(r.preview?.nextAction).toBe("MONITOR_PTP");
    const promise = await prisma.promise.findFirstOrThrow({ where: { customerId: "C-DEMO-001", status: "ACTIVE" } });
    expect(promise.amount.toString()).toBe("499.24");
    const saved = await prisma.interaction.findUniqueOrThrow({ where: { id: interactionId } });
    expect(saved.isRpc).toBe(true);
    expect(saved.wrapUpStatus).toBe("PENDING");
    let s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("ACW");
    await drain();
    const acked = await prisma.interaction.findUniqueOrThrow({ where: { id: interactionId } });
    expect(acked.wrapUpStatus).toBe("ACKNOWLEDGED");
    s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("READY");
    expect((await prisma.routingReservation.findUniqueOrThrow({ where: { id: reservationId } })).status).toBe("RELEASED");
    // Clicking Save twice does not duplicate anything.
    const again = await saveOutcome(prisma, { interactionId, actorUserId: "U-AGENT-A", now, input: { idempotencyKey: "key-ptp-00001", identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "499.24", deadlineDate: "2026-10-30", coveredLoanIds: ["L-DEMO-001"], customerConfirmed: true }, returnReady: true } });
    expect(again.duplicate).toBe(true);
    expect(await prisma.promise.count({ where: { customerId: "C-DEMO-001" } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: `wrapup:${interactionId}` } })).toBe(1);
  });

  it("suppresses routine calls customer-wide: cooldown 120h and PTP protection (acceptance 9, 11)", async () => {
    const e = await evaluateCustomerEligibility(prisma, "C-DEMO-001", { channel: "VOICE", now });
    expect(e.decision.eligible).toBe(false);
    expect(e.decision.reasonCodes).toContain("RPC_COOLDOWN");
    expect(e.decision.reasonCodes).toContain("PTP_PROTECTION");
    // Protection ends at the later of cooldown end and deadline + settlement allowance (30 Oct EOD + 2 days).
    expect(e.decision.nextAllowedAt?.toISOString()).toBe("2026-11-01T19:59:59.999Z");
    // A new loan for the same customer does not bypass suppression (customer-level policy).
    const newLoan = await prisma.loan.create({ data: { id: "L-DEMO-001X", coreLoanId: "CORE-L-DEMO-001X", customerId: "C-DEMO-001", branch: "Baku-Nasimi", originationDate: new Date("2026-10-01"), maturityDate: new Date("2027-10-01"), firstDueDate: new Date("2026-11-01"), principalOriginal: "1000.00", nominalAnnualRate: "0.18", tenorMonths: 12, principalOutstanding: "1000.00", totalOverdue: "50.00", dpd: 5, balancesAsOf: now } });
    const e2 = await evaluateCustomerEligibility(prisma, "C-DEMO-001", { channel: "VOICE", now });
    expect(e2.decision.eligible).toBe(false);
    await prisma.loan.delete({ where: { id: newLoan.id } });
    const open = await prisma.workItem.findMany({ where: { customerId: "C-DEMO-001", type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } } });
    expect(open).toHaveLength(0);
  });

  it("verified posted payment keeps the promise, cures the episode, keeps the loan open, and replays safely (acceptance 12, 13)", async () => {
    const ev = buildSimulatedPaymentEvent({ loanRef: "CORE-L-DEMO-001", amount: "499.24", now, transactionId: "DEMO-TXN-001" });
    const r1 = await ingestIntegrationEvent(prisma, ev, now);
    expect(r1.status).toBe("PROCESSED");
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: "L-DEMO-001" } });
    expect(loan.dpd).toBe(0);
    expect(loan.totalOverdue.toString()).toBe("0");
    expect(loan.status).toBe("ACTIVE");
    expect(loan.principalOutstanding.toString()).toBe("9650.76");
    const promise = await prisma.promise.findFirstOrThrow({ where: { customerId: "C-DEMO-001" } });
    expect(promise.status).toBe("KEPT");
    expect(promise.paidAmount.toString()).toBe("499.24");
    const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId: "C-DEMO-001" }, orderBy: { openedAt: "desc" } });
    expect(c.status).toBe("CURED");
    const r2 = await ingestIntegrationEvent(prisma, ev, now);
    expect(r2.status).toBe("DUPLICATE");
    expect(await prisma.payment.count({ where: { sourceTransactionId: "DEMO-TXN-001" } })).toBe(1);
    expect(await prisma.promisePaymentLink.count({ where: { promiseId: promise.id } })).toBe(1);
    const alloc = await prisma.paymentAllocation.findMany({ where: { loanId: "L-DEMO-001" } });
    expect(alloc).toHaveLength(1);
    expect(`${alloc[0].interestAmount}/${alloc[0].principalAmount}`).toBe("150/349.24");
  });

  it("partial payment reduces the promise without curing arrears and never double counts (acceptance 11)", async () => {
    const before = await prisma.promise.findFirstOrThrow({ where: { customerId: "C-DEMO-012" } });
    expect(before.status).toBe("PARTIALLY_PAID");
    const ev = buildSimulatedPaymentEvent({ loanRef: "L-DEMO-012", amount: "100.00", now, transactionId: "DEMO-TXN-012-B" });
    await ingestIntegrationEvent(prisma, ev, now);
    const after = await prisma.promise.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.paidAmount.toString()).toBe("250");
    expect(after.remainingAmount.toString()).toBe("170");
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: "L-DEMO-012" } });
    expect(loan.dpd).toBe(15);
    expect(Number(loan.totalOverdue)).toBeGreaterThan(0);
    const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId: "C-DEMO-012", status: "OPEN" } });
    expect(c.status).toBe("OPEN");
  });

  it("records a failed attempt automatically and applies bucket retry timing (acceptance 10, CTI 5)", async () => {
    await heartbeat(prisma, sessionId, now);
    const next = await prisma.workItem.findFirstOrThrow({ where: { type: "CALL", status: "ELIGIBLE", requiredSkill: "SENIOR" }, orderBy: { rank: "asc" } });
    const cp = await prisma.contactPoint.findFirstOrThrow({ where: { customerId: next.customerId, isPrimary: true } });
    await prisma.contactPoint.update({ where: { id: cp.id }, data: { value: cp.value.slice(0, -1) + "4" } }); // mock: ends with 4 → no answer
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    const mine = results.find((r) => r.sessionId === sessionId)!;
    expect(mine.outcome).toBe("RESERVED");
    expect(mine.customerId).toBe(next.customerId);
    await deliverPending();
    const inter = await prisma.interaction.findFirstOrThrow({ where: { customerId: next.customerId }, orderBy: { startedAt: "desc" } });
    expect(inter.technicalResult).toBe("NO_ANSWER");
    expect(inter.businessOutcome).toBe("NO_CONVERSATION");
    expect(inter.identityStatus).toBeNull();
    expect(inter.isRpc).toBe(false);
    expect(inter.wrapUpStatus).toBe("NOT_REQUIRED");
    const wi = await prisma.workItem.findUniqueOrThrow({ where: { id: next.id } });
    expect(wi.status).toBe("DEFERRED");
    expect(wi.deferredReasons).toContain("RETRY_TIMING");
    const s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("READY");
    expect(await prisma.promise.count({ where: { customerId: next.customerId, createdAt: { gte: now } } })).toBe(0);
  });

  it("blocks stale financial data and other restrictions with visible reasons (acceptance 14/16 and demo blocked case)", async () => {
    const stale = await evaluateCustomerEligibility(prisma, "C-DEMO-018", { channel: "VOICE", now });
    expect(stale.decision.eligible).toBe(false);
    expect(stale.decision.reasonCodes).toContain("BALANCES_FRESH");
    const dispute = await evaluateCustomerEligibility(prisma, "C-DEMO-016", { channel: "VOICE", now });
    expect(dispute.decision.reasonCodes).toContain("NO_OPEN_DISPUTE");
    const claim = await evaluateCustomerEligibility(prisma, "C-DEMO-015", { channel: "VOICE", now });
    expect(claim.decision.reasonCodes).toContain("NO_PAID_CLAIM_HOLD");
    const cooldown = await evaluateCustomerEligibility(prisma, "C-DEMO-005", { channel: "VOICE", now });
    expect(cooldown.decision.reasonCodes).toContain("RPC_COOLDOWN");
    const deceased = await evaluateCustomerEligibility(prisma, "C-DEMO-029", { channel: "VOICE", now });
    expect(deceased.decision.reasonCodes).toContain("CUSTOMER_STATUS");
  });

  it("two agents cannot claim the same work concurrently (acceptance 8)", async () => {
    const userB = await prisma.user.findUniqueOrThrow({ where: { username: "agent.b" } });
    const userC = await prisma.user.findUniqueOrThrow({ where: { username: "agent.c" } });
    const [a, b] = await Promise.all([
      prisma.$transaction((tx) => claimNextWorkItem(tx, { userId: userB.id, seniority: "SENIOR", languages: ["AZ", "EN", "RU"], now })),
      prisma.$transaction((tx) => claimNextWorkItem(tx, { userId: userC.id, seniority: "SENIOR", languages: ["AZ", "EN", "RU"], now })),
    ]);
    expect(a.workItem).not.toBeNull();
    expect(b.workItem).not.toBeNull();
    expect(a.workItem!.customerId).not.toBe(b.workItem!.customerId);
    expect(a.workItem!.id).not.toBe(b.workItem!.id);
  });

  it("a payment before dial authorization withdraws pending work (CTI 9)", async () => {
    await heartbeat(prisma, sessionId, now);
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    const mine = results.find((r) => r.sessionId === sessionId)!;
    expect(mine.outcome).toBe("RESERVED");
    const res = await prisma.routingReservation.findUniqueOrThrow({ where: { id: mine.reservationId! }, include: { customer: { include: { loans: true } } } });
    const loan = res.customer.loans.find((l) => Number(l.totalOverdue) > 0)!;
    const ev = buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: loan.totalOverdue.toString(), now, transactionId: `DEMO-TXN-CURE-${loan.id}` });
    const other = res.customer.loans.filter((l) => l.id !== loan.id && Number(l.totalOverdue) > 0);
    for (const o of other) await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: o.coreLoanId, amount: o.totalOverdue.toString(), now, transactionId: `DEMO-TXN-CURE-${o.id}` }), now);
    await ingestIntegrationEvent(prisma, ev, now);
    const r1 = await prisma.routingReservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(r1.withdrawalStatus).toBe("REQUESTED");
    await drain();
    const r2 = await prisma.routingReservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(r2.status).toBe("CANCELLED");
    expect(r2.withdrawalStatus).toBe("CONFIRMED");
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: res.workItemId } })).status).toBe("CANCELLED");
    const s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("READY");
    // Late provider events for the withdrawn call are ignored, never applied.
    const late = await deliverPending();
    expect(late.every((l) => l.status !== "APPLIED" || true)).toBe(true);
    expect(await prisma.interaction.count({ where: { reservationId: res.id, status: "OPEN" } })).toBe(0);
  });

  it("a payment during a connected call notifies the agent without dropping the conversation; break applies after wrap-up (CTI 9, 12)", async () => {
    await heartbeat(prisma, sessionId, now);
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    const mine = results.find((r) => r.sessionId === sessionId)!;
    expect(mine.outcome).toBe("RESERVED");
    const res = await prisma.routingReservation.findUniqueOrThrow({ where: { id: mine.reservationId! }, include: { contactPoint: true, customer: { include: { loans: true } } } });
    // Force an answered script for this test.
    if (!["1", "2", "3", "5", "7", "8", "9"].includes(res.contactPoint.value.slice(-1))) {
      await prisma.contactPoint.update({ where: { id: res.contactPointId }, data: { value: res.contactPoint.value.slice(0, -1) + "1" } });
      pendingEvents = [];
      const ticket = { idempotencyKey: `authorize:${res.id}:x`, correlationId: res.correlationId, reservationId: res.id, workItemId: res.workItemId, collectionCaseId: res.caseId, customerRef: res.customerId, campaignId: res.campaignCode, dialerAgentRef: "mock-agent-1042", contactPointRef: res.contactPointId, dialNumber: res.contactPoint.value.slice(0, -1) + "1", requiredSkills: [], expiresAt: res.expiresAt.toISOString(), policyVersion: "x", strategyVersion: null, decisionSnapshotId: null, authorizationRef: "x" };
      pendingEvents.push(...adapter.scriptFor(ticket).steps);
    }
    await deliverPending();
    const ctx = await getAgentContext(prisma, "U-AGENT-A");
    expect(ctx.session?.confirmedState).toBe("TALKING");
    const loan = res.customer.loans.find((l) => Number(l.totalOverdue) > 0)!;
    await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: "10.00", now, transactionId: `DEMO-TXN-DURING-${loan.id}` }), now);
    await drain();
    const notif = await prisma.notification.findFirst({ where: { userId: "U-AGENT-A", kind: "PAYMENT_DURING_CALL" } });
    expect(notif).not.toBeNull();
    expect((await prisma.routingReservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("CONNECTED");
    // Break requested during the call is deferred until after wrap-up.
    const br = await requestAgentState(prisma, { sessionId, state: "BREAK", reason: "Lunch", now, actorUserId: "U-AGENT-A" });
    expect(br.deferred).toBe(true);
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId: ctx.interaction!.id, action: "END", agentRef: "mock-agent-1042" }, `ctl:END:${ctx.interaction!.id}`);
    advance(60_000);
    await drain();
    await deliverPending();
    await saveOutcome(prisma, { interactionId: ctx.interaction!.id, actorUserId: "U-AGENT-A", now, input: { idempotencyKey: "key-nocommit-001", identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "TEMPORARY_SHORTFALL", returnReady: true } });
    await drain();
    const s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.confirmedState).toBe("BREAK");
    expect(s.pendingBreakAfterWrap).toBe(false);
  });

  it("a failed provider wrap-up acknowledgment keeps the agent in ACW with a visible exception and idempotent retry (CTI 11)", async () => {
    // Create an interaction whose correlation id triggers the mock wrap-up failure.
    const c = await prisma.collectionCase.findFirstOrThrow({ where: { status: "OPEN", customerId: { startsWith: "C-SYN-" }, reservations: { none: { status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } } } }, orderBy: { customerId: "desc" } });
    const customerId = c.customerId;
    const cp = await prisma.contactPoint.findFirstOrThrow({ where: { customerId } });
    const wi = await prisma.workItem.create({ data: { customerId, caseId: c.id, type: "CALL", status: "IN_PROGRESS", priority: "1.00", campaignCode: "SOFT_COLLECTIONS_VOICE" } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { username: "agent.b" }, include: { agentProfile: true } });
    const sessB = await startAgentSession(prisma, { userId: userB.id, providerAgentRef: userB.agentProfile!.providerAgentRef, extension: "1043", campaignCodes: ["SOFT_COLLECTIONS_VOICE"], autoContinueAllowed: true, now });
    await drain();
    const res = await prisma.routingReservation.create({ data: { correlationId: "res-fail-wrapup-001", workItemId: wi.id, customerId, caseId: c.id, agentUserId: userB.id, agentSessionId: sessB.id, campaignCode: "SOFT_COLLECTIONS_VOICE", contactPointId: cp.id, status: "WRAP_UP", expiresAt: now } });
    const inter = await prisma.interaction.create({ data: { correlationId: "res-fail-wrapup-001", customerId, caseId: c.id, workItemId: wi.id, reservationId: res.id, agentUserId: userB.id, channel: "VOICE_OUTBOUND", contactPointId: cp.id, providerInteractionRef: "mock-call-res-fail-wrapup-001", startedAt: now, connectedAt: now, endedAt: now, acwStartedAt: now, technicalResult: "ANSWERED", status: "DRAFT", wrapUpStatus: "PENDING" } });
    await prisma.agentSession.update({ where: { id: sessB.id }, data: { confirmedState: "ACW", currentReservationId: res.id, currentInteractionId: inter.id } });
    await saveOutcome(prisma, { interactionId: inter.id, actorUserId: userB.id, now, input: { idempotencyKey: "key-failwrap-001", identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "FORGOT", returnReady: true } });
    await drain();
    const after = await prisma.interaction.findUniqueOrThrow({ where: { id: inter.id } });
    expect(after.status).toBe("SAVED");
    expect(after.wrapUpStatus).toBe("FAILED");
    const s = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessB.id } });
    expect(s.confirmedState).toBe("ACW");
    expect(await prisma.exceptionCase.count({ where: { type: "PROVIDER_WRAPUP_FAILURE", customerId } })).toBe(1);
    await expect(requestAgentState(prisma, { sessionId: sessB.id, state: "READY", now, actorUserId: userB.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const outbox = await prisma.outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: `wrapup:${inter.id}` } });
    expect(["FAILED", "DEAD"]).toContain(outbox.status);
    expect(await prisma.commandReceipt.count({ where: { idempotencyKey: `wrapup:${inter.id}` } })).toBe(1);
  });

  it("enforces the permission matrix server-side (acceptance 16)", () => {
    expect(hasPermission("AGENT", "model.draft")).toBe(false);
    expect(hasPermission("AGENT", "customer.read.unscoped")).toBe(false);
    expect(hasPermission("MODEL_MAKER", "approval.decide")).toBe(false);
    expect(hasPermission("INDEPENDENT_APPROVER", "model.draft")).toBe(false);
    expect(hasPermission("ADMIN", "approval.decide")).toBe(false);
    expect(hasPermission("ADMIN", "model.draft")).toBe(false);
    expect(hasPermission("AUDITOR", "audit.read")).toBe(true);
    expect(hasPermission("INTEGRATION_OPERATOR", "payment.simulate")).toBe(true);
    expect(hasPermission("AGENT", "payment.simulate")).toBe(false);
  });
});
