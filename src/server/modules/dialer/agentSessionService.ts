import type { Db } from "@/server/db";
import type { AgentState } from "@/generated/prisma/enums";
import { appendAudit } from "@/server/modules/audit/audit";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { conflict, badRequest } from "@/server/errors";

export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] as const;
export const BUSY_STATES: AgentState[] = ["RESERVED", "DIALING", "TALKING", "ACW"];

export type RequestableState = "READY" | "NOT_READY" | "BREAK" | "OFFLINE";

/** Authoritative single active session per user; provider state is confirmed asynchronously by the worker. */
export async function startAgentSession(db: Db, params: { userId: string; providerAgentRef: string | null; extension: string | null; campaignCodes: string[]; autoContinueAllowed: boolean; now: Date }) {
  if (!params.providerAgentRef) throw badRequest("No dialer identity mapped for this agent");
  await db.agentSession.updateMany({ where: { userId: params.userId, isActive: true }, data: { isActive: false, endedAt: params.now, stateReason: "SUPERSEDED_BY_NEW_SESSION" } });
  const session = await db.agentSession.create({
    data: {
      userId: params.userId,
      providerAgentRef: params.providerAgentRef,
      extension: params.extension,
      requestedState: "NOT_READY",
      confirmedState: "OFFLINE",
      stateSince: params.now,
      ctiConnected: false,
      ctiStatus: "CONNECTING",
      campaignCodes: params.campaignCodes,
      autoContinue: params.autoContinueAllowed,
      lastHeartbeatAt: params.now,
    },
  });
  await enqueueOutbox(db, "dialer.agentState", { sessionId: session.id, agentRef: params.providerAgentRef, state: "NOT_READY", requestedBy: params.userId, reason: "SESSION_START" }, `agentstate:${session.id}:start`);
  await appendAudit(db, { actorUserId: params.userId, action: "agent.session.started", objectType: "AgentSession", objectId: session.id, changes: { providerAgentRef: params.providerAgentRef, extension: params.extension } });
  return session;
}

export async function getActiveSession(db: Db, userId: string) {
  return db.agentSession.findFirst({ where: { userId, isActive: true }, orderBy: { startedAt: "desc" } });
}

/** Pending wrap-up = an interaction of this agent that still needs a saved outcome or a provider acknowledgment. */
export async function findPendingWrapUp(db: Db, agentUserId: string) {
  return db.interaction.findFirst({
    where: { agentUserId, channel: "VOICE_OUTBOUND", OR: [{ status: { in: ["OPEN", "DRAFT"] } }, { wrapUpStatus: { in: ["PENDING", "FAILED"] } }] },
    orderBy: { startedAt: "desc" },
  });
}

