import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { DialerAdapter, NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import type { TechnicalResult } from "@/generated/prisma/enums";
import { appendAudit } from "@/server/modules/audit/audit";
import { refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { applyConfirmedState } from "@/server/modules/dialer/agentSessionService";
import { completeEndCommands } from "@/server/modules/dialer/callControlService";

/**
 * Normalized provider event ingestion. Events are deduplicated by (provider, providerEventId); unknown
 * correlations are recorded and ignored; state transitions are applied idempotently and never move backwards:
 * a late "started", "ringing" or "bridged" event that arrives after the call ended only fills missing timestamps,
 * and an event for a different call leg than the one the interaction is bound to is ignored.
 * A carrier "answered" is never a verified right-party contact; failed attempts are recorded automatically
 * without inventing a conversation.
 */
export type IngestResult = { status: "APPLIED" | "DUPLICATE" | "IGNORED"; note?: string };

const FAILED: TechnicalResult[] = ["NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE", "CANCELLED"];

export async function ingestProviderEvent(prisma: PrismaClient, event: NormalizedProviderEvent, now: Date, adapter?: DialerAdapter): Promise<IngestResult> {
  let stored;
  try {
    stored = await prisma.providerEvent.create({
      data: { provider: event.provider, providerEventId: event.providerEventId, eventType: event.eventType, providerAgentRef: event.agentRef ?? null, providerInteractionRef: event.providerInteractionRef ?? null, correlationId: event.correlationId ?? null, sequence: event.sequence ?? null, occurredAt: new Date(event.occurredAt), payload: event.payload as never },
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return { status: "DUPLICATE", note: "Provider event already received; no duplicate effect" };
    }
    throw e;
  }
  const finish = async (status: "APPLIED" | "IGNORED", note?: string): Promise<IngestResult> => {
    await prisma.providerEvent.update({ where: { id: stored.id }, data: { status, processedAt: now, note } });
    return { status, note };
  };

  // Connectivity events are per agent, not per call.
  if (event.eventType === "provider.connectivity.lost" || event.eventType === "provider.connectivity.recovered") {
    const session = event.agentRef ? await prisma.agentSession.findFirst({ where: { providerAgentRef: event.agentRef, isActive: true } }) : null;
    if (!session) return finish("IGNORED", "No active session for agent");
    if (event.eventType === "provider.connectivity.lost") {
      await applyConfirmedState(prisma, session.id, "CONNECTION_PROBLEM", now, { ctiConnected: false, ctiStatus: "DISCONNECTED", reason: "Provider connectivity lost; new allocation paused" });
    } else {
      const state = adapter ? await adapter.getAgentState(session.providerAgentRef) : null;
      const restored = state && ["TALKING", "DIALING", "RESERVED", "ACW"].includes(state.state) ? (state.state as "TALKING" | "DIALING" | "RESERVED" | "ACW") : "NOT_READY";
      await applyConfirmedState(prisma, session.id, restored, now, { ctiConnected: true, ctiStatus: "CONNECTED", reason: "Connectivity recovered; state restored from provider. Confirm Ready to resume." });
      if (restored === "NOT_READY") await prisma.agentSession.update({ where: { id: session.id }, data: { requestedState: "NOT_READY" } });
    }
    await appendAudit(prisma, { actorService: "cti-adapter", action: `cti.${event.eventType}`, objectType: "AgentSession", objectId: session.id, correlationId: event.correlationId ?? null });
    return finish("APPLIED");
  }

  if (!event.correlationId) return finish("IGNORED", "Event without correlation id");
  const reservation = await prisma.routingReservation.findUnique({ where: { correlationId: event.correlationId }, include: { workItem: true, customer: true } });
  if (!reservation) return finish("IGNORED", `Unknown correlation ${event.correlationId}`);
  if ((["RELEASED", "CANCELLED", "EXPIRED", "FAILED"].includes(reservation.status) || reservation.withdrawalStatus === "REQUESTED" || reservation.withdrawalStatus === "CONFIRMED") && ["attempt.started", "customer.ringing", "customer.answered", "agent.bridged"].includes(event.eventType)) {
    // Provider recycle / recall of work that is no longer authorized (withdrawn, expired, released): never a live
    // contact for the agent. The attempt is recorded as cancelled, an END is requested and an exception is raised.
    const ref = event.providerInteractionRef ?? `call-${event.correlationId}`;
    await prisma.dialAttempt.upsert({ where: { providerAttemptRef: ref }, create: { reservationId: reservation.id, contactPointId: reservation.contactPointId, providerAttemptRef: ref, startedAt: new Date(event.occurredAt), technicalResult: "CANCELLED", resultSource: "COLLECTIONS_WITHDRAWAL" }, update: { technicalResult: "CANCELLED", resultSource: "COLLECTIONS_WITHDRAWAL" } });
    await prisma.outboxMessage.upsert({ where: { idempotencyKey: `ctl:END:unauthorized:${event.correlationId}` }, create: { topic: "dialer.callControl", idempotencyKey: `ctl:END:unauthorized:${event.correlationId}`, payload: { action: "END", correlationId: event.correlationId, providerInteractionRef: ref, agentRef: event.agentRef ?? null, reason: "UNAUTHORIZED_ATTEMPT" } as never, correlationId: event.correlationId }, update: {} });
    await prisma.exceptionCase.upsert({ where: { dedupKey: `UNAUTHORIZED_ATTEMPT:${reservation.id}` }, create: { dedupKey: `UNAUTHORIZED_ATTEMPT:${reservation.id}`, type: "SUPPRESSION_SYNC_FAILURE", severity: "CRITICAL", customerId: reservation.customerId, caseId: reservation.caseId, title: `Provider executed ${event.eventType} for withdrawn/expired work (${reservation.status}${reservation.withdrawalStatus ? `, withdrawal ${reservation.withdrawalStatus}` : ""}); END requested`, evidence: { correlationId: event.correlationId, eventType: event.eventType, providerInteractionRef: ref } as never }, update: { lastSeenAt: now, occurrences: { increment: 1 } } });
    await appendAudit(prisma, { actorService: "cti-adapter", action: "cti.unauthorized_attempt", objectType: "RoutingReservation", objectId: reservation.id, customerId: reservation.customerId, correlationId: event.correlationId, blocked: true, changes: { eventType: event.eventType, reservationStatus: reservation.status, withdrawalStatus: reservation.withdrawalStatus } });
    return finish("IGNORED", `Unauthorized provider attempt on ${reservation.status} reservation; END requested`);
  }
  if (["RELEASED", "CANCELLED", "EXPIRED", "FAILED"].includes(reservation.status) && event.eventType !== "call.ended") return finish("IGNORED", `Reservation already ${reservation.status}`);
  const sessionId = reservation.agentSessionId;
  const bound = await prisma.interaction.findUnique({ where: { correlationId: event.correlationId }, select: { id: true, status: true, providerInteractionRef: true } });
  if (bound?.providerInteractionRef && event.providerInteractionRef && bound.providerInteractionRef !== event.providerInteractionRef) {
    return finish("IGNORED", `Event for call leg ${event.providerInteractionRef}; interaction is bound to ${bound.providerInteractionRef}`);
  }
  const callEnded = !!bound && bound.status !== "OPEN";
  const sessionNow = sessionId ? await prisma.agentSession.findUnique({ where: { id: sessionId }, select: { confirmedState: true } }) : null;

  switch (event.eventType) {
    case "reservation.assigned": {
      if (reservation.status === "PENDING" || reservation.status === "AUTHORIZED") {
        if (sessionId) await applyConfirmedState(prisma, sessionId, "RESERVED", now);
      }
      return finish("APPLIED");
    }
    case "attempt.started": {
      const ref = event.providerInteractionRef ?? `call-${event.correlationId}`;
      const existing = await prisma.dialAttempt.findUnique({ where: { providerAttemptRef: ref } });
      if (!existing) {
        await prisma.dialAttempt.create({ data: { reservationId: reservation.id, contactPointId: reservation.contactPointId, providerAttemptRef: ref, startedAt: new Date(event.occurredAt), technicalResult: "UNKNOWN" } });
      }
      if (["PENDING", "AUTHORIZED"].includes(reservation.status)) await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "DIALING" } });
      // Out of order (the call is already connected or ended): keep the newer agent state.
      if (sessionId && !callEnded && sessionNow && ["READY", "RESERVED", "NOT_READY", "DIALING"].includes(sessionNow.confirmedState) && ["PENDING", "AUTHORIZED", "DIALING"].includes(reservation.status)) await applyConfirmedState(prisma, sessionId, "DIALING", now);
      return finish("APPLIED", callEnded ? "Late event after the call ended; timestamps only" : undefined);
    }
    case "customer.ringing": {
      await prisma.dialAttempt.updateMany({ where: { reservationId: reservation.id, ringingAt: null }, data: { ringingAt: new Date(event.occurredAt) } });
      return finish("APPLIED");
    }
    case "customer.answered": {
      await prisma.dialAttempt.updateMany({ where: { reservationId: reservation.id, answeredAt: null }, data: { answeredAt: new Date(event.occurredAt) } });
      return finish("APPLIED");
    }
    case "agent.bridged": {
      const attempt = await prisma.dialAttempt.findFirst({ where: { reservationId: reservation.id }, orderBy: { startedAt: "desc" } });
      if (!attempt) return finish("IGNORED", "Bridged without attempt");
      if (callEnded || attempt.endedAt) {
        // Bridged reported after the end: record the timestamp, never reopen the call or move the agent back to Talking.
        await prisma.dialAttempt.update({ where: { id: attempt.id }, data: { bridgedAt: attempt.bridgedAt ?? new Date(event.occurredAt), answeredAt: attempt.answeredAt ?? new Date(event.occurredAt) } });
        return finish("APPLIED", "Late bridged event after the call ended; timestamps only");
      }
      await prisma.dialAttempt.update({ where: { id: attempt.id }, data: { bridgedAt: new Date(event.occurredAt), answeredAt: attempt.answeredAt ?? new Date(event.occurredAt), technicalResult: "ANSWERED" } });
      if (reservation.status !== "CONNECTED") await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "CONNECTED" } });
      const existing = await prisma.interaction.findUnique({ where: { correlationId: event.correlationId } });
      if (!existing) {
        const script = await prisma.template.findFirst({ where: { kind: "AGENT_SCRIPT", status: "ACTIVE", language: reservation.customer.language }, orderBy: { effectiveFrom: "desc" } })
          ?? (await prisma.template.findFirst({ where: { kind: "AGENT_SCRIPT", status: "ACTIVE", language: "EN" } }));
        const interaction = await prisma.interaction.create({
          data: {
            correlationId: event.correlationId,
            customerId: reservation.customerId,
            caseId: reservation.caseId,
            workItemId: reservation.workItemId,
            reservationId: reservation.id,
            dialAttemptId: attempt.id,
            agentUserId: reservation.agentUserId,
            channel: "VOICE_OUTBOUND",
            contactPointId: reservation.contactPointId,
            providerInteractionRef: event.providerInteractionRef ?? null,
            campaignCode: reservation.campaignCode,
            startedAt: attempt.startedAt,
            connectedAt: new Date(event.occurredAt),
            ringSeconds: Math.max(0, Math.round((new Date(event.occurredAt).getTime() - attempt.startedAt.getTime()) / 1000)),
            technicalResult: "ANSWERED",
            status: "OPEN",
            wrapUpStatus: "PENDING",
            scriptVersionId: script?.id ?? null,
            dispositionVersion: "DISP-DEMO-01",
            policyVersionId: reservation.policyVersionId,
          },
        });
        if (sessionId) await prisma.agentSession.update({ where: { id: sessionId }, data: { currentInteractionId: interaction.id } });
        await appendAudit(prisma, { actorService: "cti-adapter", action: "interaction.connected", objectType: "Interaction", objectId: interaction.id, customerId: reservation.customerId, caseId: reservation.caseId, correlationId: event.correlationId });
      }
      if (sessionId) await applyConfirmedState(prisma, sessionId, "TALKING", now);
      return finish("APPLIED");
    }
    case "call.ended": {
      const attempt = await prisma.dialAttempt.findFirst({ where: { reservationId: reservation.id }, orderBy: { startedAt: "desc" } });
      const endedAt = new Date(event.occurredAt);
      const payloadResult = (event.payload.technicalResult as TechnicalResult | undefined) ?? (attempt?.bridgedAt ? "ANSWERED" : "UNKNOWN");
      if (attempt && !attempt.endedAt) await prisma.dialAttempt.update({ where: { id: attempt.id }, data: { endedAt, technicalResult: attempt.bridgedAt ? "ANSWERED" : payloadResult } });
      const interaction = await prisma.interaction.findUnique({ where: { correlationId: event.correlationId } });
      if (interaction) {
        if (interaction.status === "OPEN") {
          const talk = interaction.connectedAt ? Math.max(0, Math.round((endedAt.getTime() - interaction.connectedAt.getTime()) / 1000)) : 0;
          await prisma.interaction.update({ where: { id: interaction.id }, data: { endedAt, talkSeconds: talk, acwStartedAt: endedAt, status: "DRAFT", wrapUpStatus: "PENDING" } });
          await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "WRAP_UP" } });
          if (sessionId) await applyConfirmedState(prisma, sessionId, "ACW", now, { reason: "Outcome required before the next call" });
          await completeEndCommands(prisma, interaction.id, now, "PROVIDER");
          await appendAudit(prisma, { actorService: "cti-adapter", action: "interaction.ended", objectType: "Interaction", objectId: interaction.id, customerId: reservation.customerId, correlationId: event.correlationId, changes: { talkSeconds: talk, endedBy: event.payload.endedBy ?? null } });
        }
        return finish("APPLIED");
      }
      if (payloadResult === "ANSWERED" && reservation.agentUserId && !["RELEASED", "CANCELLED", "EXPIRED", "FAILED"].includes(reservation.status)) {
        // call.ended overtook agent.bridged: the provider says the customer answered, so the agent was (or may have
        // been) on the line. The interaction is opened directly in after-call work; nothing is inferred about it.
        const answeredAt = attempt?.answeredAt ?? attempt?.bridgedAt ?? null;
        const recovered = await prisma.interaction.create({
          data: { correlationId: event.correlationId, customerId: reservation.customerId, caseId: reservation.caseId, workItemId: reservation.workItemId, reservationId: reservation.id, dialAttemptId: attempt?.id ?? null, agentUserId: reservation.agentUserId, channel: "VOICE_OUTBOUND", contactPointId: reservation.contactPointId, providerInteractionRef: event.providerInteractionRef ?? null, campaignCode: reservation.campaignCode, startedAt: attempt?.startedAt ?? endedAt, connectedAt: answeredAt, endedAt, acwStartedAt: endedAt, talkSeconds: answeredAt ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000)) : null, technicalResult: "ANSWERED", status: "DRAFT", wrapUpStatus: "PENDING", dispositionVersion: "DISP-DEMO-01", policyVersionId: reservation.policyVersionId, note: "Call end reported before the bridge event (out of order); outcome required." },
        });
        if (attempt) await prisma.dialAttempt.update({ where: { id: attempt.id }, data: { technicalResult: "ANSWERED" } });
        await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "WRAP_UP" } });
        if (sessionId) {
          await prisma.agentSession.update({ where: { id: sessionId }, data: { currentInteractionId: recovered.id } });
          await applyConfirmedState(prisma, sessionId, "ACW", now, { reason: "Outcome required before the next call" });
        }
        await appendAudit(prisma, { actorService: "cti-adapter", action: "interaction.ended_out_of_order", objectType: "Interaction", objectId: recovered.id, customerId: reservation.customerId, correlationId: event.correlationId });
        return finish("APPLIED", "call.ended before agent.bridged; interaction opened in after-call work");
      }
      // No conversation: record the technical result automatically; retry obeys policy at the next refresh.
      if (!["RELEASED", "CANCELLED", "EXPIRED", "FAILED"].includes(reservation.status)) {
        const result: TechnicalResult = FAILED.includes(payloadResult) ? payloadResult : "FAILED";
        const auto = await prisma.interaction.create({
          data: {
            correlationId: event.correlationId,
            customerId: reservation.customerId,
            caseId: reservation.caseId,
            workItemId: reservation.workItemId,
            reservationId: reservation.id,
            dialAttemptId: attempt?.id ?? null,
            agentUserId: reservation.agentUserId,
            channel: "VOICE_OUTBOUND",
            contactPointId: reservation.contactPointId,
            providerInteractionRef: event.providerInteractionRef ?? null,
            campaignCode: reservation.campaignCode,
            startedAt: attempt?.startedAt ?? endedAt,
            endedAt,
            ringSeconds: attempt ? Math.max(0, Math.round((endedAt.getTime() - attempt.startedAt.getTime()) / 1000)) : null,
            technicalResult: result,
            businessOutcome: "NO_CONVERSATION",
            nextAction: "POLICY_RETRY",
            note: "Technical result recorded automatically from the provider; no conversation took place.",
            status: "SAVED",
            savedAt: now,
            wrapUpStatus: "NOT_REQUIRED",
            dispositionVersion: "DISP-DEMO-01",
            policyVersionId: reservation.policyVersionId,
            providerDispositionCode: result,
          },
        });
        await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: result } });
        const wi = await prisma.workItem.update({ where: { id: reservation.workItemId }, data: { status: "QUEUED", claimedByUserId: null, claimedAt: null, leaseExpiresAt: null, version: { increment: 1 } } });
        await refreshWorkItemEligibility(prisma, wi.id, now);
        await appendAudit(prisma, { actorService: "cti-adapter", action: "attempt.failed", objectType: "Interaction", objectId: auto.id, customerId: reservation.customerId, caseId: reservation.caseId, correlationId: event.correlationId, changes: { technicalResult: result } });
        if (sessionId) await releaseAgentAfterAttempt(prisma, sessionId, now, adapter);
      }
      return finish("APPLIED");
    }
    case "reservation.released":
    case "wrapup.started":
    case "wrapup.completed":
    case "command.rejected":
      return finish("APPLIED", "Informational");
    default:
      return finish("IGNORED", "Unhandled event type");
  }
}

/** After a failed attempt the agent returns to Ready (auto-continue) or to the requested rest state. */
export async function releaseAgentAfterAttempt(db: Db, sessionId: string, now: Date, adapter?: DialerAdapter) {
  const session = await db.agentSession.findUniqueOrThrow({ where: { id: sessionId } });
  const next: "READY" | "NOT_READY" | "BREAK" | "OFFLINE" = session.pendingLogoffAfterWrap ? "OFFLINE" : session.pendingBreakAfterWrap ? (session.requestedState === "BREAK" ? "BREAK" : "NOT_READY") : session.autoContinue ? "READY" : "NOT_READY";
  if (adapter) {
    await adapter.setAgentState({ idempotencyKey: `release:${sessionId}:${now.getTime()}`, agentRef: session.providerAgentRef, state: next, requestedBy: "system" });
  }
  await db.agentSession.update({ where: { id: sessionId }, data: { currentReservationId: null, currentInteractionId: null, requestedState: next, pendingBreakAfterWrap: false, pendingLogoffAfterWrap: false } });
  await applyConfirmedState(db, sessionId, next, now, { reason: next === "READY" ? null : session.stateReason });
  return next;
}
