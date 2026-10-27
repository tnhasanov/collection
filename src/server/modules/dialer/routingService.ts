import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { DialerAdapter, NormalizedProviderEvent, RoutingTicket } from "@/server/modules/dialer/contract";
import { maskNumber } from "@/server/modules/dialer/contract";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { claimNextWorkItem, releaseWorkItem } from "@/server/modules/work/workItemService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { getOutboundControls } from "@/server/modules/settings/settingsService";
import { appendAudit } from "@/server/modules/audit/audit";
import { applyConfirmedState, ACTIVE_RESERVATION_STATUSES, findPendingWrapUp } from "@/server/modules/dialer/agentSessionService";
import { conflict, forbidden, notFound } from "@/server/errors";

export type ScheduleEvents = (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => Promise<void>;

const RESERVATION_TTL_MS = 3 * 60_000;
const HEARTBEAT_MAX_AGE_MS = 60_000;

export interface AllocationResult {
  sessionId: string;
  outcome: "RESERVED" | "NO_WORK" | "NOT_ELIGIBLE_AGENT" | "PROVIDER_REJECTED" | "PROVIDER_UNKNOWN" | "PAUSED";
  reservationId?: string;
  customerId?: string;
  reasons?: string[];
}

/** Progressive allocation for one confirmed-Ready agent: claim → reserve → authorize with the provider → schedule provider events. */
export async function allocateForSession(prisma: PrismaClient, sessionId: string, now: Date, adapter: DialerAdapter, scheduleEvents: ScheduleEvents): Promise<AllocationResult> {
  const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: sessionId }, include: { user: { include: { agentProfile: true } } } });
  const controls = await getOutboundControls(prisma);
  if (controls.killSwitch || controls.pausedChannels.includes("VOICE")) return { sessionId, outcome: "PAUSED", reasons: ["OUTBOUND_PAUSED"] };
  if (!session.isActive || session.confirmedState !== "READY" || session.requestedState !== "READY" || !session.ctiConnected) return { sessionId, outcome: "NOT_ELIGIBLE_AGENT", reasons: ["NOT_CONFIRMED_READY"] };
  if (!session.lastHeartbeatAt || now.getTime() - session.lastHeartbeatAt.getTime() > HEARTBEAT_MAX_AGE_MS) return { sessionId, outcome: "NOT_ELIGIBLE_AGENT", reasons: ["BROWSER_HEARTBEAT_STALE"] };
  if (await findPendingWrapUp(prisma, session.userId)) return { sessionId, outcome: "NOT_ELIGIBLE_AGENT", reasons: ["WRAP_UP_PENDING"] };
  const existing = await prisma.routingReservation.findFirst({ where: { agentUserId: session.userId, status: { in: [...ACTIVE_RESERVATION_STATUSES] } } });
  if (existing) return { sessionId, outcome: "NOT_ELIGIBLE_AGENT", reasons: ["RESERVATION_ACTIVE"], reservationId: existing.id };
  const campaignCodes = session.campaignCodes.filter((c) => !controls.pausedCampaigns.includes(c));
  if (campaignCodes.length === 0) return { sessionId, outcome: "PAUSED", reasons: ["CAMPAIGN_PAUSED"] };

  const correlationId = `res-${randomUUID()}`;
  const reserved = await prisma.$transaction(async (tx: Db) => {
    const { workItem, skipped } = await claimNextWorkItem(tx, { userId: session.userId, seniority: session.user.agentProfile?.seniority ?? null, languages: session.user.languages, now, leaseMinutes: 10, campaignCodes });
    if (!workItem) return { workItem: null, skipped, reservation: null, contactPointId: null, decision: null };
    const wi = await tx.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    const dueCallback = wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? now, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null;
    const { decision, contactPointId, snapshotId } = await evaluateCustomerEligibility(tx, wi.customerId, { channel: "VOICE", now, dueCallback, campaignCode: wi.campaignCode });
    if (!decision.eligible || !contactPointId) {
      await releaseWorkItem(tx, wi.id, `NOT_ELIGIBLE_AT_RESERVATION:${decision.reasonCodes.join(",")}`, now);
      return { workItem: null, skipped: [...skipped, { id: wi.id, reasons: decision.reasonCodes }], reservation: null, contactPointId: null, decision };
    }
    const snapshot = snapshotId ? await tx.decisionSnapshot.findUnique({ where: { id: snapshotId } }) : null;
    const reservation = await tx.routingReservation.create({
      data: {
        correlationId,
        workItemId: wi.id,
        customerId: wi.customerId,
        caseId: wi.caseId,
        agentUserId: session.userId,
        agentSessionId: session.id,
        campaignCode: wi.campaignCode ?? campaignCodes[0],
        contactPointId,
        status: "PENDING",
        requiredSkill: wi.requiredSkill,
        expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
        decisionSnapshotId: snapshotId,
        strategyVersionId: snapshot?.strategyVersionId ?? null,
        policyVersionId: snapshot?.policyVersionId ?? null,
        modelVersionId: snapshot?.modelVersionId ?? null,
        eligibilityJson: { reasonCodes: decision.reasonCodes, policyVersion: decision.policyVersion, evaluatedAt: decision.evaluatedAt } as never,
        authorizationRef: `auth-${correlationId}`,
      },
    });
    await tx.workItem.update({ where: { id: wi.id }, data: { status: "IN_PROGRESS" } });
    await tx.agentSession.update({ where: { id: session.id }, data: { currentReservationId: reservation.id } });
    await appendAudit(tx, { actorService: "routing-service", action: "reservation.created", objectType: "RoutingReservation", objectId: reservation.id, customerId: wi.customerId, caseId: wi.caseId, correlationId, changes: { agentUserId: session.userId, workItemId: wi.id, policyVersion: decision.policyVersion } });
    return { workItem: wi, skipped, reservation, contactPointId, decision };
  });

  if (!reserved.reservation || !reserved.contactPointId) return { sessionId, outcome: "NO_WORK", reasons: reserved.skipped.flatMap((s) => s.reasons) };
  const reservation = reserved.reservation;
  const contactPoint = await prisma.contactPoint.findUniqueOrThrow({ where: { id: reserved.contactPointId } });
  const ticket: RoutingTicket = {
    idempotencyKey: `authorize:${reservation.id}`,
    correlationId,
    reservationId: reservation.id,
    workItemId: reservation.workItemId,
    collectionCaseId: reservation.caseId,
    customerRef: reservation.customerId,
    campaignId: reservation.campaignCode,
    dialerAgentRef: session.providerAgentRef,
    contactPointRef: contactPoint.id,
    dialNumber: contactPoint.value,
    requiredSkills: reservation.requiredSkill ? [reservation.requiredSkill] : [],
    expiresAt: reservation.expiresAt.toISOString(),
    policyVersion: reserved.decision?.policyVersion ?? "n/a",
    strategyVersion: reservation.strategyVersionId,
    decisionSnapshotId: reservation.decisionSnapshotId,
    authorizationRef: reservation.authorizationRef ?? `auth-${correlationId}`,
  };
  const receipt = await adapter.authorizeOrPublishWork(ticket);
  await prisma.commandReceipt.create({ data: { provider: "MOCK_DIALER", commandType: "authorizeOrPublishWork", idempotencyKey: ticket.idempotencyKey, status: receipt.status, requestJson: { ...ticket, dialNumber: maskNumber(ticket.dialNumber) } as never, responseJson: receipt as never, correlationId, resolvedAt: now } });
  if (receipt.status === "CONFIRMED") {
    await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "AUTHORIZED", providerTicketRef: receipt.providerRef ?? null } });
    await applyConfirmedState(prisma, session.id, "RESERVED", now);
    if (adapter instanceof MockDialerAdapter) await scheduleEvents(adapter.scriptFor(ticket).steps);
    return { sessionId, outcome: "RESERVED", reservationId: reservation.id, customerId: reservation.customerId };
  }
  if (receipt.status === "REJECTED") {
    await prisma.routingReservation.update({ where: { id: reservation.id }, data: { status: "FAILED", releasedAt: now, releaseReason: `PROVIDER_REJECTED:${receipt.message ?? ""}` } });
    await releaseWorkItem(prisma, reservation.workItemId, "PROVIDER_REJECTED", now);
    await prisma.agentSession.update({ where: { id: session.id }, data: { currentReservationId: null } });
    await appendAudit(prisma, { actorService: "routing-service", action: "reservation.provider_rejected", objectType: "RoutingReservation", objectId: reservation.id, customerId: reservation.customerId, correlationId, reason: receipt.message });
    return { sessionId, outcome: "PROVIDER_REJECTED", reservationId: reservation.id, reasons: [receipt.message ?? "REJECTED"] };
  }
  // UNKNOWN: pause the agent, keep the reservation for reconciliation.
  await applyConfirmedState(prisma, session.id, "CONNECTION_PROBLEM", now, { reason: "Provider result unknown; routing paused until reconciled", ctiStatus: "UNKNOWN" });
  await prisma.exceptionCase.upsert({ where: { dedupKey: `PROVIDER_UNKNOWN:${reservation.id}` }, create: { dedupKey: `PROVIDER_UNKNOWN:${reservation.id}`, type: "SUPPRESSION_SYNC_FAILURE", severity: "CRITICAL", customerId: reservation.customerId, caseId: reservation.caseId, title: "Provider did not confirm the routing ticket; reconciliation required", evidence: { correlationId, receipt } as never }, update: { lastSeenAt: now } });
  return { sessionId, outcome: "PROVIDER_UNKNOWN", reservationId: reservation.id };
}

