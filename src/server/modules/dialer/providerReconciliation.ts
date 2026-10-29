import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { ConfirmedAgentState, DialerAdapter, NormalizedProviderEvent, ProviderInteraction } from "@/server/modules/dialer/contract";
import { readControlState } from "@/server/modules/dialer/contract";
import { MOCK_PROVIDER, MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { applyConfirmedState } from "@/server/modules/dialer/agentSessionService";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * Provider state reconciliation.
 *
 * 1. hydrateMockAdapter: after a worker restart the mock provider's in-memory view is rebuilt from persisted
 *    application facts (active reservations, open interactions, active agent sessions), so a call that was ringing
 *    or connected when the worker died is still known to the provider afterwards.
 * 2. reconcileProviderState: every OPEN interaction and active session is compared with the provider's view.
 *    Provider says ENDED → the end is applied truthfully (call.ended event with the provider's end time).
 *    Provider does not know the call → the agent sees a durable error and a supervisor-owned exception is raised;
 *    nothing is invented. Drafts are never touched.
 * 3. forceEndInteraction: the supervisor's recovery action for a call whose provider state cannot be resolved.
 */
const ACTIVE_RESERVATIONS = ["AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] as const;

function sessionStateToProvider(state: string): ConfirmedAgentState["state"] {
  switch (state) {
    case "READY":
    case "NOT_READY":
    case "RESERVED":
    case "DIALING":
    case "TALKING":
    case "ACW":
    case "BREAK":
    case "OFFLINE":
      return state;
    default:
      return "UNKNOWN";
  }
}

export async function buildProviderSnapshot(db: Db) {
  const reservations = await db.routingReservation.findMany({ where: { status: { in: [...ACTIVE_RESERVATIONS] } }, include: { dialAttempts: { orderBy: { startedAt: "desc" }, take: 1 }, interactions: { orderBy: { startedAt: "desc" }, take: 1 }, agentSession: { select: { providerAgentRef: true } } } });
  const interactions: ProviderInteraction[] = reservations.map((r) => {
    const i = r.interactions[0] ?? null;
    const a = r.dialAttempts[0] ?? null;
    const ended = r.status === "WRAP_UP" || (i && i.status !== "OPEN");
    const connected = !!i && i.status === "OPEN";
    const state: ProviderInteraction["state"] = ended ? "ENDED" : connected ? "CONNECTED" : a?.ringingAt ? "RINGING" : "DIALING";
    const control = i ? readControlState(i.controlState) : null;
    return {
      providerInteractionRef: i?.providerInteractionRef ?? `mock-call-${r.correlationId}`,
      correlationId: r.correlationId,
      state,
      technicalResult: ended ? ((i?.technicalResult as ProviderInteraction["technicalResult"]) ?? "ANSWERED") : connected ? "ANSWERED" : null,
      startedAt: (a?.startedAt ?? r.createdAt).toISOString(),
      answeredAt: i?.connectedAt?.toISOString() ?? a?.answeredAt?.toISOString() ?? null,
      endedAt: i?.endedAt?.toISOString() ?? a?.endedAt?.toISOString() ?? null,
      agentRef: r.agentSession?.providerAgentRef ?? null,
      muted: control?.muted ?? false,
      held: control?.held ?? false,
    };
  });
  const sessions = await db.agentSession.findMany({ where: { isActive: true } });
  const agentStates: ConfirmedAgentState[] = sessions.map((s) => ({
    agentRef: s.providerAgentRef,
    state: sessionStateToProvider(s.confirmedState),
    since: s.stateSince.toISOString(),
    activeInteractionRef: interactions.find((i) => i.agentRef === s.providerAgentRef && i.state !== "ENDED")?.providerInteractionRef ?? null,
    connectionHealthy: s.ctiConnected,
  }));
  return { interactions, agentStates };
}

export async function hydrateMockAdapter(db: Db, adapter: DialerAdapter) {
  if (!(adapter instanceof MockDialerAdapter)) return { hydrated: false, interactions: 0, agentStates: 0 };
  const snapshot = await buildProviderSnapshot(db);
  adapter.hydrate(snapshot);
  return { hydrated: true, interactions: snapshot.interactions.length, agentStates: snapshot.agentStates.length };
}

export interface ReconcileResult {
  openInteractions: number;
  endedFromProvider: number;
  unknownAtProvider: number;
  sessionsCorrected: number;
}

/** Minutes an OPEN call may be unknown to the provider before a supervisor exception is raised. */
const UNKNOWN_GRACE_MS = 2 * 60_000;

export async function reconcileProviderState(prisma: PrismaClient, adapter: DialerAdapter, now: Date, scheduleEvents: (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => Promise<void>): Promise<ReconcileResult> {
  const result: ReconcileResult = { openInteractions: 0, endedFromProvider: 0, unknownAtProvider: 0, sessionsCorrected: 0 };
  const open = await prisma.interaction.findMany({ where: { status: "OPEN", channel: "VOICE_OUTBOUND" }, include: { reservation: { select: { agentSessionId: true, agentSession: { select: { providerAgentRef: true, confirmedState: true, id: true } } } } } });
  result.openInteractions = open.length;
  for (const i of open) {
    const ref = i.providerInteractionRef ?? `mock-call-${i.correlationId}`;
    const provider = await adapter.getInteraction(ref);
    const control = readControlState(i.controlState);
    if (provider.state === "ENDED") {
      const endedAt = provider.endedAt ?? now.toISOString();
      const ev: NormalizedProviderEvent = { provider: MOCK_PROVIDER, providerEventId: `${ref}:call.ended`, eventType: "call.ended", occurredAt: endedAt, agentRef: provider.agentRef ?? i.reservation?.agentSession?.providerAgentRef ?? null, providerInteractionRef: ref, correlationId: i.correlationId, payload: { technicalResult: provider.technicalResult ?? "ANSWERED", endedBy: "RECONCILIATION" } };
      const r = await ingestProviderEvent(prisma, ev, now, adapter);
      if (r.status === "DUPLICATE") await scheduleEvents([]);
      await prisma.interaction.update({ where: { id: i.id }, data: { controlState: { ...control, pending: [], providerState: "ENDED", lastError: null, lastErrorAt: null, updatedAt: now.toISOString() } as never } });
      await prisma.exceptionCase.updateMany({ where: { dedupKey: { in: [`CALL_CONTROL_FAILURE:${i.id}`, `CALL_STATE_UNKNOWN:${i.id}`] }, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, data: { status: "RESOLVED", resolvedAt: now, resolution: "Provider reported the call as ended; applied by reconciliation" } });
      await appendAudit(prisma, { actorService: "reconciliation", action: "call.reconciled_ended", objectType: "Interaction", objectId: i.id, customerId: i.customerId, correlationId: i.correlationId, changes: { providerEndedAt: endedAt, ingest: r.status } });
      result.endedFromProvider++;
      continue;
    }
    if (provider.state === "UNKNOWN") {
      const since = control.endRequestedAt ? new Date(control.endRequestedAt) : i.connectedAt ?? i.startedAt;
      if (now.getTime() - since.getTime() < UNKNOWN_GRACE_MS) continue;
      await prisma.interaction.update({ where: { id: i.id }, data: { controlState: { ...control, providerState: "UNKNOWN", lastError: "The provider has no record of this call; a supervisor must resolve it (force end) or the provider must report it", lastErrorAt: now.toISOString(), updatedAt: now.toISOString() } as never } });
      await prisma.exceptionCase.upsert({
        where: { dedupKey: `CALL_STATE_UNKNOWN:${i.id}` },
        create: { dedupKey: `CALL_STATE_UNKNOWN:${i.id}`, type: "CALL_STATE_UNKNOWN", severity: "CRITICAL", customerId: i.customerId, caseId: i.caseId, title: "Open call unknown to the provider after reconciliation; supervisor recovery required", evidence: { interactionId: i.id, correlationId: i.correlationId, agentUserId: i.agentUserId, connectedAt: i.connectedAt } as never, slaDueAt: new Date(now.getTime() + 15 * 60_000) },
        update: { lastSeenAt: now, occurrences: { increment: 1 } },
      });
      result.unknownAtProvider++;
      continue;
    }
    // CONNECTED / RINGING / DIALING: make sure the agent session agrees with the provider.
    const session = i.reservation?.agentSession;
    if (session && provider.state === "CONNECTED" && session.confirmedState !== "TALKING") {
      await applyConfirmedState(prisma, session.id, "TALKING", now, { reason: "State restored from provider by reconciliation" });
      result.sessionsCorrected++;
    }
    if (control.providerState !== provider.state || control.muted !== !!provider.muted || control.held !== !!provider.held) {
      await prisma.interaction.update({ where: { id: i.id }, data: { controlState: { ...control, providerState: provider.state, muted: provider.muted ?? control.muted, held: provider.held ?? control.held, updatedAt: now.toISOString() } as never } });
    }
  }
  return result;
}

/** Supervisor recovery: end an open call whose provider state cannot be resolved. The record stays truthful. */
export async function forceEndInteraction(prisma: PrismaClient, params: { interactionId: string; actorUserId: string; reason: string; now: Date }) {
  const i = await prisma.interaction.findUnique({ where: { id: params.interactionId }, include: { reservation: true } });
  if (!i) throw new Error("Interaction not found");
  if (i.status !== "OPEN") return { ended: false, status: i.status };
  const talk = i.connectedAt ? Math.max(0, Math.round((params.now.getTime() - i.connectedAt.getTime()) / 1000)) : 0;
  const control = readControlState(i.controlState);
  await prisma.interaction.update({ where: { id: i.id }, data: { endedAt: params.now, talkSeconds: talk, acwStartedAt: params.now, status: "DRAFT", wrapUpStatus: "PENDING", note: `${i.note ? `${i.note} ` : ""}Call ended by supervisor (${params.reason}); provider state ${control.providerState ?? "unknown"}; talk time is an upper bound.`, controlState: { ...control, pending: [], providerState: control.providerState ?? "UNKNOWN", lastError: null, lastErrorAt: null, updatedAt: params.now.toISOString(), forceEndedBy: params.actorUserId } as never } });
  if (i.dialAttemptId) await prisma.dialAttempt.updateMany({ where: { id: i.dialAttemptId, endedAt: null }, data: { endedAt: params.now, technicalResult: "ANSWERED", correctedResult: "UNKNOWN", correctionReason: "Force-ended by supervisor; provider end time unknown" } });
  if (i.reservationId) await prisma.routingReservation.update({ where: { id: i.reservationId }, data: { status: "WRAP_UP" } });
  if (i.reservation?.agentSessionId) await applyConfirmedState(prisma, i.reservation.agentSessionId, "ACW", params.now, { reason: "Call force-ended by supervisor; outcome required" });
  await prisma.exceptionCase.updateMany({ where: { dedupKey: { in: [`CALL_CONTROL_FAILURE:${i.id}`, `CALL_STATE_UNKNOWN:${i.id}`] }, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, data: { status: "RESOLVED", resolvedAt: params.now, resolution: `Force-ended by supervisor: ${params.reason}` } });
  await appendAudit(prisma, { actorUserId: params.actorUserId, action: "call.force_ended", objectType: "Interaction", objectId: i.id, customerId: i.customerId, correlationId: i.correlationId, reason: params.reason, changes: { talkSeconds: talk } });
  return { ended: true, status: "DRAFT", talkSeconds: talk };
}
