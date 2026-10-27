import type { Db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import type { Language, Seniority, WorkItemType } from "@/generated/prisma/enums";
import { toDbMoney } from "@/server/money";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { appendAudit } from "@/server/modules/audit/audit";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import type { ActionCode } from "@/server/modules/decisions/treatment";

export const ACTIVE_WORK_STATUSES = ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] as const;
export const ROUTINE_TYPES: WorkItemType[] = ["CALL", "DIGITAL_REMINDER", "MANUAL_REVIEW", "LATER_STAGE_REVIEW"];

export function activeKey(customerId: string, type: WorkItemType) {
  return `${customerId}:${type}`;
}

export function workTypeForAction(action: ActionCode): WorkItemType | null {
  switch (action) {
    case "AGENT_CALL":
    case "AGENT_CALL_PRIORITY":
    case "SENIOR_AGENT_CALL":
    case "SELECTIVE_AGENT_CALL":
      return "CALL";
    case "SMS_REMINDER":
    case "SMS_FALLBACK_IVR_UNAVAILABLE":
    case "DIGITAL_SELF_CURE":
      return "DIGITAL_REMINDER";
    case "MANUAL_REVIEW":
      return "MANUAL_REVIEW";
    case "LATER_STAGE_REVIEW":
      return "LATER_STAGE_REVIEW";
    default:
      return null;
  }
}

/** Create/refresh the routine work item implied by a decision snapshot; cancel routine items that no longer apply. */
export async function syncRoutineWorkItem(db: Db, params: { customerId: string; caseId: string; snapshotId: string; effectiveAction: ActionCode; era: string | null; rank: number | null; requiredSkill: Seniority | null; language: Language; campaignCode: string | null; now: Date }) {
  const type = workTypeForAction(params.effectiveAction);
  const existing = await db.workItem.findMany({ where: { customerId: params.customerId, type: { in: ROUTINE_TYPES }, status: { in: [...ACTIVE_WORK_STATUSES] } } });
  for (const wi of existing) {
    if (wi.type !== type && !["CLAIMED", "IN_PROGRESS"].includes(wi.status)) {
      await db.workItem.update({ where: { id: wi.id }, data: { status: "CANCELLED", cancelReason: `TREATMENT_CHANGED:${params.effectiveAction}`, activeKey: null } });
    }
  }
  if (!type) return null;
  const current = existing.find((wi) => wi.type === type);
  const data = {
    priority: params.era ? toDbMoney(params.era) : "0.00",
    rank: params.rank,
    requiredSkill: params.requiredSkill,
    language: params.language,
    campaignCode: params.campaignCode,
    decisionSnapshotId: params.snapshotId,
  };
  if (current) {
    if (["CLAIMED", "IN_PROGRESS"].includes(current.status)) return current;
    return db.workItem.update({ where: { id: current.id }, data });
  }
  return db.workItem.create({
    data: { ...data, customerId: params.customerId, caseId: params.caseId, type, status: "QUEUED", activeKey: activeKey(params.customerId, type) },
  });
}

