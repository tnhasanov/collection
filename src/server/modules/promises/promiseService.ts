import type { Db } from "@/server/db";
import { dec, money, toDbMoney, ZERO } from "@/server/money";
import { bakuEndOfDay, isIsoDate, toDbDate, type IsoDate } from "@/server/dates";
import { addHours } from "@/server/dates";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { rpcCooldownEnd } from "@/server/modules/contactPolicy/evaluator";
import { appendAudit } from "@/server/modules/audit/audit";
import { badRequest, conflict } from "@/server/errors";

export const ACTIVE_PROMISE_STATUSES = ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] as const;

export interface CreatePromiseInput {
  customerId: string;
  caseId: string | null;
  interactionId: string | null;
  amount: string;
  deadlineDate: IsoDate;
  coveredLoanIds: string[];
  customerConfirmed: boolean;
  createdByUserId: string | null;
  ownerUserId: string | null;
  now: Date;
  lastRpcAt: Date | null;
  supersedeReason?: string | null;
  scopeDescription?: string | null;
}

/** One active promise per covered obligation set; no silent extension; history preserved. */
export async function createPromise(db: Db, input: CreatePromiseInput) {
  const amount = money(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw badRequest("Promise amount must be positive");
  if (!isIsoDate(input.deadlineDate)) throw badRequest("Deadline must be an ISO date");
  const deadline = bakuEndOfDay(input.deadlineDate);
  if (deadline.getTime() < input.now.getTime()) throw badRequest("Deadline cannot be in the past");
  const loans = await db.loan.findMany({ where: { id: { in: input.coveredLoanIds }, customerId: input.customerId } });
  if (loans.length !== input.coveredLoanIds.length || loans.length === 0) throw badRequest("Covered loans must belong to the customer");
  const policy = await getContactPolicy(db);
  const overlapping = await db.promise.findMany({ where: { customerId: input.customerId, status: { in: [...ACTIVE_PROMISE_STATUSES] } } });
  const clash = overlapping.filter((p) => p.coveredLoanIds.some((id) => input.coveredLoanIds.includes(id)));
  if (clash.length > 0) {
    if (!input.supersedeReason) throw conflict("An active promise already covers this obligation; cancel or supersede it with a reason", { promiseIds: clash.map((c) => c.id) });
    for (const c of clash) {
      await db.promise.update({ where: { id: c.id }, data: { status: "CANCELLED", cancelReason: `SUPERSEDED: ${input.supersedeReason}`, changeReason: input.supersedeReason, events: { create: { type: "CANCELLED", fromStatus: c.status, toStatus: "CANCELLED", reason: `Superseded: ${input.supersedeReason}`, actorUserId: input.createdByUserId } } } });
    }
  }
  const windowEnd = addHours(deadline, policy.ptpSettlementAllowanceDays * 24);
  const cooldownEnd = input.lastRpcAt ? rpcCooldownEnd(input.lastRpcAt, policy) : null;
  const suppressionUntil = policy.ptpProtectionEnabled ? new Date(Math.max(windowEnd.getTime(), cooldownEnd?.getTime() ?? 0)) : cooldownEnd;
  const promise = await db.promise.create({
    data: {
      customerId: input.customerId,
      caseId: input.caseId,
      interactionId: input.interactionId,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      amount: toDbMoney(amount),
      deadline,
      deadlineDate: toDbDate(input.deadlineDate),
      coveredLoanIds: input.coveredLoanIds,
      scopeDescription: input.scopeDescription ?? `${input.coveredLoanIds.join(", ")} / oldest overdue installments`,
      customerConfirmed: input.customerConfirmed,
      status: "ACTIVE",
      remainingAmount: toDbMoney(amount),
      qualifyingWindowStart: input.now,
      qualifyingWindowEnd: windowEnd,
      settlementAllowanceDays: policy.ptpSettlementAllowanceDays,
      suppressionUntil,
      reminderPlan: { smsBeforeDeadlineDays: 1, template: "PTP-REMINDER-01", channelLimitsApply: true } as never,
      policyVersionId: `${policy.code}/${policy.version}`,
      previousPromiseId: clash[0]?.id ?? null,
      events: { create: { type: "CREATED", toStatus: "ACTIVE", actorUserId: input.createdByUserId, data: { amount: amount.toFixed(2), deadline: input.deadlineDate, coveredLoanIds: input.coveredLoanIds, customerConfirmed: input.customerConfirmed } as never } },
    },
  });
  await appendAudit(db, { actorUserId: input.createdByUserId, action: "promise.created", objectType: "Promise", objectId: promise.id, customerId: input.customerId, caseId: input.caseId, changes: { amount: amount.toFixed(2), deadline: input.deadlineDate, suppressionUntil, policyVersion: promise.policyVersionId } });
  return promise;
}

/** Credit a verified posted payment to at most one promise (unique per payment), within the qualifying window and scope. */
export async function attributePaymentToPromise(db: Db, payment: { id: string; customerId: string | null; loanId: string | null; amount: string; eventAt: Date; status: string }, now: Date) {
  if (!payment.customerId || !payment.loanId || payment.status !== "POSTED") return null;
  const existing = await db.promisePaymentLink.findUnique({ where: { paymentId: payment.id } });
  if (existing) return { promiseId: existing.promiseId, duplicate: true };
  const candidates = await db.promise.findMany({ where: { customerId: payment.customerId, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } }, orderBy: { createdAt: "asc" } });
  const promise = candidates.find((p) => p.coveredLoanIds.includes(payment.loanId!) && payment.eventAt.getTime() >= p.qualifyingWindowStart.getTime() && payment.eventAt.getTime() <= p.qualifyingWindowEnd.getTime());
  if (!promise) return null;
  const credit = money(Math.min(Number(dec(promise.remainingAmount)), Number(dec(payment.amount))).toFixed(2));
  if (credit.lessThanOrEqualTo(0)) return null;
  const paid = money(dec(promise.paidAmount).plus(credit));
  const remaining = money(dec(promise.amount).minus(paid));
  const kept = remaining.lessThanOrEqualTo(0);
  await db.promisePaymentLink.create({ data: { promiseId: promise.id, paymentId: payment.id, amount: toDbMoney(credit) } });
  await db.promise.update({
    where: { id: promise.id },
    data: {
      paidAmount: toDbMoney(paid),
      remainingAmount: toDbMoney(kept ? ZERO : remaining),
      status: kept ? "KEPT" : "PARTIALLY_PAID",
      maturedAt: kept ? now : null,
      events: { create: { type: "PAYMENT_ATTRIBUTED", fromStatus: promise.status, toStatus: kept ? "KEPT" : "PARTIALLY_PAID", data: { paymentId: payment.id, amount: credit.toFixed(2) } as never } },
    },
  });
  await appendAudit(db, { actorService: "promise-service", action: kept ? "promise.kept" : "promise.partially_paid", objectType: "Promise", objectId: promise.id, customerId: payment.customerId, changes: { paymentId: payment.id, credited: credit.toFixed(2), remaining: kept ? "0.00" : remaining.toFixed(2) } });
  return { promiseId: promise.id, credited: credit.toFixed(2), status: kept ? "KEPT" : "PARTIALLY_PAID", duplicate: false };
}

