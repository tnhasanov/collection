import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { readControlState, summarizeControlState, type NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { startAgentSession } from "@/server/modules/dialer/agentSessionService";
import { processOutbox } from "@/server/modules/outbox/processor";
import { requestCallControl, refreshInteractionCommands } from "@/server/modules/dialer/callControlService";
import { hydrateMockAdapter } from "@/server/modules/dialer/providerReconciliation";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { allocateForSession } from "@/server/modules/dialer/routingService";
import { saveOutcome } from "@/server/modules/interactions/outcomeService";
import { createCallbackWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { explainWorkItem } from "@/server/modules/work/eligibilityExplain";
import { agentFollowUps } from "@/server/modules/agent/followUpService";
import { agentDesktopContext } from "@/server/modules/agent/agentDesktopService";
import { addDays, bakuBusinessDate } from "@/server/dates";
import { DEMO_SEED_INSTANT } from "@/server/clock";
import { seedHistoricalCall } from "../../prisma/seed/scenarios";

/**
 * Call lifecycle regressions: an End that is rejected, never answered or never dispatched must not stay "pending"
 * forever; retries get a new attempt key; double clicks do not create a second command; a reload reconciles open
 * commands; RECONCILE applies the provider's end; out-of-order and foreign-leg events never move the call backwards;
 * concurrent outcome saves run once; no dispatch before a completed wrap-up; callback blockers are recomputed live.
 */
let prisma: PrismaClient;
let now = new Date(DEMO_SEED_INSTANT.getTime() + 2 * 3600_000); // 12:00 Baku on the seeded business date
const adapter = new MockDialerAdapter(() => now);
let pendingEvents: { delayMs: number; event: NormalizedProviderEvent }[] = [];
const scheduleEvents = async (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => { pendingEvents.push(...steps); };
async function drain() { for (let i = 0; i < 12; i++) { const n = await processOutbox(prisma, adapter, scheduleEvents, now); if (n === 0) break; } }
let seq = 0;
const used = new Set<string>();
const AGENT = "U-AGENT-E";
let sessionId = "";

async function freshCustomer() {
  const rows = await prisma.collectionCase.findMany({ where: { status: "OPEN", customerId: { startsWith: "C-SYN-", notIn: [...used] }, customer: { status: "ACTIVE", promises: { none: {} }, supportCases: { none: {} }, interactions: { none: {} }, loans: { some: { totalOverdue: { gt: 0 } } } } }, include: { customer: { include: { loans: { where: { status: "ACTIVE" } } } } }, orderBy: { customerId: "desc" }, take: 1 });
  const pick = rows[0];
  if (!pick) throw new Error("No synthetic customer left");
  used.add(pick.customerId);
  await prisma.loan.updateMany({ where: { customerId: pick.customerId }, data: { balancesAsOf: now } });
  return { customerId: pick.customerId, caseId: pick.id, loans: pick.customer.loans };
}
/** A call reserved by AGENT: live (OPEN, connected) or ended (DRAFT, after-call work). */
async function openCall(customerId: string, opts: { live: boolean; corr?: string; withInteraction?: boolean; reservationStatus?: "DIALING" | "CONNECTED" } = { live: true }) {
  await prisma.routingReservation.updateMany({ where: { agentUserId: AGENT, status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } }, data: { status: "RELEASED", releasedAt: now } });
  await prisma.interaction.updateMany({ where: { agentUserId: AGENT, status: { in: ["OPEN", "DRAFT"] } }, data: { status: "ABANDONED" } });
  await prisma.interaction.updateMany({ where: { agentUserId: AGENT, wrapUpStatus: { in: ["PENDING", "FAILED"] } }, data: { wrapUpStatus: "ACKNOWLEDGED" } });
  const c = await prisma.collectionCase.findFirstOrThrow({ where: { customerId, status: { in: ["OPEN", "HANDOVER"] } } });
  const cp = await prisma.contactPoint.findFirstOrThrow({ where: { customerId, type: "MOBILE" } });
  const wi = await prisma.workItem.create({ data: { customerId, caseId: c.id, type: "CALL", status: "IN_PROGRESS", priority: "1.00", campaignCode: "SOFT_COLLECTIONS_VOICE" } });
  const corr = opts.corr ?? `res-life-${++seq}`;
  const res = await prisma.routingReservation.create({ data: { correlationId: corr, workItemId: wi.id, customerId, caseId: c.id, agentUserId: AGENT, agentSessionId: sessionId, campaignCode: "SOFT_COLLECTIONS_VOICE", contactPointId: cp.id, status: opts.reservationStatus ?? (opts.live ? "CONNECTED" : "WRAP_UP"), expiresAt: new Date(now.getTime() + 600_000), authorizationRef: `auth-${corr}` } });
  if (opts.withInteraction === false) return { reservation: res, interaction: null, caseId: c.id, corr };
  const attempt = await prisma.dialAttempt.create({ data: { reservationId: res.id, contactPointId: cp.id, providerAttemptRef: `mock-call-${corr}`, startedAt: new Date(now.getTime() - 200_000), ringingAt: new Date(now.getTime() - 195_000), answeredAt: new Date(now.getTime() - 180_000), bridgedAt: new Date(now.getTime() - 180_000), ...(opts.live ? {} : { endedAt: now, technicalResult: "ANSWERED" as const }) } });
  const i = await prisma.interaction.create({ data: { correlationId: corr, customerId, caseId: c.id, workItemId: wi.id, reservationId: res.id, dialAttemptId: attempt.id, agentUserId: AGENT, channel: "VOICE_OUTBOUND", contactPointId: cp.id, providerInteractionRef: `mock-call-${corr}`, campaignCode: "SOFT_COLLECTIONS_VOICE", startedAt: new Date(now.getTime() - 200_000), connectedAt: new Date(now.getTime() - 180_000), ...(opts.live ? {} : { endedAt: now, acwStartedAt: now, talkSeconds: 180, technicalResult: "ANSWERED" as const }), status: opts.live ? "OPEN" : "DRAFT", wrapUpStatus: "PENDING" } });
  if (opts.live) await hydrateMockAdapter(prisma, adapter);
  return { reservation: res, interaction: i, caseId: c.id, corr };
}
const control = async (id: string) => readControlState((await prisma.interaction.findUniqueOrThrow({ where: { id } })).controlState);
const request = (interactionId: string, action: "END" | "MUTE" | "RECONCILE") => requestCallControl(prisma, { interactionId, userId: AGENT, action, agentRef: "mock-agent-1053", now });

beforeAll(async () => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: AGENT }, include: { agentProfile: true } });
  sessionId = (await startAgentSession(prisma, { userId: AGENT, providerAgentRef: u.agentProfile!.providerAgentRef, extension: u.agentProfile!.extension, campaignCodes: u.agentProfile!.campaignCodes, autoContinueAllowed: true, now })).id;
  await drain();
  await prisma.sourceWatermark.updateMany({ where: { sourceSystem: { in: ["PAYMENT_FEED", "CORE_BANKING"] } }, data: { sourceAsOf: now, lastSuccessfulRunAt: now, health: "HEALTHY" } });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("End command lifecycle and recovery", () => {
  it("a rejected End fails visibly and a retry is dispatched with a new attempt key (the live 'Zəngi bitir…' freeze)", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: true, corr: `res-life-reject-end-${++seq}` });
    const first = await request(interaction!.id, "END");
    expect(first.status).toBe("REQUESTED");
    expect(first.command?.key).toBe(`ctl:END:${interaction!.id}:1`);
    await drain();
    let state = await control(interaction!.id);
    expect(state.commands[0]).toMatchObject({ status: "FAILED", attempt: 1 });
    expect(state.pending).toHaveLength(0);
    expect(summarizeControlState(state, now).unresolved).toBe(true);
    // Before the fix the retry reused "ctl:END:<id>:once", the outbox treated it as a duplicate and it stayed pending forever.
    const retry = await request(interaction!.id, "END");
    expect(retry.command?.key).toBe(`ctl:END:${interaction!.id}:2`);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: { startsWith: `ctl:END:${interaction!.id}:` } } })).toBe(2);
    await drain();
    state = await control(interaction!.id);
    expect(state.commands.map((c) => c.status)).toEqual(["FAILED", "FAILED"]);
    expect(state.pending).toHaveLength(0);
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } })).status).toBe("OPEN"); // never ended by a failure
  });

  it("an End the provider never answers is dead-lettered into FAILED; the call stays open (a timeout alone ends nothing)", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: true, corr: `res-life-unknown-control-${++seq}` });
    await request(interaction!.id, "END");
    for (let i = 0; i < 6; i++) {
      await prisma.outboxMessage.updateMany({ where: { idempotencyKey: `ctl:END:${interaction!.id}:1` }, data: { nextAttemptAt: new Date(0) } });
      await drain();
    }
    const msg = await prisma.outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: `ctl:END:${interaction!.id}:1` } });
    expect(msg.status).toBe("DEAD");
    const state = await control(interaction!.id);
    expect(state.commands[0].status).toBe("FAILED");
    expect(state.commands[0].error).toMatch(/did not answer/);
    expect(await prisma.exceptionCase.count({ where: { dedupKey: `CALL_CONTROL_FAILURE:${interaction!.id}`, status: "OPEN" } })).toBe(1);
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } })).status).toBe("OPEN");
  });

  it("double clicks create one command; a stale accepted End is recovered by RECONCILE from the provider's own end", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: true });
    const [a, b] = await Promise.all([request(interaction!.id, "END"), request(interaction!.id, "END")]);
    expect([a.status, b.status].sort()).toEqual(["DUPLICATE", "REQUESTED"]);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: { startsWith: `ctl:END:${interaction!.id}:` } } })).toBe(1);
    await drain();
    let state = await control(interaction!.id);
    expect(state.commands[0].status).toBe("ACCEPTED"); // provider accepted; the call is NOT ended until call.ended arrives
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } })).status).toBe("OPEN");
    pendingEvents = []; // the provider's call.ended delivery is lost (worker restart)
    now = new Date(now.getTime() + 31_000);
    expect(summarizeControlState(state, now)).toMatchObject({ unresolved: true, end: { stale: true, status: "ACCEPTED" } });
    const rec = await request(interaction!.id, "RECONCILE");
    expect(rec.status).toBe("REQUESTED");
    await drain();
    const after = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } });
    expect(after.status).toBe("DRAFT");
    state = readControlState(after.controlState);
    expect(state.commands.find((c) => c.action === "END")?.status).toBe("COMPLETED");
    expect(state.commands.find((c) => c.action === "RECONCILE")?.status).toBe("COMPLETED");
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } })).confirmedState).toBe("ACW");
  });

  it("a page reload reconciles a pending command that was never dispatched or already rejected", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: true });
    // The record the live system was stuck with: a legacy pending END with the old fixed key and no outbox message.
    await prisma.interaction.update({ where: { id: interaction!.id }, data: { controlState: { muted: false, held: false, pending: [{ action: "END", key: `ctl:END:${interaction!.id}:once`, requestedAt: new Date(now.getTime() - 3600_000).toISOString() }], lastError: null } as never } });
    expect(summarizeControlState(await control(interaction!.id), now).pendingActions).toEqual(["END"]);
    const user = { id: AGENT, username: "agent.e", displayName: "Agent E", role: "AGENT" as const, teamId: null, teamName: null, languages: ["AZ" as const], skills: [], branchScopes: [], seniority: "REGULAR" as const, extension: "1053", providerAgentRef: "mock-agent-1053", mustChangePassword: false, sessionId: "s", sessionExpiresAt: new Date(now.getTime() + 3600_000) };
    const ctx = await agentDesktopContext(prisma, user, now, { full: false });
    expect(ctx.interaction?.controlState.commands[0]).toMatchObject({ status: "FAILED" });
    expect(ctx.interaction?.control.pendingActions).toEqual([]);
    expect(ctx.interaction?.control.unresolved).toBe(true);
    expect(await refreshInteractionCommands(prisma, interaction!.id, now)).toBe(false); // idempotent
  });
});