export async function allocateForReadyAgents(prisma: PrismaClient, now: Date, adapter: DialerAdapter, scheduleEvents: ScheduleEvents) {
  const sessions = await prisma.agentSession.findMany({ where: { isActive: true, confirmedState: "READY", requestedState: "READY", ctiConnected: true, currentReservationId: null } });
  const results: AllocationResult[] = [];
  for (const s of sessions) results.push(await allocateForSession(prisma, s.id, now, adapter, scheduleEvents));
  return results;
}

/** Controlled manual dial (privileged): reserve a specific eligible customer for the requesting agent. */
export async function manualReserve(prisma: PrismaClient, params: { userId: string; customerId: string; reason: string; now: Date }, adapter: DialerAdapter, scheduleEvents: ScheduleEvents): Promise<AllocationResult> {
  const session = await prisma.agentSession.findFirst({ where: { userId: params.userId, isActive: true }, include: { user: { include: { agentProfile: true } } } });
  if (!session) throw conflict("No active agent session");
  if (!session.user.agentProfile?.manualDialAllowed) throw forbidden("Manual dialing is a controlled privilege for this agent");
  if (session.confirmedState !== "READY") throw conflict("Agent must be confirmed Ready before a manual dial", { code: "NOT_READY" });
  const wi = await prisma.workItem.findFirst({ where: { customerId: params.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, orderBy: { createdAt: "asc" } });
  if (!wi) throw notFound("No open call work item for this customer");
  const { decision } = await evaluateCustomerEligibility(prisma, params.customerId, { channel: "VOICE", now: params.now, dueCallback: wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? params.now, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null });
  if (!decision.eligible) throw conflict("Customer is not eligible for a call right now", { code: "NOT_ELIGIBLE", reasonCodes: decision.reasonCodes, nextAllowedAt: decision.nextAllowedAt });
  await prisma.workItem.update({ where: { id: wi.id }, data: { status: "ELIGIBLE", ownerUserId: params.userId, nextEligibleAt: params.now, reason: `${wi.reason ?? ""} MANUAL:${params.reason}`.trim() } });
  await appendAudit(prisma, { actorUserId: params.userId, action: "work.manual_dial_requested", objectType: "WorkItem", objectId: wi.id, customerId: params.customerId, reason: params.reason });
  const res = await allocateForSession(prisma, session.id, params.now, adapter, scheduleEvents);
  if (res.outcome === "RESERVED") await prisma.routingReservation.update({ where: { id: res.reservationId! }, data: { isManual: true } });
  return res;
}

/** Reservations that never progressed with the provider are expired; a provider-reported active call is never dropped. */
export async function expireStaleReservations(prisma: PrismaClient, now: Date, adapter: DialerAdapter) {
  const stale = await prisma.routingReservation.findMany({ where: { status: { in: ["PENDING", "AUTHORIZED", "DIALING"] }, expiresAt: { lt: now } } });
  const expired: string[] = [];
  for (const r of stale) {
    const providerCall = await adapter.getInteraction(`mock-call-${r.correlationId}`);
    if (providerCall.state === "CONNECTED") continue;
    await prisma.routingReservation.update({ where: { id: r.id }, data: { status: "EXPIRED", releasedAt: now, releaseReason: "PROVIDER_TIMEOUT" } });
    await releaseWorkItem(prisma, r.workItemId, "RESERVATION_EXPIRED", now);
    if (r.agentSessionId) {
      await prisma.agentSession.update({ where: { id: r.agentSessionId }, data: { currentReservationId: null } });
      await applyConfirmedState(prisma, r.agentSessionId, "NOT_READY", now, { reason: "Provider timeout on reservation; confirm Ready again", ctiStatus: "DEGRADED" });
    }
    await prisma.exceptionCase.upsert({ where: { dedupKey: `SCREEN_POP_DELAY:${r.id}` }, create: { dedupKey: `SCREEN_POP_DELAY:${r.id}`, type: "SCREEN_POP_DELAY", severity: "WARNING", customerId: r.customerId, caseId: r.caseId, title: "Reservation expired without provider progress", evidence: { correlationId: r.correlationId, expiresAt: r.expiresAt } as never }, update: { lastSeenAt: now } });
    expired.push(r.id);
  }
  return expired;
}
