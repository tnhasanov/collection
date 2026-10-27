import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { BAKU_ZONE } from "@/server/dates";
import { getContactPolicy, getOutboundControls } from "@/server/modules/settings/settingsService";
import { evaluateContactPolicy, type PolicyContext, type PolicyDecision, type RequestedChannel } from "@/server/modules/contactPolicy/evaluator";

export interface BuildContextOptions {
  channel: RequestedChannel;
  now: Date;
  contactPointId?: string | null;
  dueCallback?: { dueAt: Date; customerRequested: boolean } | null;
  excludeReservationId?: string | null;
  hasSpareCapacity?: boolean;
  campaignCode?: string | null;
}

const FAILED_RESULTS = ["NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE"] as const;

/** Builds the policy context from persisted facts for one customer, then evaluates it. */
export async function evaluateCustomerEligibility(db: Db, customerId: string, opts: BuildContextOptions): Promise<{ decision: PolicyDecision; context: PolicyContext; contactPointId: string | null; snapshotId: string | null }> {
  const { now } = opts;
  const policy = await getContactPolicy(db);
  const controls = await getOutboundControls(db);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId }, include: { contactPoints: true, loans: true } });

  const voiceTypes = ["MOBILE", "LANDLINE"];
  let contactPoint = opts.contactPointId ? customer.contactPoints.find((c) => c.id === opts.contactPointId) ?? null : null;
  if (!contactPoint) {
    const candidates = customer.contactPoints
      .filter((c) => (opts.channel === "SMS" ? c.type === "MOBILE" : voiceTypes.includes(c.type)))
      .filter((c) => c.verification !== "INVALID" && !c.restricted)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.verification === "VERIFIED" ? -1 : 1));
    contactPoint = candidates[0] ?? customer.contactPoints.find((c) => voiceTypes.includes(c.type)) ?? null;
  }

  const snapshot = await db.decisionSnapshot.findFirst({ where: { customerId, isCurrent: true }, orderBy: { createdAt: "desc" } });
  const eligibilityJson = (snapshot?.eligibility ?? {}) as { treatment?: { routineCallAllowed?: boolean; capacityGated?: boolean } };

  // Queries run sequentially: inside a transaction the client is a single connection.
  const startOfDay = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const startOfWeek = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("week").toJSDate();
  const disputes = await db.supportCase.count({ where: { customerId, type: "DISPUTE", status: { in: ["OPEN", "UNDER_REVIEW"] } } });
  const supportCases = await db.supportCase.findMany({ where: { customerId, type: { in: ["HARDSHIP", "COMPLAINT", "SPECIAL_HANDLING", "DECEASED_LEGAL"] }, status: { in: ["OPEN", "UNDER_REVIEW"] }, restrictsCalls: true } });
  const claims = await db.paymentClaim.findMany({ where: { customerId, status: "OPEN" } });
  const lastRpc = await db.interaction.findFirst({ where: { customerId, isRpc: true, status: { in: ["SAVED", "CORRECTED"] } }, orderBy: { startedAt: "desc" } });
  const activePromise = await db.promise.findFirst({ where: { customerId, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } }, orderBy: { createdAt: "desc" } });
  const attemptsToday = await db.dialAttempt.count({ where: { reservation: { customerId }, startedAt: { gte: startOfDay } } });
  const attemptsWeek = await db.dialAttempt.count({ where: { reservation: { customerId }, startedAt: { gte: startOfWeek } } });
  const failedSince = await db.dialAttempt.count({ where: { reservation: { customerId }, technicalResult: { in: [...FAILED_RESULTS] }, startedAt: { gte: DateTime.fromJSDate(now).minus({ days: 14 }).toJSDate() } } });
  const lastFailed = await db.dialAttempt.findFirst({ where: { reservation: { customerId }, technicalResult: { in: [...FAILED_RESULTS] } }, orderBy: { startedAt: "desc" } });
  const otherReservation = await db.routingReservation.findFirst({ where: { customerId, status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] }, ...(opts.excludeReservationId ? { id: { not: opts.excludeReservationId } } : {}) } });
  const strategyActive = await db.strategyVersion.findFirst({ where: { status: "ACTIVE" } });
  const modelVersion = snapshot?.modelVersionId ? await db.modelVersion.findUnique({ where: { id: snapshot.modelVersionId } }) : null;
  const feed = await db.sourceWatermark.findUnique({ where: { sourceSystem: "PAYMENT_FEED" } });
  const smsToday = await db.outboundMessage.count({ where: { customerId, requestedAt: { gte: startOfDay }, status: { in: ["QUEUED", "SENT", "DELIVERED", "UNKNOWN"] } } });
  const smsWeek = await db.outboundMessage.count({ where: { customerId, requestedAt: { gte: startOfWeek }, status: { in: ["QUEUED", "SENT", "DELIVERED", "UNKNOWN"] } } });

  // Failed attempts in the current cycle = failed attempts since the last RPC (or in the last 14 days).
  const failedInCycle = lastRpc
    ? await db.dialAttempt.count({ where: { reservation: { customerId }, technicalResult: { in: [...FAILED_RESULTS] }, startedAt: { gt: lastRpc.startedAt } } })
    : failedSince;

  const supportHold = supportCases.reduce<Date | null>((acc, s) => {
    const until = s.restrictionUntil ?? new Date(now.getTime() + 365 * 86_400_000);
    return !acc || until.getTime() > acc.getTime() ? until : acc;
  }, null);
  const legalOrDeceased = customer.status === "LEGAL" || customer.status === "DECEASED_NOTIFIED" || supportCases.some((s) => s.type === "DECEASED_LEGAL");
  const claimHold = claims.reduce<Date | null>((acc, c) => (c.holdUntil && (!acc || c.holdUntil.getTime() > acc.getTime()) ? c.holdUntil : acc), null);

  const modelValid = snapshot ? (snapshot.modelVersionId ? !!modelVersion && ["ACTIVE", "APPROVED"].includes(modelVersion.status) && (!modelVersion.validTo || modelVersion.validTo.getTime() > now.getTime()) : true) : true;
  const campaignPaused = !!opts.campaignCode && controls.pausedCampaigns.includes(opts.campaignCode);

  const context: PolicyContext = {
    now,
    policy,
    channel: opts.channel,
    customer: { id: customer.id, status: customer.status, specialHandling: customer.specialHandling },
    loans: customer.loans.map((l) => ({ id: l.id, status: l.status, totalOverdue: l.totalOverdue.toString(), balancesAsOf: l.balancesAsOf })),
    sourceFreshness: { paymentFeedAsOf: feed?.sourceAsOf ?? null, paymentFeedHealthy: !!feed && feed.health === "HEALTHY" && !feed.paused },
    contactPoint: contactPoint ? { id: contactPoint.id, verification: contactPoint.verification, restricted: contactPoint.restricted, type: contactPoint.type } : null,
    openDispute: disputes > 0,
    supportHoldUntil: supportHold,
    legalOrDeceased,
    paidClaimHoldUntil: claimHold,
    lastRpcAt: lastRpc?.connectedAt ?? lastRpc?.startedAt ?? null,
    activePromise: activePromise ? { deadline: activePromise.deadline, suppressionUntil: activePromise.suppressionUntil, status: activePromise.status } : null,
    voiceAttemptsToday: attemptsToday,
    voiceAttemptsThisWeek: attemptsWeek,
    failedAttemptsInCycle: failedInCycle,
    lastFailedAttemptAt: lastFailed?.startedAt ?? null,
    actionBucket: snapshot?.actionBucket ?? null,
    routineCallAllowed: eligibilityJson.treatment?.routineCallAllowed ?? false,
    capacityGated: eligibilityJson.treatment?.capacityGated ?? false,
    hasSpareCapacity: opts.hasSpareCapacity ?? true,
    dueCallback: opts.dueCallback ?? null,
    activeReservationByOther: !!otherReservation,
    strategyActive: !!strategyActive && (!snapshot?.strategyVersionId || snapshot.strategyVersionId === strategyActive.id),
    modelValid,
    killSwitch: controls.killSwitch,
    channelPaused: controls.pausedChannels.includes(opts.channel) || campaignPaused,
    smsSentToday: smsToday,
    smsSentThisWeek: smsWeek,
  };
  const decision = evaluateContactPolicy(context);
  return { decision, context, contactPointId: contactPoint?.id ?? null, snapshotId: snapshot?.id ?? null };
}
