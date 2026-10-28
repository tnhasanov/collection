import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import type { NormalizedProviderEvent, RoutingTicket } from "@/server/modules/dialer/contract";
import { startAgentSession, requestAgentState, heartbeat, getAgentContext } from "@/server/modules/dialer/agentSessionService";
import { allocateForReadyAgents, allocateForSession } from "@/server/modules/dialer/routingService";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { processOutbox } from "@/server/modules/outbox/processor";
import { saveDraft, saveOutcome } from "@/server/modules/interactions/outcomeService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { maturePromises } from "@/server/modules/promises/promiseService";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { DEMO_SEED_INSTANT } from "@/server/clock";

/**
 * Collection-floor simulation (acceptance pass §1): six agents (two senior, four regular) become Ready
 * concurrently against the seeded synthetic portfolio and the deterministic mock dialer. The injectable clock
 * (`now`) is advanced explicitly instead of waiting in real time.
 */
let prisma: PrismaClient;
let now = new Date(DEMO_SEED_INSTANT.getTime() + 60_000); // 27 Oct 2026 10:01 Baku
const adapter = new MockDialerAdapter(() => now);
let pendingEvents: { delayMs: number; event: NormalizedProviderEvent }[] = [];
const scheduleEvents = async (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => { pendingEvents.push(...steps); };
const advance = (ms: number) => { now = new Date(now.getTime() + ms); };
async function drain() { for (let i = 0; i < 12; i++) { const n = await processOutbox(prisma, adapter, scheduleEvents, now); if (n === 0) break; } }
async function deliverPending() {
  const steps = [...pendingEvents].sort((a, b) => a.delayMs - b.delayMs);
  pendingEvents = [];
  const results = [];
  let elapsed = 0;
  for (const s of steps) { if (s.delayMs > elapsed) { advance(s.delayMs - elapsed); elapsed = s.delayMs; } adapter.applyEvent(s.event); results.push({ correlationId: s.event.correlationId, type: s.event.eventType, ...(await ingestProviderEvent(prisma, { ...s.event, occurredAt: now.toISOString() }, now, adapter)) }); }
  return results;
}
const AGENTS = ["agent.a", "agent.b", "agent.c", "agent.d", "agent.e", "agent.f"];
const sessions = new Map<string, { sessionId: string; userId: string; seniority: string; agentRef: string }>();
let ptpCustomerId = "";

beforeAll(async () => { prisma = createPrismaClient(process.env.TEST_DATABASE_URL); });
afterAll(async () => { await prisma.$disconnect(); });

describe("collection floor: concurrent agents, routing and state preservation", () => {
  it("six agents connect and become provider-confirmed Ready concurrently", async () => {
    for (const username of AGENTS) {
      const u = await prisma.user.findUniqueOrThrow({ where: { username }, include: { agentProfile: true } });
      const s = await startAgentSession(prisma, { userId: u.id, providerAgentRef: u.agentProfile!.providerAgentRef, extension: u.agentProfile!.extension, campaignCodes: u.agentProfile!.campaignCodes, autoContinueAllowed: true, now });
      sessions.set(username, { sessionId: s.id, userId: u.id, seniority: u.agentProfile!.seniority, agentRef: u.agentProfile!.providerAgentRef! });
    }
    await drain();
    for (const { sessionId, userId } of sessions.values()) await requestAgentState(prisma, { sessionId, state: "READY", now, actorUserId: userId });
    await drain();
    const confirmed = await prisma.agentSession.findMany({ where: { id: { in: [...sessions.values()].map((s) => s.sessionId) } } });
    expect(confirmed.every((s) => s.confirmedState === "READY" && s.ctiConnected)).toBe(true);
    expect(sessions.size).toBe(6);
    expect([...sessions.values()].filter((s) => s.seniority === "SENIOR").length).toBe(2);
  });

  it("allocates one customer per agent, one reservation per customer across campaigns, and respects seniority", async () => {
    for (const { sessionId } of sessions.values()) await heartbeat(prisma, sessionId, now);
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    const reserved = results.filter((r) => r.outcome === "RESERVED");
    expect(reserved.length).toBe(6);
    const customers = reserved.map((r) => r.customerId);
    expect(new Set(customers).size).toBe(6);
    const active = await prisma.routingReservation.findMany({ where: { status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } }, include: { workItem: true } });
    expect(active.length).toBe(6);
    expect(new Set(active.map((r) => r.agentUserId)).size).toBe(6);
    expect(new Set(active.map((r) => r.customerId)).size).toBe(6);
    for (const r of active) {
      const agent = [...sessions.values()].find((s) => s.userId === r.agentUserId)!;
      if (agent.seniority !== "SENIOR") expect(r.workItem.requiredSkill).not.toBe("SENIOR");
      // A second campaign cannot reserve the same customer while this reservation is active.
      await expect(prisma.routingReservation.create({ data: { correlationId: `dup-${r.id}`, workItemId: r.workItemId, customerId: r.customerId, caseId: r.caseId, agentUserId: "U-LEAD", campaignCode: "OTHER_CAMPAIGN", contactPointId: r.contactPointId, status: "PENDING", expiresAt: now } })).rejects.toThrow();
    }
    // A second allocation round gives nobody a second reservation.
    const again = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    expect(again.filter((r) => r.outcome === "RESERVED").length).toBe(0);
    for (const { sessionId } of sessions.values()) expect((await allocateForSession(prisma, sessionId, now, adapter, scheduleEvents)).outcome).toBe("NOT_ELIGIBLE_AGENT");
  });

  it("delivers provider events: answered calls open exactly one interaction per agent with the right customer and script; no-answer attempts complete with zero agent entry", async () => {
    // Force one regular agent's call to be a provider no-answer so the zero-entry path is exercised deterministically.
    const regular = [...sessions.values()].find((s) => s.seniority !== "SENIOR")!;
    const target = await prisma.routingReservation.findFirstOrThrow({ where: { agentUserId: regular.userId, status: { in: ["PENDING", "AUTHORIZED", "DIALING"] } }, include: { contactPoint: true } });
    pendingEvents = pendingEvents.filter((p) => p.event.correlationId !== target.correlationId);
    const ticket: RoutingTicket = { idempotencyKey: `authorize:${target.id}:noanswer`, correlationId: target.correlationId, reservationId: target.id, workItemId: target.workItemId, collectionCaseId: target.caseId, customerRef: target.customerId, campaignId: target.campaignCode, dialerAgentRef: regular.agentRef, contactPointRef: target.contactPointId, dialNumber: target.contactPoint.value.slice(0, -1) + "4", requiredSkills: [], expiresAt: target.expiresAt.toISOString(), policyVersion: "x", strategyVersion: null, decisionSnapshotId: null, authorizationRef: "x" };
    pendingEvents.push(...adapter.scriptFor(ticket).steps);
    const delivered = await deliverPending();
    expect(delivered.filter((d) => d.status === "APPLIED").length).toBeGreaterThan(0);

    // Zero-entry no-answer: auto-saved NO_CONVERSATION with the provider result, no identity, agent back to Ready.
    const auto = await prisma.interaction.findFirstOrThrow({ where: { reservationId: target.id } });
    expect(auto.status).toBe("SAVED");
    expect(auto.businessOutcome).toBe("NO_CONVERSATION");
    expect(auto.technicalResult).toBe("NO_ANSWER");
    expect(auto.identityStatus).toBeNull();
    expect(auto.wrapUpStatus).toBe("NOT_REQUIRED");
    const regularSession = await prisma.agentSession.findUniqueOrThrow({ where: { id: regular.sessionId } });
    expect(regularSession.confirmedState).toBe("READY");
    const wi = await prisma.workItem.findUniqueOrThrow({ where: { id: target.workItemId } });
    expect(["QUEUED", "DEFERRED", "ELIGIBLE"]).toContain(wi.status);

    // Every other agent: at most one OPEN interaction, bound to its reservation's customer, with a script.
    for (const s of sessions.values()) {
      if (s.userId === regular.userId) continue;
      const open = await prisma.interaction.findMany({ where: { agentUserId: s.userId, status: "OPEN" }, include: { reservation: true } });
      expect(open.length).toBeLessThanOrEqual(1);
      if (open.length === 1) {
        const ctx = await getAgentContext(prisma, s.userId);
        expect(ctx.session?.confirmedState).toBe("TALKING");
        expect(ctx.interaction?.id).toBe(open[0].id);
        expect(open[0].customerId).toBe(open[0].reservation!.customerId);
        expect(open[0].identityStatus).toBeNull(); // answered ≠ verified
        const customer = await prisma.customer.findUniqueOrThrow({ where: { id: open[0].customerId } });
        const script = await prisma.template.findUniqueOrThrow({ where: { id: open[0].scriptVersionId! } });
        expect(script.kind).toBe("AGENT_SCRIPT");
        expect([customer.language, "EN"]).toContain(script.language);
        expect((await allocateForSession(prisma, s.sessionId, now, adapter, scheduleEvents)).outcome).toBe("NOT_ELIGIBLE_AGENT");
      }
    }
  });

  it("required wrap-up and failed saves keep the agent out of the pool; refresh and reconnect preserve the call and draft", async () => {
    const talking = await prisma.interaction.findFirstOrThrow({ where: { status: "OPEN", channel: "VOICE_OUTBOUND" }, include: { reservation: true } });
    const agent = [...sessions.values()].find((s) => s.userId === talking.agentUserId)!;
    // Draft captured during the call survives a "refresh": the backend holds it.
    await saveDraft(prisma, { interactionId: talking.id, actorUserId: agent.userId, now, draft: { idempotencyKey: `draft-${talking.id}`, identityStatus: "RPC_VERIFIED", nonPaymentReason: "SALARY_TIMING" } });
    const refreshed = await getAgentContext(prisma, agent.userId);
    expect(refreshed.interaction?.id).toBe(talking.id);
    expect((refreshed.interaction?.draftJson as { identityStatus?: string }).identityStatus).toBe("RPC_VERIFIED");
    // CTI disconnect: allocation paused, state restored from the provider on recovery (still talking).
    await ingestProviderEvent(prisma, { provider: "MOCK_DIALER", providerEventId: `conn-lost-${agent.sessionId}`, eventType: "provider.connectivity.lost", occurredAt: now.toISOString(), agentRef: agent.agentRef, payload: {} }, now, adapter);
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: agent.sessionId } })).confirmedState).toBe("CONNECTION_PROBLEM");
    await ingestProviderEvent(prisma, { provider: "MOCK_DIALER", providerEventId: `conn-back-${agent.sessionId}`, eventType: "provider.connectivity.recovered", occurredAt: now.toISOString(), agentRef: agent.agentRef, payload: {} }, now, adapter);
    const restored = await prisma.agentSession.findUniqueOrThrow({ where: { id: agent.sessionId } });
    expect(restored.confirmedState).toBe("TALKING");
    expect((await getAgentContext(prisma, agent.userId)).interaction?.id).toBe(talking.id);
    // Break requested during the call is deferred until the required wrap-up.
    expect((await requestAgentState(prisma, { sessionId: agent.sessionId, state: "BREAK", reason: "Break", now, actorUserId: agent.userId })).deferred).toBe(true);
    // End the call → ACW; Ready is refused until saved and acknowledged; a stale "Ready" cannot authorize another call.
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId: talking.id, action: "END", agentRef: agent.agentRef }, `ctl:END:${talking.id}`);
    advance(90_000);
    await drain();
    await deliverPending();
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: agent.sessionId } })).confirmedState).toBe("ACW");
    await expect(requestAgentState(prisma, { sessionId: agent.sessionId, state: "READY", now, actorUserId: agent.userId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await allocateForSession(prisma, agent.sessionId, now, adapter, scheduleEvents)).outcome).toBe("NOT_ELIGIBLE_AGENT");
    // A failed save (promise without explicit customer confirmation) changes nothing.
    await expect(saveOutcome(prisma, { interactionId: talking.id, actorUserId: agent.userId, now, input: { idempotencyKey: "floor-fail-0001", identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "50.00", deadlineDate: "2026-10-28", coveredLoanIds: [talking.customerId], customerConfirmed: false }, returnReady: true } })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: talking.id } })).status).toBe("DRAFT");
    expect((await prisma.agentSession.findUniqueOrThrow({ where: { id: agent.sessionId } })).confirmedState).toBe("ACW");
    // Valid save → provider wrap-up acknowledged → the deferred break applies instead of Ready.
    const loans = await prisma.loan.findMany({ where: { customerId: talking.customerId, status: "ACTIVE" } });
    const r = await saveOutcome(prisma, { interactionId: talking.id, actorUserId: agent.userId, now, input: { idempotencyKey: "floor-ok-0001", identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2), deadlineDate: "2026-10-28", coveredLoanIds: loans.map((l) => l.id), customerConfirmed: true }, returnReady: true } });
    expect(r.preview?.coverage).toBe("FULL");
    await drain();
    const after = await prisma.agentSession.findUniqueOrThrow({ where: { id: agent.sessionId } });
    expect(after.confirmedState).toBe("BREAK");
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: talking.id } })).wrapUpStatus).toBe("ACKNOWLEDGED");
    // Stale browser heartbeat blocks allocation even for a Ready agent.
    const other = [...sessions.values()].find((s) => s.userId !== agent.userId)!;
    const otherSession = await prisma.agentSession.findUniqueOrThrow({ where: { id: other.sessionId } });
    if (otherSession.confirmedState === "READY") {
      expect((await allocateForSession(prisma, other.sessionId, new Date(now.getTime() + 120_000), adapter, scheduleEvents)).reasons).toContain("BROWSER_HEARTBEAT_STALE");
    }
    ptpCustomerId = talking.customerId;
  });

  it("advancing the injectable clock releases the cooldown and matures the promise without real waiting", async () => {
    const customerId = ptpCustomerId || (await prisma.promise.findFirstOrThrow({ where: { status: "ACTIVE", createdByUserId: { startsWith: "U-AGENT-" }, createdAt: { gte: new Date(Date.now() - 600_000) } }, orderBy: { createdAt: "desc" } })).customerId;
    const blocked = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now });
    expect(blocked.decision.eligible).toBe(false);
    expect(blocked.decision.reasonCodes).toEqual(expect.arrayContaining(["RPC_COOLDOWN", "PTP_PROTECTION"]));
    // Monday 2 Nov 2026 10:05 Baku: cooldown (120 h) and PTP protection (deadline 28 Oct + 2 days) have elapsed.
    const later = new Date("2026-11-02T06:05:00Z");
    // Fresh balances and payment feed at the new time (the demo feed is simulated by the watermark).
    await prisma.loan.updateMany({ where: { customerId }, data: { balancesAsOf: later } });
    await prisma.sourceWatermark.updateMany({ where: { sourceSystem: { in: ["PAYMENT_FEED", "CORE_BANKING"] } }, data: { sourceAsOf: later, lastSuccessfulRunAt: later, health: "HEALTHY" } });
    const released = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now: later });
    expect(released.decision.reasonCodes).not.toContain("RPC_COOLDOWN");
    expect(released.decision.reasonCodes).not.toContain("PTP_PROTECTION");
    // Promise maturation at the advanced clock: unpaid promise becomes BROKEN once the feed covers the window.
    const promise = await prisma.promise.findFirstOrThrow({ where: { customerId, status: "ACTIVE" } });
    const matured = await maturePromises(prisma, later);
    expect(matured.find((m) => m.id === promise.id)?.status).toBe("BROKEN");
    expect((await prisma.promise.findUniqueOrThrow({ where: { id: promise.id } })).status).toBe("BROKEN");
  });
});