/** Re-run the contact policy for a work item and persist ELIGIBLE / DEFERRED with reasons. */
export async function refreshWorkItemEligibility(db: Db, workItemId: string, now: Date, opts: { hasSpareCapacity?: boolean } = {}) {
  const wi = await db.workItem.findUniqueOrThrow({ where: { id: workItemId } });
  if (!["QUEUED", "ELIGIBLE", "DEFERRED"].includes(wi.status)) return wi;
  if (wi.type === "DIGITAL_REMINDER" || wi.type === "MANUAL_REVIEW" || wi.type === "LATER_STAGE_REVIEW" || wi.type === "RECONCILIATION" || wi.type === "DISPUTE_REVIEW" || wi.type === "SUPPORT_REVIEW" || wi.type === "HANDOVER" || wi.type === "PTP_FOLLOWUP") {
    // Non-voice work is always "eligible" to be looked at; its own policy applies at dispatch (SMS) or review.
    return db.workItem.update({ where: { id: wi.id }, data: { status: "ELIGIBLE", deferredReasons: [], nextEligibleAt: wi.dueAt ?? now } });
  }
  const dueCallback = wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? now, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null;
  const { decision, contactPointId } = await evaluateCustomerEligibility(db, wi.customerId, { channel: "VOICE", now, dueCallback, hasSpareCapacity: opts.hasSpareCapacity, campaignCode: wi.campaignCode });
  const blockingOnlyTiming = decision.reasonCodes.every((c) => ["PERMITTED_HOURS", "RETRY_TIMING", "CALLBACK_DUE", "DAILY_ATTEMPT_CAP", "WEEKLY_ATTEMPT_CAP", "RPC_COOLDOWN", "PTP_PROTECTION", "NO_PAID_CLAIM_HOLD", "NO_SUPPORT_HOLD"].includes(c));
  return db.workItem.update({
    where: { id: wi.id },
    data: {
      status: decision.eligible ? "ELIGIBLE" : "DEFERRED",
      deferredReasons: decision.reasonCodes,
      nextEligibleAt: decision.eligible ? now : decision.nextAllowedAt ?? (blockingOnlyTiming ? null : null),
      reason: wi.reason,
      ...(contactPointId ? {} : {}),
    },
  });
}