describe("provider events: correlation and ordering", () => {
  it("call.ended overtaking agent.bridged opens after-call work; late bridged/started events never move the call backwards", async () => {
    const { customerId } = await freshCustomer();
    const { corr } = await openCall(customerId, { live: false, withInteraction: false, reservationStatus: "DIALING" });
    const ref = `mock-call-${corr}`;
    const ev = (eventType: NormalizedProviderEvent["eventType"], payload: Record<string, unknown> = {}, at = now): NormalizedProviderEvent => ({ provider: "MOCK_DIALER", providerEventId: `${ref}:${eventType}`, eventType, occurredAt: at.toISOString(), agentRef: "mock-agent-1053", providerInteractionRef: ref, correlationId: corr, payload });
    await ingestProviderEvent(prisma, ev("attempt.started", {}, new Date(now.getTime() - 20_000)), now, adapter);
    const ended = await ingestProviderEvent(prisma, ev("call.ended", { technicalResult: "ANSWERED", endedBy: "CUSTOMER" }), now, adapter);
    expect(ended.note).toMatch(/after-call work/);
    const i = await prisma.interaction.findUniqueOrThrow({ where: { correlationId: corr } });
    expect(i.status).toBe("DRAFT");
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } })).confirmedState).toBe("ACW");
    const late = await ingestProviderEvent(prisma, ev("agent.bridged", { technicalResult: "ANSWERED" }, new Date(now.getTime() - 5_000)), now, adapter);
    expect(late.note).toMatch(/after the call ended/);
    await ingestProviderEvent(prisma, { ...ev("customer.ringing"), providerEventId: `${ref}:ringing-late` }, now, adapter);
    expect((await prisma.interaction.findUniqueOrThrow({ where: { correlationId: corr } })).status).toBe("DRAFT");
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId } })).confirmedState).toBe("ACW");
    expect((await prisma.routingReservation.findUniqueOrThrow({ where: { correlationId: corr } })).status).toBe("WRAP_UP");
  });

  it("an end event for a different call leg is ignored; the bound call stays open", async () => {
    const { customerId } = await freshCustomer();
    const { interaction, corr } = await openCall(customerId, { live: true });
    const r = await ingestProviderEvent(prisma, { provider: "MOCK_DIALER", providerEventId: `other-leg:${corr}:call.ended`, eventType: "call.ended", occurredAt: now.toISOString(), agentRef: "mock-agent-1053", providerInteractionRef: `other-leg-${corr}`, correlationId: corr, payload: { technicalResult: "ANSWERED" } }, now, adapter);
    expect(r.status).toBe("IGNORED");
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } })).status).toBe("OPEN");
  });
});

