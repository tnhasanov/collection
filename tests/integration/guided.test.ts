import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import type { NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { startAgentSession } from "@/server/modules/dialer/agentSessionService";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { processOutbox } from "@/server/modules/outbox/processor";
import { computeNextAction, correctOutcome, saveOutcome, summaryContextFor } from "@/server/modules/interactions/outcomeService";
import { buildFactualSummary, NEXT_ACTION_LABELS } from "@/server/modules/interactions/summary";
import { outcomeSchema } from "@/server/modules/interactions/outcomeSchema";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { ingestIntegrationEvent, buildSimulatedPaymentEvent, buildSimulatedReversalEvent } from "@/server/modules/payments/paymentService";
import { DEMO_SEED_INSTANT } from "@/server/clock";

/**
 * Guided conversation scenarios (acceptance pass §2) and automatic consequences (§4) through the real services.
 * Each scenario starts from an ended, answered call (DRAFT interaction) for a distinct synthetic customer.
 */
let prisma: PrismaClient;
const now = new Date(DEMO_SEED_INSTANT.getTime() + 120_000);
const adapter = new MockDialerAdapter(() => now);
const pendingEvents: { delayMs: number; event: NormalizedProviderEvent }[] = [];
const scheduleEvents = async (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => { pendingEvents.push(...steps); };
async function drain() { for (let i = 0; i < 12; i++) { const n = await processOutbox(prisma, adapter, scheduleEvents, now); if (n === 0) break; } }
let sessionId = "";
const AGENT = "U-AGENT-A";
let seq = 0;
const customers: string[] = [];

async function openDraft(customerId: string) {
  const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId, status: { in: ["OPEN", "HANDOVER"] } } });
  const cp = await prisma.contactPoint.findFirstOrThrow({ where: { customerId, type: "MOBILE" } });
  const wi = await prisma.workItem.create({ data: { customerId, caseId: c.id, type: "CALL", status: "IN_PROGRESS", priority: "1.00", campaignCode: "SOFT_COLLECTIONS_VOICE" } });
  const corr = `res-guided-${++seq}`;
  // The reservation is already released (one active reservation per agent is enforced by a partial unique index).
  const res = await prisma.routingReservation.create({ data: { correlationId: corr, workItemId: wi.id, customerId, caseId: c.id, agentUserId: AGENT, agentSessionId: sessionId, campaignCode: "SOFT_COLLECTIONS_VOICE", contactPointId: cp.id, status: "RELEASED", releasedAt: now, expiresAt: now } });
  const i = await prisma.interaction.create({ data: { correlationId: corr, customerId, caseId: c.id, workItemId: wi.id, reservationId: res.id, agentUserId: AGENT, channel: "VOICE_OUTBOUND", contactPointId: cp.id, providerInteractionRef: `mock-call-${corr}`, campaignCode: "SOFT_COLLECTIONS_VOICE", startedAt: new Date(now.getTime() - 200_000), connectedAt: new Date(now.getTime() - 180_000), endedAt: now, acwStartedAt: now, talkSeconds: 180, technicalResult: "ANSWERED", status: "DRAFT", wrapUpStatus: "PENDING" } });
  return { interaction: i, reservation: res, caseId: c.id, contactPointId: cp.id };
}
async function save(interactionId: string, input: Record<string, unknown>) {
  return saveOutcome(prisma, { interactionId, actorUserId: AGENT, now, input: { idempotencyKey: `guided-${interactionId}-${Math.random().toString(36).slice(2, 10)}`, returnReady: true, ...input } });
}
const overdueOf = async (customerId: string) => { const loans = await prisma.loan.findMany({ where: { customerId, status: "ACTIVE" } }); return { loans, total: loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2) }; };