/** A reversal re-opens the applicable promise state without erasing history. */
export async function reversePromiseAttribution(db: Db, originalPaymentId: string, now: Date) {
  const link = await db.promisePaymentLink.findUnique({ where: { paymentId: originalPaymentId } });
  if (!link || link.reversed) return null;
  const promise = await db.promise.findUniqueOrThrow({ where: { id: link.promiseId } });
  const paid = money(dec(promise.paidAmount).minus(link.amount));
  const remaining = money(dec(promise.amount).minus(paid));
  const beforeDeadline = promise.qualifyingWindowEnd.getTime() > now.getTime();
  const status = beforeDeadline ? (paid.greaterThan(0) ? "PARTIALLY_PAID" : "ACTIVE") : paid.greaterThan(0) ? "PARTIALLY_PAID" : "BROKEN";
  await db.promisePaymentLink.update({ where: { id: link.id }, data: { reversed: true } });
  await db.promise.update({ where: { id: promise.id }, data: { paidAmount: toDbMoney(paid), remainingAmount: toDbMoney(remaining), status, maturedAt: beforeDeadline ? null : promise.maturedAt ?? now, events: { create: { type: "PAYMENT_REVERSED", fromStatus: promise.status, toStatus: status, data: { paymentId: originalPaymentId, amount: link.amount.toString() } as never } } } });
  await appendAudit(db, { actorService: "promise-service", action: "promise.payment_reversed", objectType: "Promise", objectId: promise.id, customerId: promise.customerId, changes: { paymentId: originalPaymentId, status } });
  return { promiseId: promise.id, status };
}

/** Mature promises whose qualifying window has closed. A late feed yields PENDING_RECONCILIATION, never a premature BROKEN. */
export async function maturePromises(db: Db, now: Date) {
  const feed = await db.sourceWatermark.findUnique({ where: { sourceSystem: "PAYMENT_FEED" } });
  const feedAsOf = feed?.sourceAsOf ?? null;
  const due = await db.promise.findMany({ where: { status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] }, qualifyingWindowEnd: { lt: now } } });
  const results: { id: string; status: string }[] = [];
  for (const p of due) {
    const feedCoversWindow = !!feedAsOf && feedAsOf.getTime() >= p.qualifyingWindowEnd.getTime() && feed?.health === "HEALTHY";
    let status: "KEPT" | "PARTIALLY_PAID" | "BROKEN" | "PENDING_RECONCILIATION";
    if (dec(p.remainingAmount).lessThanOrEqualTo(0)) status = "KEPT";
    else if (!feedCoversWindow) status = "PENDING_RECONCILIATION";
    else status = dec(p.paidAmount).greaterThan(0) ? "PARTIALLY_PAID" : "BROKEN";
    if (status === p.status && status !== "PARTIALLY_PAID") continue;
    if (status === "PARTIALLY_PAID" && p.status === "PARTIALLY_PAID" && p.maturedAt) continue;
    await db.promise.update({ where: { id: p.id }, data: { status, maturedAt: status === "PENDING_RECONCILIATION" ? p.maturedAt : now, suppressionUntil: status === "BROKEN" || status === "PARTIALLY_PAID" ? null : p.suppressionUntil, events: { create: { type: "MATURED", fromStatus: p.status, toStatus: status, reason: status === "PENDING_RECONCILIATION" ? "Payment feed does not yet cover the settlement window" : "Qualifying window closed" } } } });
    if (status === "BROKEN" || status === "PARTIALLY_PAID") {
      const c = await db.collectionCase.findFirst({ where: { customerId: p.customerId, status: "OPEN" } });
      if (c) {
        const key = `${p.customerId}:PTP_FOLLOWUP`;
        const exists = await db.workItem.findFirst({ where: { activeKey: key, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } } });
        if (!exists) await db.workItem.create({ data: { customerId: p.customerId, caseId: c.id, type: "PTP_FOLLOWUP", status: "ELIGIBLE", activeKey: key, dueAt: now, nextEligibleAt: now, ownerUserId: p.ownerUserId, reason: status === "BROKEN" ? "Broken promise follow-up" : "Partially kept promise follow-up", priority: "0.00" } });
      }
    }
    results.push({ id: p.id, status });
  }
  return results;
}