describe("outcome submission and dispatch gating", () => {
  it("concurrent saves run once: same key → duplicate, different key → conflict; one promise only", async () => {
    const { customerId, loans } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: false });
    const overdue = loans.filter((l) => Number(l.totalOverdue) > 0);
    const input = (key: string) => ({ idempotencyKey: key, identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: overdue.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2), deadlineDate: addDays(bakuBusinessDate(now), 2), coveredLoanIds: overdue.map((l) => l.id), customerConfirmed: true }, returnReady: true });
    const results = await Promise.allSettled([saveOutcome(prisma, { interactionId: interaction!.id, actorUserId: AGENT, now, input: input(`outcome:${interaction!.id}`) }), saveOutcome(prisma, { interactionId: interaction!.id, actorUserId: AGENT, now, input: input(`outcome:${interaction!.id}`) }), saveOutcome(prisma, { interactionId: interaction!.id, actorUserId: AGENT, now, input: input(`other-key-${interaction!.id}`) })]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof saveOutcome>>>[];
    expect(fulfilled.filter((r) => !r.value.duplicate)).toHaveLength(1);
    expect(await prisma.promise.count({ where: { interactionId: interaction!.id } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { idempotencyKey: `wrapup:${interaction!.id}` } })).toBe(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    for (const r of rejected) expect(String((r.reason as { code?: string }).code ?? r.reason)).toMatch(/CONFLICT|ALREADY_SAVED/);
  });

  it("no next customer is dispatched while the previous interaction is open, unsaved or unacknowledged", async () => {
    const { customerId } = await freshCustomer();
    const { interaction } = await openCall(customerId, { live: false });
    const readyNow = async () => prisma.agentSession.update({ where: { id: sessionId }, data: { isActive: true, confirmedState: "READY", requestedState: "READY", ctiConnected: true, lastHeartbeatAt: now, currentReservationId: null } });
    await prisma.routingReservation.updateMany({ where: { agentUserId: AGENT, status: { in: ["CONNECTED", "WRAP_UP"] } }, data: { status: "RELEASED", releasedAt: now } });
    await readyNow();
    let r = await allocateForSession(prisma, sessionId, now, adapter, scheduleEvents);
    expect(r.outcome).toBe("NOT_ELIGIBLE_AGENT");
    expect(r.reasons).toContain("WRAP_UP_PENDING");
    await saveOutcome(prisma, { interactionId: interaction!.id, actorUserId: AGENT, now, input: { idempotencyKey: `outcome:${interaction!.id}`, identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", returnReady: true } });
    await readyNow();
    r = await allocateForSession(prisma, sessionId, now, adapter, scheduleEvents);
    expect(r.reasons).toContain("WRAP_UP_PENDING"); // saved but the provider has not acknowledged the wrap-up yet
    await drain(); // wrap-up acknowledged
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: interaction!.id } })).wrapUpStatus).toBe("ACKNOWLEDGED");
    await readyNow();
    r = await allocateForSession(prisma, sessionId, now, adapter, scheduleEvents);
    expect(r.reasons ?? []).not.toContain("WRAP_UP_PENDING");
  });
});