beforeAll(async () => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const u = await prisma.user.findUniqueOrThrow({ where: { username: "agent.a" }, include: { agentProfile: true } });
  sessionId = (await startAgentSession(prisma, { userId: u.id, providerAgentRef: u.agentProfile!.providerAgentRef, extension: u.agentProfile!.extension, campaignCodes: u.agentProfile!.campaignCodes, autoContinueAllowed: true, now })).id;
  await drain();
  const pool = await prisma.collectionCase.findMany({ where: { status: "OPEN", customerId: { startsWith: "C-SYN-" }, customer: { promises: { none: { status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } }, supportCases: { none: {} }, loans: { some: { totalOverdue: { gt: 0 } } } } }, orderBy: { customerId: "asc" }, take: 14, select: { customerId: true } });
  customers.push(...pool.map((p) => p.customerId));
  expect(customers.length).toBeGreaterThanOrEqual(12);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("guided conversation: structured outcomes with honest provenance", () => {
  let fullPtpInteraction = "";
  let partialCustomer = "";
  let partialTxn = "";

  it("verified borrower, full-payment promise: coverage derived, explicit confirmation required, summary matches stored facts", async () => {
    const customerId = customers[0];
    const { interaction } = await openDraft(customerId);
    fullPtpInteraction = interaction.id;
    const { loans, total } = await overdueOf(customerId);
    // "I might pay Friday" cannot become a promise: unconfirmed agreement is refused.
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: total, deadlineDate: "2026-10-30", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: false } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: total, deadlineDate: "2026-10-30", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true } });
    expect(r.preview?.coverage).toBe("FULL");
    expect(r.preview?.derivedOutcome).toBe("PTP");
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.businessOutcome).toBe("PTP");
    expect(stored.isRpc).toBe(true);
    expect(stored.factualSummary).toContain("Borrower verified under the approved procedure.");
    expect(stored.factualSummary).toContain("Customer reported: salary timing (customer-stated)");
    expect(stored.factualSummary).toContain(`Agreed payment: ${total} AZN by 30 Oct 2026 (customer explicitly confirmed); covers the overdue amount in full. Payment pending verification by core banking.`);
    expect(stored.factualSummary).toContain("(bank-verified");
    const promise = await prisma.promise.findFirstOrThrow({ where: { interactionId: interaction.id } });
    expect(promise.status).toBe("ACTIVE");
    expect(promise.amount.toString()).toBe(total);
    expect(promise.customerConfirmed).toBe(true);
    // The generated summary equals a deterministic rebuild from the stored facts (same input → same text).
    const policy = await getContactPolicy(prisma);
    const rebuilt = buildFactualSummary(outcomeSchema.parse({ idempotencyKey: "rebuild-0001", identityStatus: stored.identityStatus, businessOutcome: stored.businessOutcome, nonPaymentReason: stored.nonPaymentReason, ptp: { amount: promise.amount.toString(), deadlineDate: "2026-10-30", coveredLoanIds: promise.coveredLoanIds, customerConfirmed: promise.customerConfirmed }, returnReady: true }), { technicalResult: stored.technicalResult, customer: await summaryContextFor(prisma, customerId), policyVersion: `${policy.code}/${policy.version}`, nextActionLabel: NEXT_ACTION_LABELS[stored.nextAction!], routineCallsBlockedUntil: new Date((stored.nextActionDetail as { routineCallsBlockedUntil: string }).routineCallsBlockedUntil), callbackAt: null, reconciliationHoldUntil: null });
    expect(rebuilt).toBe(stored.factualSummary);
    // Consequence: customer-wide suppression (cooldown + PTP protection) visible with reason codes.
    const el = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now: new Date(now.getTime() + 60_000) });
    expect(el.decision.eligible).toBe(false);
    expect(el.decision.reasonCodes).toEqual(expect.arrayContaining(["RPC_COOLDOWN", "PTP_PROTECTION"]));
  });

  it("partial-payment promise: derived PARTIAL_COMMITMENT; a kept partial promise coexists with residual arrears (no cure)", async () => {
    const customerId = customers[1];
    partialCustomer = customerId;
    const { interaction } = await openDraft(customerId);
    const { loans, total } = await overdueOf(customerId);
    const half = (Math.floor((Number(total) / 2) * 100) / 100).toFixed(2);
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "TEMPORARY_SHORTFALL", ptp: { amount: half, deadlineDate: "2026-10-29", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true } });
    expect(r.preview?.coverage).toBe("PARTIAL");
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.businessOutcome).toBe("PARTIAL_COMMITMENT");
    expect(stored.factualSummary).toContain("partial; residual arrears remain");
    // Verified partial payment keeps the promise but does not cure the case.
    const loan = loans.find((l) => Number(l.totalOverdue) > 0)!;
    partialTxn = `GUIDED-PARTIAL-${loan.id}`;
    const res = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: half, now, transactionId: partialTxn }), now);
    expect(res.status).toBe("PROCESSED");
    const promise = await prisma.promise.findFirstOrThrow({ where: { interactionId: interaction.id } });
    expect(Number(promise.paidAmount)).toBeCloseTo(Number(half), 2);
    expect(["KEPT", "ACTIVE", "PARTIALLY_PAID"]).toContain(promise.status);
    expect(Number(promise.remainingAmount)).toBeLessThanOrEqual(0.0001);
    const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId, status: { in: ["OPEN", "CURED"] } }, orderBy: { openedAt: "desc" } });
    expect(c.status).toBe("OPEN");
    const after = await overdueOf(customerId);
    expect(Number(after.total)).toBeGreaterThan(0);
  });

  it("no commitment: 'might pay Friday' is stored as a customer statement, never a promise; reason may be 'not stated'", async () => {
    const customerId = customers[2];
    const { interaction } = await openDraft(customerId);
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", customerStatement: { indicativePaymentDate: "2026-10-30", text: "might pay Friday" } });
    expect(r.preview?.nextAction).toBe("COOLDOWN");
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.businessOutcome).toBe("NO_COMMITMENT");
    expect((stored.customerStatement as { text: string }).text).toBe("might pay Friday");
    expect(stored.factualSummary).toContain("Reason not stated by the customer.");
    expect(stored.factualSummary).toContain("No payment commitment made.");
    expect(stored.factualSummary).toContain('possible payment around 30 Oct 2026 "might pay Friday" (customer-stated, not a commitment; no promise created)');
    expect(await prisma.promise.count({ where: { interactionId: interaction.id } })).toBe(0);
    // A statement cannot ride on a confirmed promise.
    const { interaction: i2 } = await openDraft(customers[3]);
    const { loans, total } = await overdueOf(customers[3]);
    await expect(save(i2.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "FORGOT", ptp: { amount: total, deadlineDate: "2026-10-30", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true }, customerStatement: { indicativePaymentDate: "2026-11-02" } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("requested callback: scheduled under policy with a named owner; permitted-time adjustment is explicit", async () => {
    const customerId = customers[4];
    const { interaction } = await openDraft(customerId);
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "CALLBACK_REQUESTED", nonPaymentReason: "SALARY_TIMING" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "CALLBACK_REQUESTED", nonPaymentReason: "SALARY_TIMING", callback: { dueAt: "2026-10-28T07:00:00.000Z", customerRequested: true, ownerMode: "ME" } });
    expect(r.preview?.nextAction).toBe("ELIGIBLE_CALLBACK");
    const wi = await prisma.workItem.findFirstOrThrow({ where: { customerId, type: "CALLBACK", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } });
    expect(wi.ownerUserId).toBe(AGENT);
    expect(wi.dueAt?.toISOString()).toBe("2026-10-28T07:00:00.000Z");
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.factualSummary).toContain("Customer requested a callback for 28 Oct 2026, 11:00");
    // A callback outside permitted hours is moved to the next permitted time and the adjustment is reported, not hidden.
    const { interaction: i2 } = await openDraft(customers[5]);
    const r2 = await save(i2.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "CALLBACK_REQUESTED", nonPaymentReason: "FORGOT", callback: { dueAt: "2026-10-28T19:30:00.000Z", customerRequested: true, ownerMode: "POOL" } });
    expect(r2.preview?.warnings.some((e) => e.startsWith("Requested callback time is outside"))).toBe(true);
    expect(r2.preview?.errors ?? []).toHaveLength(0);
    expect(r2.preview?.callbackAt?.toISOString()).not.toBe("2026-10-28T19:30:00.000Z");
  });

  it("already-paid claim stays a claim: reconciliation task, temporary hold, balances untouched", async () => {
    const customerId = customers[6];
    const { interaction } = await openDraft(customerId);
    const before = await overdueOf(customerId);
    const paymentsBefore = await prisma.payment.count({ where: { customerId } });
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "ALREADY_PAID_CLAIM", nonPaymentReason: "TECHNICAL_PAYMENT_ISSUE" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "ALREADY_PAID_CLAIM", nonPaymentReason: "TECHNICAL_PAYMENT_ISSUE", paidClaim: { amount: "120.00", date: "2026-10-26", channel: "ATB mobile" } });
    expect(r.preview?.nextAction).toBe("RECONCILE_CLAIM");
    const claim = await prisma.paymentClaim.findFirstOrThrow({ where: { interactionId: interaction.id } });
    expect(claim.status).toBe("OPEN");
    expect(await prisma.workItem.count({ where: { customerId, type: "RECONCILIATION", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } })).toBe(1);
    expect(await prisma.exceptionCase.count({ where: { type: "CLAIMED_ALREADY_PAID", customerId } })).toBe(1);
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.factualSummary).toContain("Customer claims a payment of 120.00 AZN on 26 Oct 2026 via ATB mobile (customer-stated, not verified); reconciliation opened");
    const after = await overdueOf(customerId);
    expect(after.total).toBe(before.total);
    expect(await prisma.payment.count({ where: { customerId } })).toBe(paymentsBefore); // a claim never creates a posting
    const el = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now: new Date(now.getTime() + 60_000) });
    expect(el.decision.reasonCodes).toContain("NO_PAID_CLAIM_HOLD");
  });

  it("third-party answer: no borrower outcome allowed, no cooldown; wrong number blocks the contact point", async () => {
    const customerId = customers[7];
    const { interaction } = await openDraft(customerId);
    await expect(save(interaction.id, { identityStatus: "THIRD_PARTY", businessOutcome: "PTP", ptp: { amount: "10.00", deadlineDate: "2026-10-30", coveredLoanIds: ["x"], customerConfirmed: true } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await save(interaction.id, { identityStatus: "THIRD_PARTY", businessOutcome: "NO_CONVERSATION" });
    const stored = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    expect(stored.isRpc).toBe(false);
    expect(stored.factualSummary).toContain("Third party; no verified borrower contact.");
    const el = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now: new Date(now.getTime() + 4 * 3600_000) });
    expect(el.decision.reasonCodes).not.toContain("RPC_COOLDOWN");
    // Wrong number
    const customer2 = customers[8];
    const { interaction: i2, contactPointId } = await openDraft(customer2);
    await expect(save(i2.id, { identityStatus: "WRONG_NUMBER", businessOutcome: "NO_CONVERSATION" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r2 = await save(i2.id, { identityStatus: "WRONG_NUMBER", businessOutcome: "NO_CONVERSATION", wrongNumber: { contactPointId } });
    expect(r2.preview?.nextAction).toBe("CONTACT_CORRECTION");
    const cp = await prisma.contactPoint.findUniqueOrThrow({ where: { id: contactPointId } });
    expect(cp.verification).toBe("INVALID");
    expect(cp.invalidReason).toBe("WRONG_NUMBER");
    expect(await prisma.exceptionCase.count({ where: { type: "WRONG_NUMBER", customerId: customer2 } })).toBe(1);
    const el2 = await evaluateCustomerEligibility(prisma, customer2, { channel: "VOICE", now, contactPointId });
    expect(el2.decision.eligible).toBe(false);
  });

  it("dispute and repayment-support referral create owned tasks, holds and restrictions; independent flags keep facts", async () => {
    const disputeCustomer = customers[9];
    const { interaction } = await openDraft(disputeCustomer);
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "DISPUTE", nonPaymentReason: "DISPUTED_DEBT" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "DISPUTE", nonPaymentReason: "DISPUTED_DEBT", dispute: { reason: "Installment amount disputed" } });
    expect(await prisma.supportCase.count({ where: { customerId: disputeCustomer, type: "DISPUTE", status: "OPEN" } })).toBe(1);
    expect(await prisma.workItem.count({ where: { customerId: disputeCustomer, type: "DISPUTE_REVIEW", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } })).toBe(1);
    expect((await evaluateCustomerEligibility(prisma, disputeCustomer, { channel: "VOICE", now: new Date(now.getTime() + 60_000) })).decision.reasonCodes).toContain("NO_OPEN_DISPUTE");
    const supportCustomer = customers[10];
    const { interaction: i2 } = await openDraft(supportCustomer);
    await save(i2.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "SUPPORT_NEEDED", nonPaymentReason: "INCOME_INTERRUPTION", support: { type: "HARDSHIP", reason: "Job loss; requests reduced plan" } });
    const sc = await prisma.supportCase.findFirstOrThrow({ where: { customerId: supportCustomer, type: "HARDSHIP" } });
    expect(sc.restrictsCalls).toBe(true);
    expect(sc.restrictionUntil).not.toBeNull();
    expect(await prisma.workItem.count({ where: { customerId: supportCustomer, type: "SUPPORT_REVIEW", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } })).toBe(1);
    expect((await evaluateCustomerEligibility(prisma, supportCustomer, { channel: "VOICE", now: new Date(now.getTime() + 60_000) })).decision.reasonCodes).toContain("NO_SUPPORT_HOLD");
    // Independent flag alongside a promise: a short factual note is required; the promise stays and a follow-up task is created.
    const flagCustomer = customers[11];
    const { interaction: i3 } = await openDraft(flagCustomer);
    const { loans, total } = await overdueOf(flagCustomer);
    await expect(save(i3.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "AFFORDABILITY", ptp: { amount: total, deadlineDate: "2026-10-31", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true }, secondaryFlags: ["SUPPORT_REFERRAL_REQUESTED"] })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const r3 = await save(i3.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "AFFORDABILITY", note: "Asked about a reduced plan after this payment", ptp: { amount: total, deadlineDate: "2026-10-31", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true }, secondaryFlags: ["SUPPORT_REFERRAL_REQUESTED"] });
    expect(r3.effects?.promiseId).toBeTruthy();
    expect(r3.effects?.supportFollowUpWorkItemId).toBeTruthy();
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: i3.id } })).factualSummary).toContain("Also noted: repayment-support follow-up requested.");
  });

  it("required details are enforced server-side and the same facts always produce the same decision", async () => {
    const { interaction } = await openDraft(customers[12]);
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "OTHER" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT" })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    const policy = await getContactPolicy(prisma);
    const input = outcomeSchema.parse({ idempotencyKey: "determinism-0001", identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", returnReady: true });
    const ctx = { now, policy, technicalResult: "ANSWERED", customer: await summaryContextFor(prisma, customers[12]) };
    const a = computeNextAction(input, ctx);
    const b = computeNextAction(input, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const r = await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED" });
    expect(r.preview?.factualSummary).toBe(a.factualSummary);
    // Duplicate final save: same key = no effect; different key after save = audited correction required.
    const dup = await saveOutcome(prisma, { interactionId: interaction.id, actorUserId: AGENT, now, input: { idempotencyKey: (await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } })).idempotencyKey, identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", returnReady: true } });
    expect(dup.duplicate).toBe(true);
    await expect(save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "PTP" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("consequences: customer-wide restrictions across loans, numbers and campaigns; corrections re-evaluate policy and reconcile the provider", async () => {
    // Two-loan customer: RPC on one call suppresses every loan, number and campaign.
    const { interaction } = await openDraft("C-DEMO-007");
    await save(interaction.id, { identityStatus: "RPC_VERIFIED", businessOutcome: "REFUSED", nonPaymentReason: "NOT_STATED" });
    const contacts = await prisma.contactPoint.findMany({ where: { customerId: "C-DEMO-007" } });
    for (const cp of contacts) {
      const el = await evaluateCustomerEligibility(prisma, "C-DEMO-007", { channel: "VOICE", now: new Date(now.getTime() + 60_000), contactPointId: cp.id, campaignCode: "ANOTHER_CAMPAIGN" });
      expect(el.decision.reasonCodes).toContain("RPC_COOLDOWN");
    }
    // Correction of the full promise (scenario 1) to "no commitment": promise cancelled, PTP protection gone, provider disposition corrected.
    const { interaction: corrected, effects } = await correctOutcome(prisma, { interactionId: fullPtpInteraction, actorUserId: "U-LEAD", reason: "Customer called back and withdrew the promise", changes: { businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED" }, now });
    expect(corrected.status).toBe("CORRECTED");
    expect(effects.promisesCancelled).toBe(1);
    expect(effects.providerWrapUpCorrectionQueued).toBe(true);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: { startsWith: `wrapup-correction:${fullPtpInteraction}` } } })).toBe(1);
    const el = await evaluateCustomerEligibility(prisma, customers[0], { channel: "VOICE", now: new Date(now.getTime() + 60_000) });
    expect(el.decision.reasonCodes).toContain("RPC_COOLDOWN");
    expect(el.decision.reasonCodes).not.toContain("PTP_PROTECTION");
    expect(await prisma.outcomeCorrection.count({ where: { interactionId: fullPtpInteraction } })).toBe(1);
  });

  it("consequences: provider recycle of withdrawn work is refused, reversals reopen arrears, stale balances block amount-specific outreach", async () => {
    // Provider recycle: an attempt on a withdrawn reservation never becomes a live contact.
    const { reservation } = await openDraft(customers[13]);
    await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED", withdrawalStatus: "CONFIRMED" } });
    const r = await ingestProviderEvent(prisma, { provider: "MOCK_DIALER", providerEventId: `recycle-${reservation.correlationId}`, eventType: "attempt.started", occurredAt: now.toISOString(), correlationId: reservation.correlationId, providerInteractionRef: `mock-call-${reservation.correlationId}-recycle`, agentRef: "mock-agent-1042", payload: {} }, now, adapter);
    expect(r.status).toBe("IGNORED");
    expect(r.note).toContain("Unauthorized provider attempt");
    expect(await prisma.exceptionCase.count({ where: { dedupKey: `UNAUTHORIZED_ATTEMPT:${reservation.id}` } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: `ctl:END:unauthorized:${reservation.correlationId}` } })).toBe(1);
    expect(await prisma.interaction.count({ where: { reservationId: reservation.id, status: "OPEN" } })).toBe(0);
    // Reversal of the partial payment reopens the arrears and reverses the promise credit, with history.
    const promiseBefore = await prisma.promise.findFirstOrThrow({ where: { customerId: partialCustomer } });
    const rev = await ingestIntegrationEvent(prisma, buildSimulatedReversalEvent({ originalTransactionId: partialTxn, now, loanRef: null }), now);
    expect(rev.status).toBe("PROCESSED");
    const promiseAfter = await prisma.promise.findUniqueOrThrow({ where: { id: promiseBefore.id } });
    expect(Number(promiseAfter.paidAmount)).toBe(0);
    expect(await prisma.promisePaymentLink.count({ where: { promiseId: promiseBefore.id, reversed: true } })).toBe(1);
    expect(await prisma.payment.count({ where: { sourceTransactionId: partialTxn, status: "REVERSED" } })).toBe(1);
    // Stale balances block amount-specific outreach with a visible reason.
    const staleCustomer = customers[12];
    await prisma.loan.updateMany({ where: { customerId: staleCustomer }, data: { balancesAsOf: new Date(now.getTime() - 2 * 3600_000) } });
    const el = await evaluateCustomerEligibility(prisma, staleCustomer, { channel: "VOICE", now: new Date(now.getTime() + 6 * 86400_000) });
    expect(el.decision.reasonCodes).toContain("BALANCES_FRESH");
  });
});