export async function requestAgentState(db: Db, params: { sessionId: string; state: RequestableState; reason?: string | null; now: Date; actorUserId: string }) {
  const session = await db.agentSession.findUniqueOrThrow({ where: { id: params.sessionId } });
  if (!session.isActive) throw conflict("Agent session is no longer active");
  const busy = BUSY_STATES.includes(session.confirmedState) || !!session.currentReservationId;
  if (params.state === "READY") {
    if (!session.ctiConnected) throw conflict("CTI is not connected; Ready cannot be confirmed", { code: "CTI_DISCONNECTED" });
    const pending = await findPendingWrapUp(db, session.userId);
    if (pending) throw conflict("Save the outcome and wait for the provider wrap-up acknowledgment before returning Ready", { code: "WRAP_UP_REQUIRED", interactionId: pending.id });
    const reservation = await db.routingReservation.findFirst({ where: { agentUserId: session.userId, status: { in: [...ACTIVE_RESERVATION_STATUSES] } } });
    if (reservation) throw conflict("An active voice reservation exists for this agent", { code: "RESERVATION_ACTIVE", reservationId: reservation.id });
    if (busy) throw conflict(`Agent is ${session.confirmedState}; Ready is not allowed until the interaction is resolved`, { code: "BUSY" });
    const updated = await db.agentSession.update({ where: { id: session.id }, data: { requestedState: "READY", stateReason: params.reason ?? null, pendingBreakAfterWrap: false, pendingLogoffAfterWrap: false } });
    await enqueueOutbox(db, "dialer.agentState", { sessionId: session.id, agentRef: session.providerAgentRef, state: "READY", requestedBy: params.actorUserId, reason: params.reason ?? null }, `agentstate:${session.id}:READY:${params.now.getTime()}`);
    await appendAudit(db, { actorUserId: params.actorUserId, action: "agent.state.requested", objectType: "AgentSession", objectId: session.id, changes: { state: "READY" } });
    return { session: updated, deferred: false };
  }
  if (busy) {
    // Break / logoff requested during a call takes effect after required wrap-up.
    const updated = await db.agentSession.update({
      where: { id: session.id },
      data: { requestedState: params.state, stateReason: params.reason ?? null, pendingBreakAfterWrap: params.state === "BREAK" || params.state === "NOT_READY", pendingLogoffAfterWrap: params.state === "OFFLINE" },
    });
    await appendAudit(db, { actorUserId: params.actorUserId, action: "agent.state.requested.deferred", objectType: "AgentSession", objectId: session.id, changes: { state: params.state, appliesAfterWrapUp: true } });
    return { session: updated, deferred: true };
  }
  const updated = await db.agentSession.update({ where: { id: session.id }, data: { requestedState: params.state, stateReason: params.reason ?? null } });
  await enqueueOutbox(db, "dialer.agentState", { sessionId: session.id, agentRef: session.providerAgentRef, state: params.state, requestedBy: params.actorUserId, reason: params.reason ?? null }, `agentstate:${session.id}:${params.state}:${params.now.getTime()}`);
  await appendAudit(db, { actorUserId: params.actorUserId, action: "agent.state.requested", objectType: "AgentSession", objectId: session.id, changes: { state: params.state, reason: params.reason ?? null } });
  return { session: updated, deferred: false };
}

export async function setAutoContinue(db: Db, sessionId: string, value: boolean, actorUserId: string) {
  const session = await db.agentSession.update({ where: { id: sessionId }, data: { autoContinue: value } });
  await appendAudit(db, { actorUserId, action: "agent.autoContinue.changed", objectType: "AgentSession", objectId: sessionId, changes: { autoContinue: value } });
  return session;
}

export async function heartbeat(db: Db, sessionId: string, now: Date) {
  return db.agentSession.update({ where: { id: sessionId }, data: { lastHeartbeatAt: now } });
}

/** Applies a provider-confirmed state to the session (called by the worker runtime). */
export async function applyConfirmedState(db: Db, sessionId: string, state: AgentState, now: Date, opts: { reason?: string | null; ctiConnected?: boolean; ctiStatus?: string } = {}) {
  const session = await db.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
  const data: Record<string, unknown> = { confirmedState: state, stateSince: state === session.confirmedState ? session.stateSince : now };
  if (opts.reason !== undefined) data.stateReason = opts.reason;
  if (opts.ctiConnected !== undefined) data.ctiConnected = opts.ctiConnected;
  if (opts.ctiStatus !== undefined) data.ctiStatus = opts.ctiStatus;
  if (state === "OFFLINE") Object.assign(data, { isActive: false, endedAt: now });
  return db.agentSession.update({ where: { id: sessionId }, data });
}

/** Full agent context for the desktop (recovered from the backend, never from an empty browser state). */
export async function getAgentContext(db: Db, userId: string) {
  const session = await getActiveSession(db, userId);
  if (!session) return { session: null, reservation: null, interaction: null, pendingWrapUp: null };
  const reservation = await db.routingReservation.findFirst({ where: { agentUserId: userId, status: { in: [...ACTIVE_RESERVATION_STATUSES] } }, include: { dialAttempts: { orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } });
  const pendingWrapUp = await findPendingWrapUp(db, userId);
  const interaction = reservation
    ? await db.interaction.findFirst({ where: { reservationId: reservation.id }, orderBy: { startedAt: "desc" } })
    : pendingWrapUp;
  return { session, reservation, interaction, pendingWrapUp };
}