/** Cancel obsolete outreach after a verified payment/cure; request provider withdrawal for anything already dispatched. */
export async function invalidateObsoleteWork(db: Db, customerId: string, reason: string, now: Date, opts: { sourceEventId?: string | null; correlationId?: string | null } = {}) {
  const items = await db.workItem.findMany({ where: { customerId, type: { in: ["CALL", "DIGITAL_REMINDER", "PTP_FOLLOWUP", "MANUAL_REVIEW"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } } });
  const cancelled: string[] = [];
  const withdrawals: string[] = [];
  for (const wi of items) {
    const reservation = await db.routingReservation.findFirst({ where: { workItemId: wi.id, status: { in: ["PENDING", "AUTHORIZED", "DIALING"] } } });
    if (reservation) {
      // Dispatched or about to dial: request withdrawal through the provider adapter (outbox); the reservation
      // service reconciles the result. A connected call is never dropped automatically.
      await enqueueOutbox(db, "dialer.withdraw", { reservationId: reservation.id, reason }, `withdraw:${reservation.id}:${reason}`, opts.correlationId ?? reservation.correlationId);
      await db.routingReservation.update({ where: { id: reservation.id }, data: { withdrawalStatus: "REQUESTED" } });
      withdrawals.push(reservation.id);
      continue;
    }
    const connected = await db.routingReservation.findFirst({ where: { workItemId: wi.id, status: { in: ["CONNECTED", "WRAP_UP"] } } });
    if (connected) {
      // Active conversation: notify the agent, do not cancel.
      await enqueueOutbox(db, "agent.notify", { reservationId: connected.id, agentUserId: connected.agentUserId, kind: "PAYMENT_DURING_CALL", message: "A verified payment was posted during this call; balances refreshed." }, `notify:${connected.id}:${opts.sourceEventId ?? reason}`, connected.correlationId);
      continue;
    }
    await db.workItem.update({ where: { id: wi.id }, data: { status: "CANCELLED", cancelReason: reason, activeKey: null, completedAt: now } });
    cancelled.push(wi.id);
  }
  if (cancelled.length || withdrawals.length) {
    await appendAudit(db, { actorService: "work-item-service", action: "work.invalidated", objectType: "WorkItem", customerId, reason, changes: { cancelled, withdrawals }, sourceEventId: opts.sourceEventId, correlationId: opts.correlationId });
  }
  return { cancelled, withdrawals };
}

export interface ClaimNextOptions {
  userId: string;
  seniority: Seniority | null;
  languages: Language[];
  now: Date;
  leaseMinutes?: number;
  campaignCodes?: string[];
  manual?: boolean;
}

/**
 * Atomic next-work claim: SELECT ... FOR UPDATE SKIP LOCKED inside a transaction so two agents can never
 * claim the same customer action. Policy is re-evaluated just-in-time; stale rows are deferred and skipped.
 */
export async function claimNextWorkItem(db: Db, opts: ClaimNextOptions): Promise<{ workItem: { id: string; customerId: string; caseId: string; type: WorkItemType } | null; skipped: { id: string; reasons: string[] }[] }> {
  const skipped: { id: string; reasons: string[] }[] = [];
  const lease = new Date(opts.now.getTime() + (opts.leaseMinutes ?? 10) * 60_000);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WorkItem"
      WHERE "status" = 'ELIGIBLE'
        AND "type" IN ('CALL', 'CALLBACK')
        AND ("nextEligibleAt" IS NULL OR "nextEligibleAt" <= ${opts.now})
        AND ("ownerUserId" IS NULL OR "ownerUserId" = ${opts.userId})
        AND ("requiredSkill" IS NULL OR "requiredSkill"::text = ${opts.seniority ?? "REGULAR"} OR ${opts.seniority ?? "REGULAR"} = 'SENIOR')
        AND ("language" IS NULL OR "language"::text = ANY(${opts.languages.length ? opts.languages : ["AZ", "EN", "RU"]}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "RoutingReservation" r WHERE r."customerId" = "WorkItem"."customerId" AND r."status" IN ('PENDING','AUTHORIZED','DIALING','CONNECTED','WRAP_UP'))
      ORDER BY (CASE WHEN "type" = 'CALLBACK' AND "dueAt" <= ${opts.now} THEN 0 ELSE 1 END), "rank" ASC NULLS LAST, "priority" DESC, "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`);
    const row = rows[0];
    if (!row) return { workItem: null, skipped };
    const wi = await db.workItem.findUniqueOrThrow({ where: { id: row.id } });
    const dueCallback = wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? opts.now, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null;
    const { decision } = await evaluateCustomerEligibility(db, wi.customerId, { channel: "VOICE", now: opts.now, dueCallback, campaignCode: wi.campaignCode });
    if (!decision.eligible) {
      await db.workItem.update({ where: { id: wi.id }, data: { status: "DEFERRED", deferredReasons: decision.reasonCodes, nextEligibleAt: decision.nextAllowedAt } });
      skipped.push({ id: wi.id, reasons: decision.reasonCodes });
      continue;
    }
    const claimed = await db.workItem.update({
      where: { id: wi.id, version: wi.version },
      data: { status: "CLAIMED", claimedByUserId: opts.userId, claimedAt: opts.now, leaseExpiresAt: lease, version: { increment: 1 } },
    });
    await appendAudit(db, { actorUserId: opts.userId, action: opts.manual ? "work.claimed.manual" : "work.claimed", objectType: "WorkItem", objectId: wi.id, customerId: wi.customerId, caseId: wi.caseId, changes: { leaseExpiresAt: lease, policyVersion: decision.policyVersion } });
    return { workItem: { id: claimed.id, customerId: claimed.customerId, caseId: claimed.caseId, type: claimed.type }, skipped };
  }
  return { workItem: null, skipped };
}

export async function releaseWorkItem(db: Db, workItemId: string, reason: string, now: Date, actorUserId?: string | null) {
  const wi = await db.workItem.findUniqueOrThrow({ where: { id: workItemId } });
  if (!["CLAIMED", "IN_PROGRESS"].includes(wi.status)) return wi;
  const updated = await db.workItem.update({ where: { id: workItemId }, data: { status: "QUEUED", claimedByUserId: null, claimedAt: null, leaseExpiresAt: null, reason: wi.reason, version: { increment: 1 } } });
  await appendAudit(db, { actorUserId, actorService: actorUserId ? null : "work-item-service", action: "work.released", objectType: "WorkItem", objectId: workItemId, customerId: wi.customerId, caseId: wi.caseId, reason });
  await refreshWorkItemEligibility(db, workItemId, now);
  return updated;
}

export async function completeWorkItem(db: Db, workItemId: string, now: Date, reason: string) {
  return db.workItem.update({ where: { id: workItemId }, data: { status: "COMPLETED", completedAt: now, cancelReason: null, reason, activeKey: null, leaseExpiresAt: null } });
}

/** Create a scheduled callback (one active per customer), subject to policy at execution time. */
export async function createCallbackWorkItem(db: Db, params: { customerId: string; caseId: string; dueAt: Date; ownerUserId: string | null; reason: string; language: Language | null; requiredSkill: Seniority | null; sourceInteractionId?: string | null; now: Date; actorUserId?: string | null; campaignCode?: string | null }) {
  const key = activeKey(params.customerId, "CALLBACK");
  const existing = await db.workItem.findFirst({ where: { activeKey: key, status: { in: [...ACTIVE_WORK_STATUSES] } } });
  if (existing) {
    const updated = await db.workItem.update({ where: { id: existing.id }, data: { dueAt: params.dueAt, nextEligibleAt: params.dueAt, ownerUserId: params.ownerUserId, reason: params.reason, sourceInteractionId: params.sourceInteractionId ?? existing.sourceInteractionId, status: "DEFERRED", deferredReasons: ["CALLBACK_DUE"] } });
    await appendAudit(db, { actorUserId: params.actorUserId, action: "callback.rescheduled", objectType: "WorkItem", objectId: existing.id, customerId: params.customerId, caseId: params.caseId, reason: params.reason, changes: { dueAt: params.dueAt } });
    return updated;
  }
  const wi = await db.workItem.create({
    data: {
      customerId: params.customerId,
      caseId: params.caseId,
      type: "CALLBACK",
      status: "DEFERRED",
      activeKey: key,
      dueAt: params.dueAt,
      nextEligibleAt: params.dueAt,
      deferredReasons: ["CALLBACK_DUE"],
      ownerUserId: params.ownerUserId,
      reason: params.reason,
      language: params.language,
      requiredSkill: params.requiredSkill,
      sourceInteractionId: params.sourceInteractionId ?? null,
      campaignCode: params.campaignCode ?? null,
      priority: "0.00",
    },
  });
  await appendAudit(db, { actorUserId: params.actorUserId, action: "callback.created", objectType: "WorkItem", objectId: wi.id, customerId: params.customerId, caseId: params.caseId, reason: params.reason, changes: { dueAt: params.dueAt, ownerUserId: params.ownerUserId } });
  return wi;
}

/** Create a non-voice follow-up task (reconciliation, dispute review, support review, PTP follow-up) once per customer/type. */
export async function ensureTaskWorkItem(db: Db, params: { customerId: string; caseId: string; type: WorkItemType; dueAt: Date | null; ownerUserId: string | null; reason: string; sourceInteractionId?: string | null; requiredSkill?: Seniority | null }) {
  const key = activeKey(params.customerId, params.type);
  const existing = await db.workItem.findFirst({ where: { activeKey: key, status: { in: [...ACTIVE_WORK_STATUSES] } } });
  if (existing) return existing;
  return db.workItem.create({
    data: {
      customerId: params.customerId,
      caseId: params.caseId,
      type: params.type,
      status: "ELIGIBLE",
      activeKey: key,
      dueAt: params.dueAt,
      nextEligibleAt: params.dueAt,
      ownerUserId: params.ownerUserId,
      reason: params.reason,
      sourceInteractionId: params.sourceInteractionId ?? null,
      requiredSkill: params.requiredSkill ?? null,
      priority: "0.00",
    },
  });
}
