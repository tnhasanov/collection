import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import { readControlState, type DialerAdapter, type NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { MOCK_PROVIDER } from "@/server/modules/dialer/mockDialerAdapter";
import { applyConfirmedState } from "@/server/modules/dialer/agentSessionService";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { releaseWorkItem } from "@/server/modules/work/workItemService";
import { appendAudit } from "@/server/modules/audit/audit";
import type { ScheduleEvents } from "@/server/modules/dialer/routingService";

/**
 * Outbox → provider command execution. Only the worker holds the adapter, so provider state stays consistent
 * across web requests. Every command has a stable idempotency key and a persisted receipt.
 */
export interface OutboxLike {
  id: string;
  topic: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId: string | null;
}

async function recordReceipt(db: Db, commandType: string, key: string, request: unknown, receipt: { status: "REQUESTED" | "CONFIRMED" | "REJECTED" | "UNKNOWN"; providerRef?: string; message?: string }, correlationId: string | null, now: Date) {
  return db.commandReceipt.upsert({
    where: { idempotencyKey: key },
    create: { provider: MOCK_PROVIDER, commandType, idempotencyKey: key, status: receipt.status, requestJson: request as never, responseJson: receipt as never, correlationId, resolvedAt: now },
    update: { status: receipt.status, responseJson: receipt as never, resolvedAt: now, attempts: { increment: 1 } },
  });
}

export async function handleDialerOutbox(prisma: PrismaClient, adapter: DialerAdapter, message: OutboxLike, now: Date, scheduleEvents: ScheduleEvents): Promise<{ done: boolean; note?: string }> {
  const payload = (message.payload ?? {}) as Record<string, unknown>;
  switch (message.topic) {
    case "dialer.agentState": {
      const sessionId = String(payload.sessionId);
      const state = String(payload.state) as "READY" | "NOT_READY" | "BREAK" | "OFFLINE";
      const session = await prisma.agentSession.findUnique({ where: { id: sessionId } });
      if (!session) return { done: true, note: "Session gone" };
      const receipt = await adapter.setAgentState({ idempotencyKey: message.idempotencyKey, agentRef: String(payload.agentRef), state, reason: payload.reason ? String(payload.reason) : undefined, requestedBy: String(payload.requestedBy) });
      await recordReceipt(prisma, "setAgentState", message.idempotencyKey, payload, receipt, message.correlationId, now);
      if (receipt.status === "CONFIRMED") {
        // A newer request supersedes an older confirmation (e.g. READY requested after NOT_READY confirmation).
        if (session.requestedState !== state && session.requestedState !== "RESERVED") {
          await applyConfirmedState(prisma, sessionId, state, now, { ctiConnected: true, ctiStatus: "CONNECTED" });
          return { done: true, note: `Confirmed ${state} but ${session.requestedState} was requested later` };
        }
        await applyConfirmedState(prisma, sessionId, state, now, { ctiConnected: true, ctiStatus: "CONNECTED", reason: state === "READY" ? null : (payload.reason as string | null) ?? session.stateReason });
      } else if (receipt.status === "REJECTED") {
        await prisma.agentSession.update({ where: { id: sessionId }, data: { stateReason: `Provider rejected ${state}: ${receipt.message ?? ""}`, requestedState: session.confirmedState === "READY" ? "READY" : "NOT_READY" } });
      } else {
        await applyConfirmedState(prisma, sessionId, "CONNECTION_PROBLEM", now, { ctiStatus: "UNKNOWN", reason: "Provider state unknown; routing paused until reconciled" });
      }
      await appendAudit(prisma, { actorService: "cti-adapter", action: "agent.state.confirmed", objectType: "AgentSession", objectId: sessionId, changes: { state, receipt: receipt.status } });
      return { done: true };
    }
    case "dialer.wrapup": {
      const interactionId = String(payload.interactionId);
      const interaction = await prisma.interaction.findUnique({ where: { id: interactionId }, include: { reservation: true } });
      if (!interaction) return { done: true, note: "Interaction gone" };
      if (interaction.wrapUpStatus === "ACKNOWLEDGED") return { done: true, note: "Already acknowledged" };
      const session = interaction.reservation?.agentSessionId ? await prisma.agentSession.findUnique({ where: { id: interaction.reservation.agentSessionId } }) : null;
      const nextState: "READY" | "NOT_READY" = payload.returnReady && session && !session.pendingBreakAfterWrap && !session.pendingLogoffAfterWrap && session.autoContinue ? "READY" : "NOT_READY";
      const receipt = await adapter.submitWrapUp({ idempotencyKey: message.idempotencyKey, correlationId: interaction.correlationId, providerInteractionRef: interaction.providerInteractionRef, agentRef: String(payload.agentRef), dispositionCode: String(payload.dispositionCode), nextState });
      await recordReceipt(prisma, "submitWrapUp", message.idempotencyKey, { interactionId, dispositionCode: payload.dispositionCode, nextState }, receipt, interaction.correlationId, now);
      if (receipt.status === "CONFIRMED") {
        await prisma.interaction.update({ where: { id: interactionId }, data: { wrapUpStatus: "ACKNOWLEDGED", wrapUpAckAt: now, wrapUpReceiptId: message.idempotencyKey } });
        if (interaction.reservationId) await prisma.routingReservation.update({ where: { id: interaction.reservationId }, data: { status: "RELEASED", releasedAt: now, releaseReason: "WRAP_UP_ACKNOWLEDGED" } });
        if (session) {
          const finalState = session.pendingLogoffAfterWrap ? "OFFLINE" : session.pendingBreakAfterWrap ? (session.requestedState === "BREAK" ? "BREAK" : "NOT_READY") : nextState;
          if (finalState !== nextState) await adapter.setAgentState({ idempotencyKey: `${message.idempotencyKey}:after`, agentRef: session.providerAgentRef, state: finalState, requestedBy: "system" });
          await prisma.agentSession.update({ where: { id: session.id }, data: { currentReservationId: null, currentInteractionId: null, requestedState: finalState, pendingBreakAfterWrap: false, pendingLogoffAfterWrap: false } });
          await applyConfirmedState(prisma, session.id, finalState, now, { reason: finalState === "READY" ? null : session.stateReason });
        }
        await appendAudit(prisma, { actorService: "cti-adapter", action: "wrapup.acknowledged", objectType: "Interaction", objectId: interactionId, customerId: interaction.customerId, correlationId: interaction.correlationId, changes: { nextState } });
        return { done: true };
      }
      await prisma.interaction.update({ where: { id: interactionId }, data: { wrapUpStatus: "FAILED" } });
      await prisma.exceptionCase.upsert({
        where: { dedupKey: `WRAPUP_FAILURE:${interactionId}` },
        create: { dedupKey: `WRAPUP_FAILURE:${interactionId}`, type: "PROVIDER_WRAPUP_FAILURE", severity: "CRITICAL", customerId: interaction.customerId, caseId: interaction.caseId, title: `Provider wrap-up not acknowledged (${receipt.status}); agent held in ACW`, evidence: { interactionId, receipt, agentUserId: interaction.agentUserId } as never },
        update: { lastSeenAt: now, occurrences: { increment: 1 }, status: "OPEN" },
      });
      if (session) await applyConfirmedState(prisma, session.id, "ACW", now, { reason: `Provider wrap-up ${receipt.status.toLowerCase()}; retrying` });
      return { done: false, note: `Wrap-up ${receipt.status}: ${receipt.message ?? ""}` };
    }
    case "dialer.withdraw": {
      const reservationId = String(payload.reservationId);
      const reservation = await prisma.routingReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) return { done: true };
      if (["CONNECTED", "WRAP_UP", "RELEASED", "CANCELLED", "EXPIRED", "FAILED"].includes(reservation.status)) {
        await prisma.routingReservation.update({ where: { id: reservationId }, data: { withdrawalStatus: `NOT_APPLICABLE_${reservation.status}` } });
        return { done: true, note: `Reservation ${reservation.status}; nothing withdrawn` };
      }
      const receipt = await adapter.withdrawWork({ idempotencyKey: message.idempotencyKey, correlationId: reservation.correlationId, reservationId, reason: String(payload.reason) });
      await recordReceipt(prisma, "withdrawWork", message.idempotencyKey, payload, receipt, reservation.correlationId, now);
      if (receipt.status === "CONFIRMED") {
        await prisma.routingReservation.update({ where: { id: reservationId }, data: { status: "CANCELLED", withdrawalStatus: "CONFIRMED", releasedAt: now, releaseReason: String(payload.reason) } });
        await prisma.workItem.update({ where: { id: reservation.workItemId }, data: { status: "CANCELLED", cancelReason: String(payload.reason), activeKey: null, completedAt: now } });
        if (reservation.agentSessionId) {
          await prisma.agentSession.update({ where: { id: reservation.agentSessionId }, data: { currentReservationId: null } });
          const s = await prisma.agentSession.findUnique({ where: { id: reservation.agentSessionId } });
          if (s && ["RESERVED", "DIALING"].includes(s.confirmedState)) {
            await adapter.setAgentState({ idempotencyKey: `${message.idempotencyKey}:ready`, agentRef: s.providerAgentRef, state: s.autoContinue ? "READY" : "NOT_READY", requestedBy: "system" });
            await applyConfirmedState(prisma, s.id, s.autoContinue ? "READY" : "NOT_READY", now, { reason: "Pending call withdrawn (payment/cure before dial)" });
          }
        }
        await appendAudit(prisma, { actorService: "cti-adapter", action: "reservation.withdrawn", objectType: "RoutingReservation", objectId: reservationId, customerId: reservation.customerId, correlationId: reservation.correlationId, reason: String(payload.reason) });
        return { done: true };
      }
      if (receipt.status === "REJECTED") {
        await prisma.routingReservation.update({ where: { id: reservationId }, data: { withdrawalStatus: `REJECTED:${receipt.message ?? ""}` } });
        return { done: true, note: "Withdrawal rejected (call already connected); agent will be updated instead" };
      }
      await prisma.routingReservation.update({ where: { id: reservationId }, data: { withdrawalStatus: "UNKNOWN" } });
      await prisma.exceptionCase.upsert({ where: { dedupKey: `WITHDRAW_UNKNOWN:${reservationId}` }, create: { dedupKey: `WITHDRAW_UNKNOWN:${reservationId}`, type: "WITHDRAWAL_UNACKNOWLEDGED", severity: "CRITICAL", customerId: reservation.customerId, caseId: reservation.caseId, title: "Provider did not acknowledge contact withdrawal; treated as unresolved", evidence: { receipt } as never }, update: { lastSeenAt: now, occurrences: { increment: 1 } } });
      return { done: false, note: "Withdrawal unknown; retry/reconcile" };
    }
    case "dialer.callControl": {
      const action = String(payload.action) as "MUTE" | "UNMUTE" | "HOLD" | "RESUME" | "TRANSFER" | "END";
      const interaction = await prisma.interaction.findUnique({ where: { id: String(payload.interactionId) }, include: { reservation: true } });
      if (!interaction) return { done: true, note: "Interaction gone" };
      const state = readControlState(interaction.controlState);
      const pendingLeft = state.pending.filter((p) => p.key !== message.idempotencyKey);
      if (!interaction.providerInteractionRef) {
        await prisma.interaction.update({ where: { id: interaction.id }, data: { controlState: { ...state, pending: pendingLeft, lastError: `No provider interaction reference for ${action}`, lastErrorAt: now.toISOString(), updatedAt: now.toISOString() } as never } });
        return { done: true, note: "No provider interaction" };
      }
      if ((await adapter.getInteraction(interaction.providerInteractionRef)).state === "UNKNOWN") {
        // The call may have been authorized by another process; rebuild the provider view from persisted facts first.
        const { hydrateMockAdapter } = await import("@/server/modules/dialer/providerReconciliation");
        await hydrateMockAdapter(prisma, adapter);
      }
      const receipt = await adapter.requestCallControl({ idempotencyKey: message.idempotencyKey, correlationId: interaction.correlationId, providerInteractionRef: interaction.providerInteractionRef, action, agentRef: String(payload.agentRef) });
      await recordReceipt(prisma, `callControl.${action}`, message.idempotencyKey, payload, receipt, interaction.correlationId, now);
      // Confirmed / rejected / unknown are three different truths for the agent and the supervisor.
      if (receipt.status === "CONFIRMED") {
        const provider = await adapter.getInteraction(interaction.providerInteractionRef);
        const next = { ...state, pending: pendingLeft, muted: action === "MUTE" ? true : action === "UNMUTE" ? false : (provider.muted ?? state.muted), held: action === "HOLD" ? true : action === "RESUME" ? false : (provider.held ?? state.held), lastError: null, lastErrorAt: null, providerState: provider.state, updatedAt: now.toISOString() };
        await prisma.interaction.update({ where: { id: interaction.id }, data: { controlState: next as never } });
        if (action === "END") {
          // The provider reports the end of the call as an event; the mock synthesizes it here.
          const ev: NormalizedProviderEvent = { provider: MOCK_PROVIDER, providerEventId: `${interaction.providerInteractionRef}:call.ended`, eventType: "call.ended", occurredAt: now.toISOString(), agentRef: String(payload.agentRef), providerInteractionRef: interaction.providerInteractionRef, correlationId: interaction.correlationId, payload: { technicalResult: "ANSWERED", endedBy: "AGENT" } };
          await scheduleEvents([{ delayMs: 0, event: ev }]);
        }
        return { done: true, note: receipt.status };
      }
      const detail = `${action} ${receipt.status.toLowerCase()} by the provider${receipt.message ? `: ${receipt.message}` : ""}`;
      await prisma.interaction.update({ where: { id: interaction.id }, data: { controlState: { ...state, pending: pendingLeft, lastError: detail, lastErrorAt: now.toISOString(), updatedAt: now.toISOString() } as never } });
      if (action === "END" && interaction.status === "OPEN") {
        // A refused or unanswered END leaves the call open at the provider: the agent sees a durable error and the
        // supervisor owns an exception; the reconciliation job resolves it against provider state or by force-end.
        await prisma.exceptionCase.upsert({
          where: { dedupKey: `CALL_CONTROL_FAILURE:${interaction.id}` },
          create: { dedupKey: `CALL_CONTROL_FAILURE:${interaction.id}`, type: "CALL_CONTROL_FAILURE", severity: "CRITICAL", customerId: interaction.customerId, caseId: interaction.caseId, title: `Provider ${receipt.status === "REJECTED" ? "rejected" : "did not answer"} END for an open call; agent cannot wrap up until reconciled`, evidence: { interactionId: interaction.id, correlationId: interaction.correlationId, receipt, agentUserId: interaction.agentUserId } as never },
          update: { lastSeenAt: now, occurrences: { increment: 1 }, status: "OPEN" },
        });
        await appendAudit(prisma, { actorService: "cti-adapter", action: "call.control.end_failed", objectType: "Interaction", objectId: interaction.id, customerId: interaction.customerId, correlationId: interaction.correlationId, blocked: true, changes: { receipt } });
      }
      // UNKNOWN controls are retried by the outbox with backoff (same idempotency key) until dead-lettered; REJECTED is final.
      return receipt.status === "UNKNOWN" ? { done: false, note: detail } : { done: true, note: detail };
    }
    case "agent.notify": {
      const agentUserId = String(payload.agentUserId);
      await prisma.notification.create({ data: { userId: agentUserId, kind: String(payload.kind), message: String(payload.message), link: payload.link ? String(payload.link) : null } });
      return { done: true };
    }
    case "sms.send": {
      // Synthetic gateway: local outbound log only (no real message). The policy was re-checked at dispatch time by
      // the job that queued the message. Delivery is confirmed immediately by the mock; a real gateway adapter must
      // return SENT and later a delivery receipt, which the same status fields and reminder jobs record.
      const id = String(payload.outboundMessageId);
      const msg = await prisma.outboundMessage.findUnique({ where: { id } });
      if (!msg || msg.status !== "QUEUED") return { done: true, note: "Message not queued" };
      await prisma.outboundMessage.update({ where: { id }, data: { status: "DELIVERED", sentAt: now, deliveredAt: now, providerRef: `local-outbox-${id}` } });
      await prisma.reminderJob.updateMany({ where: { outboundMessageId: id, status: { in: ["SCHEDULED", "SENT"] } }, data: { status: "DELIVERED", sentAt: now, reason: "Delivered by the synthetic gateway (local log)" } });
      return { done: true };
    }
    default:
      return { done: true, note: `No handler for ${message.topic}` };
  }
}

export { ingestProviderEvent, releaseWorkItem };