describe("callback blockers on the current business clock", () => {
  it("after the due time 'not yet due' disappears; the cooldown is shown with its end, and the item is re-checked at the earliest blocker", async () => {
    const { customerId, caseId } = await freshCustomer();
    const rpcAt = new Date(now.getTime() - 24 * 3600_000);
    await seedHistoricalCall(prisma, { customerId, agentUserId: "U-AGENT-A", at: rpcAt, technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: "NOT_STATED", talkSeconds: 60 });
    const dueAt = new Date(now.getTime() + 3600_000);
    const wi = await createCallbackWorkItem(prisma, { customerId, caseId, dueAt, ownerUserId: AGENT, reason: "AGENT_PROPOSED: confirm plan", language: "AZ", requiredSkill: null, now, actorUserId: AGENT, campaignCode: "SOFT_COLLECTIONS_VOICE" });
    const refreshed = await refreshWorkItemEligibility(prisma, wi.id, now);
    expect(refreshed.deferredReasons).toEqual(expect.arrayContaining(["CALLBACK_DUE", "RPC_COOLDOWN"]));
    expect(refreshed.nextEligibleAt?.toISOString()).toBe(dueAt.toISOString()); // earliest blocker, not the cooldown end
    // Two days later (business clock): the stored reasons are stale, the live explanation is not.
    const later = new Date(now.getTime() + 2 * 24 * 3600_000);
    await prisma.loan.updateMany({ where: { customerId }, data: { balancesAsOf: later } });
    await prisma.sourceWatermark.updateMany({ where: { sourceSystem: "PAYMENT_FEED" }, data: { sourceAsOf: later } });
    const ex = await explainWorkItem(prisma, { ...wi, dueAt }, later, new Date(later.getTime() + 3600_000));
    expect(ex.due).toBe("OVERDUE");
    expect(ex.blockers.map((b) => b.code)).not.toContain("CALLBACK_DUE");
    const cooldown = ex.blockers.find((b) => b.code === "RPC_COOLDOWN");
    const rpc = await prisma.interaction.findFirstOrThrow({ where: { customerId, isRpc: true }, orderBy: { startedAt: "desc" } });
    expect(cooldown?.until?.toISOString()).toBe(new Date((rpc.connectedAt ?? rpc.startedAt).getTime() + 120 * 3600_000).toISOString()); // 120 h from the verified connection
    // A customer-requested callback that is due lifts the cooldown under policy: cooldown is no longer a blocker.
    const cr = await explainWorkItem(prisma, { ...wi, dueAt, reason: "CUSTOMER_REQUESTED: call me back" }, later, later);
    expect(cr.blockers.map((b) => b.code)).not.toContain("RPC_COOLDOWN");
    // The agent's follow-up list (dashboard and Təqib işləri) shows the same live blocker, its end and the next eligible
    // time, and sorts the overdue callback ahead of later items.
    const items = await agentFollowUps(prisma, AGENT, later);
    const row = items.find((i) => i.kind === "CALLBACK" && i.id === wi.id);
    expect(row?.due).toBe("OVERDUE");
    expect(row?.eligible).toBe(false);
    expect(row?.origin).toBe("AGENT_PROPOSED");
    expect(row?.blockers.map((b) => b.code)).toContain("RPC_COOLDOWN");
    expect(row?.blockers.map((b) => b.code)).not.toContain("CALLBACK_DUE");
    expect(row?.nextEligibleAt?.toISOString()).toBe(cooldown?.until?.toISOString());
    const rank = { OVERDUE: 0, TODAY: 1, LATER: 2, NONE: 3 } as const;
    expect(items.every((x, i) => i === 0 || rank[items[i - 1].due] <= rank[x.due])).toBe(true);
    await prisma.sourceWatermark.updateMany({ where: { sourceSystem: "PAYMENT_FEED" }, data: { sourceAsOf: now } });
  });
});
