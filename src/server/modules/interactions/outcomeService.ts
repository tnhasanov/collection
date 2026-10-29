import type { Db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import { addHours, bakuEndOfDay, isIsoDate, toDbDate } from "@/server/dates";
import { conflict, notFound, unprocessable, forbidden } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { nextPermittedTime, ptpProtectionEnd, rpcCooldownEnd } from "@/server/modules/contactPolicy/evaluator";
import type { ContactPolicyConfig } from "@/server/modules/contactPolicy/types";
import { createPromise, getPromisePolicy, promiseHorizonCheck, type PromisePolicy } from "@/server/modules/promises/promiseService";
import { cancelReminders } from "@/server/modules/promises/reminderService";
import { syncCustomerCase } from "@/server/modules/cases/caseService";
import { completeWorkItem, createCallbackWorkItem, ensureTaskWorkItem, invalidateObsoleteWork, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { PROVIDER_DISPOSITION_MAP } from "@/server/modules/dialer/contract";
import { outcomeSchema, validateOutcomeBusinessRules, type DraftInput, type OutcomeInput } from "@/server/modules/interactions/outcomeSchema";
import { buildFactualSummary, deriveCoverage, NEXT_ACTION_LABELS, type Coverage, type SummaryCustomerContext } from "@/server/modules/interactions/summary";
import type { NextActionKind } from "@/generated/prisma/enums";

export interface NextActionPreview {
  nextAction: NextActionKind;
  summary: string;
  routineCallsBlockedUntil: Date | null;
  cooldownUntil: Date | null;
  ptpProtectionUntil: Date | null;
  callbackAt: Date | null;
  reconciliationHoldUntil: Date | null;
  digitalReminders: string;
  referral: string | null;
  customerWide: boolean;
  errors: string[];
  /** Derived from the promise amount against the covered obligations (blueprint: full/partial coverage is derived, not chosen). */
  derivedOutcome: OutcomeInput["businessOutcome"];
  coverage: Coverage;
  coveredOverdue: string | null;
  factualSummary: string;
  policyVersion: string;
}

/** Pure next-action computation shared by the preview endpoint and the save path. */
export function computeNextAction(input: OutcomeInput, ctx: { now: Date; policy: ContactPolicyConfig; technicalResult: string | null; customer?: SummaryCustomerContext | null; promisePolicy?: PromisePolicy | null }): NextActionPreview {
  const errors = validateOutcomeBusinessRules(input);
  const { coverage, coveredOverdue, derivedOutcome } = deriveCoverage(input, ctx.customer ?? null);
  const rpc = input.identityStatus === "RPC_VERIFIED";
  const cooldownUntil = rpc ? rpcCooldownEnd(ctx.now, ctx.policy) : null;
  let nextAction: NextActionKind = "POLICY_RETRY";
  let summary = "Retry only within bucket timing, frequency limits and permitted hours";
  let ptpProtectionUntil: Date | null = null;
  let callbackAt: Date | null = null;
  let reconciliationHoldUntil: Date | null = null;
  let referral: string | null = null;
  let digitalReminders = "Approved SMS reminders continue under their own limits";

  if (input.identityStatus === "WRONG_NUMBER" || input.identityStatus === "WRONG_PERSON") {
    nextAction = "CONTACT_CORRECTION";
    summary = "Flag the contact point; use an eligible alternative contact or request a master-data correction";
  } else if (rpc) {
    switch (input.businessOutcome) {
      case "PTP":
      case "PARTIAL_COMMITMENT": {
        nextAction = "MONITOR_PTP";
        const deadline = input.ptp && isIsoDate(input.ptp.deadlineDate) ? bakuEndOfDay(input.ptp.deadlineDate) : ctx.now;
        ptpProtectionUntil = ptpProtectionEnd(deadline, ctx.now, ctx.policy);
        summary = `Protect the promise; monitor qualifying payments until ${ptpProtectionUntil.toISOString()}`;
        digitalReminders = "PTP reminder SMS one day before the deadline (approved template), subject to SMS limits";
        break;
      }
      case "NO_COMMITMENT":
      case "REFUSED":
        nextAction = "COOLDOWN";
        summary = `Verified-contact cooldown (${ctx.policy.rpcCooldownHours}h); next treatment after ${cooldownUntil!.toISOString()}`;
        break;
      case "CALLBACK_REQUESTED": {
        nextAction = "ELIGIBLE_CALLBACK";
        const requested = input.callback ? new Date(input.callback.dueAt) : ctx.now;
        callbackAt = Number.isNaN(requested.getTime()) ? null : nextPermittedTime(requested, ctx.policy);
        if (callbackAt && callbackAt.getTime() !== requested.getTime()) errors.push("Requested callback time is outside permitted hours; the next permitted time will be used");
        summary = `Scheduled callback at ${callbackAt?.toISOString() ?? "n/a"} (customer-requested exception, policy re-checked at dispatch)`;
        break;
      }
      case "ALREADY_PAID_CLAIM":
        nextAction = "RECONCILE_CLAIM";
        reconciliationHoldUntil = addHours(ctx.now, ctx.policy.paidClaimHoldHours);
        summary = `Open reconciliation; temporary contact hold until ${reconciliationHoldUntil.toISOString()}; no balance change until a core posting is verified`;
        break;
      case "DISPUTE":
        nextAction = "DISPUTE_REVIEW";
        referral = "Dispute case to specialist review; routine calls blocked while open";
        summary = "Create an owned dispute case and block routine outreach until resolved";
        break;
      case "SUPPORT_NEEDED":
        nextAction = "SUPPORT_REFERRAL";
        referral = "Repayment support assessment (restricted details)";
        summary = "Create an owned support case; approved support assessment; no unapproved contract change";
        break;
      case "SPECIAL_REFERRAL":
        nextAction = "SPECIAL_REFERRAL";
        referral = input.support?.type === "DECEASED_LEGAL" ? "Death reported (unconfirmed): verification task for a lead/head; routine contact stops until the report is confirmed or rejected" : "Special-case handling (legal / deceased notification)";
        summary = input.support?.type === "DECEASED_LEGAL" ? "Deceased notification recorded as REPORTED; verification required before any status change" : "Special-case referral; no routine calls";
        break;
      case "DELINQUENCY_CLOSED": {
        nextAction = "COOLDOWN";
        const overdue = ctx.customer ? Number(ctx.customer.overdueDueNow) : 0;
        if (overdue > 0) errors.push(`Overdue is still ${ctx.customer!.overdueDueNow} AZN on the fresh snapshot; "Overdue cleared" can be recorded only after the verified posting arrives`);
        summary = "Arrears cleared by a verified core posting during the conversation; the collection episode closes (Gecikmə bağlanıb). No promise, reminder or retry.";
        digitalReminders = "None: no arrears remain";
        break;
      }
      case "PTP_EXCEPTION_PROPOSED": {
        nextAction = "COOLDOWN";
        if (input.ptp && ctx.promisePolicy) {
          const h = promiseHorizonCheck(input.ptp.deadlineDate as never, ctx.now, ctx.promisePolicy);
          if (h.ok) errors.push(`The proposed date is within the promise policy (until ${h.maxDate}); record a normal promise instead of an exception`);
        }
        referral = "Promise-date exception sent to a team lead for approval; no promise, reminder or protection exists until it is approved";
        summary = `Verified-contact cooldown (${ctx.policy.rpcCooldownHours}h) while the proposed exception awaits a decision`;
        digitalReminders = "No PTP reminder until the exception is approved";
        break;
      }
      default:
        nextAction = "COOLDOWN";
    }
  } else if (input.businessOutcome === "SPECIAL_REFERRAL") {
    nextAction = "SPECIAL_REFERRAL";
    referral = "Special-case handling";
    summary = "Special-case referral recorded from a third party; no routine calls pending review";
  } else if (ctx.technicalResult && ctx.technicalResult !== "ANSWERED") {
    nextAction = "POLICY_RETRY";
  }
  const blocked = [cooldownUntil, ptpProtectionUntil, reconciliationHoldUntil].filter((d): d is Date => !!d);
  const routineCallsBlockedUntil = blocked.length ? new Date(Math.max(...blocked.map((d) => d.getTime()))) : null;
  const policyVersion = `${ctx.policy.code}/${ctx.policy.version}`;
  const factualSummary = buildFactualSummary({ ...input, businessOutcome: derivedOutcome }, { technicalResult: ctx.technicalResult, customer: ctx.customer ?? null, policyVersion, nextActionLabel: NEXT_ACTION_LABELS[nextAction] ?? nextAction.toLowerCase(), routineCallsBlockedUntil, callbackAt, reconciliationHoldUntil });
  return { nextAction, summary, routineCallsBlockedUntil, cooldownUntil, ptpProtectionUntil, callbackAt, reconciliationHoldUntil, digitalReminders, referral, customerWide: true, errors, derivedOutcome, coverage, coveredOverdue, factualSummary, policyVersion };
}

/** Bank-verified facts needed for coverage derivation and the factual summary. */
export async function summaryContextFor(db: Db, customerId: string): Promise<SummaryCustomerContext | null> {
  const c = await db.customer.findUnique({ where: { id: customerId }, include: { loans: { where: { status: "ACTIVE" }, select: { id: true, coreLoanId: true, totalOverdue: true, balancesAsOf: true } } } });
  if (!c) return null;
  const overdue = c.loans.reduce((s, l) => s + Number(l.totalOverdue), 0);
  const asOf = c.loans.map((l) => l.balancesAsOf).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { displayName: c.displayName, overdueDueNow: overdue.toFixed(2), balancesAsOf: asOf, loans: c.loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, totalOverdue: l.totalOverdue.toString() })) };
}

export async function saveDraft(db: Db, params: { interactionId: string; actorUserId: string; draft: DraftInput; now: Date }) {
  const interaction = await db.interaction.findUnique({ where: { id: params.interactionId } });
  if (!interaction) throw notFound("Interaction not found");
  if (interaction.agentUserId !== params.actorUserId) throw forbidden("This interaction belongs to another agent");
  if (interaction.status === "SAVED" || interaction.status === "CORRECTED") return interaction;
  return db.interaction.update({ where: { id: params.interactionId }, data: { draftJson: params.draft as never, draftSavedAt: params.now } });
}

/**
 * Save outcome atomically: interaction + next-action effects + audit + provider wrap-up (via outbox).
 * Idempotent: the same idempotency key returns the already saved result; a second click never duplicates
 * a PTP, task, cooldown or provider disposition.
 */
export async function saveOutcome(db: Db, params: { interactionId: string; actorUserId: string; input: unknown; now: Date }) {
  const input = outcomeSchema.parse(params.input);
  const interaction = await db.interaction.findUnique({ where: { id: params.interactionId }, include: { reservation: true, customer: { include: { contactPoints: true } } } });
  if (!interaction) throw notFound("Interaction not found");
  if (interaction.agentUserId !== params.actorUserId) throw forbidden("This interaction belongs to another agent");
  if (interaction.status === "SAVED" || interaction.status === "CORRECTED") {
    if (interaction.idempotencyKey === input.idempotencyKey) return { interaction, duplicate: true, preview: null as NextActionPreview | null };
    throw conflict("Outcome already saved; use an audited correction to change it", { code: "ALREADY_SAVED" });
  }
  if (interaction.status === "OPEN") throw conflict("The call is still active; end the call before saving the final outcome", { code: "CALL_ACTIVE" });
  const policy = await getContactPolicy(db);
  const summaryCtx = await summaryContextFor(db, interaction.customerId);
  const promisePolicy = await getPromisePolicy(db);
  const preview = computeNextAction(input, { now: params.now, policy, technicalResult: interaction.technicalResult, customer: summaryCtx, promisePolicy });
  const hardErrors = preview.errors.filter((e) => !e.startsWith("Requested callback time is outside"));
  if (hardErrors.length) throw unprocessable("Outcome is not valid", { errors: hardErrors });
  // Coverage (full/partial) is derived from bank-verified obligations, never chosen by the agent.
  input.businessOutcome = preview.derivedOutcome;

  const rpc = input.identityStatus === "RPC_VERIFIED";
  const session = interaction.reservation?.agentSessionId ? await db.agentSession.findUnique({ where: { id: interaction.reservation.agentSessionId } }) : null;
  const acwSeconds = interaction.acwStartedAt ? Math.max(0, Math.round((params.now.getTime() - interaction.acwStartedAt.getTime()) / 1000)) : null;
  const detail: Record<string, unknown> = { summary: preview.summary, routineCallsBlockedUntil: preview.routineCallsBlockedUntil, cooldownUntil: preview.cooldownUntil, ptpProtectionUntil: preview.ptpProtectionUntil, callbackAt: preview.callbackAt, reconciliationHoldUntil: preview.reconciliationHoldUntil };

  const saved = await db.interaction.update({
    where: { id: interaction.id },
    data: {
      idempotencyKey: input.idempotencyKey,
      identityStatus: input.identityStatus,
      businessOutcome: input.businessOutcome,
      nonPaymentReason: input.nonPaymentReason ?? null,
      note: input.note ?? null,
      nextAction: preview.nextAction,
      nextActionDetail: { ...detail, coverage: preview.coverage, coveredOverdue: preview.coveredOverdue } as never,
      factualSummary: preview.factualSummary,
      customerStatement: (input.customerStatement ?? null) as never,
      status: "SAVED",
      savedAt: params.now,
      acwEndedAt: params.now,
      acwSeconds,
      isRpc: rpc,
      providerDispositionCode: PROVIDER_DISPOSITION_MAP[input.businessOutcome] ?? "NO_RPC",
      flags: [...(input.callback?.customerRequested ? ["CUSTOMER_REQUESTED_CALLBACK"] : []), ...(input.technicalResultCorrection ? ["TECHNICAL_RESULT_CORRECTED"] : []), ...(input.secondaryFlags ?? [])],
      draftJson: Prisma.DbNull,
    },
  });
  if (input.technicalResultCorrection && interaction.dialAttemptId) {
    await db.dialAttempt.update({ where: { id: interaction.dialAttemptId }, data: { correctedResult: input.technicalResultCorrection.result, correctionReason: input.technicalResultCorrection.reason } });
  }
  const caseId = interaction.caseId ?? (await db.collectionCase.findFirst({ where: { customerId: interaction.customerId, status: "OPEN" } }))?.id ?? null;
  const effects: Record<string, unknown> = {};

  if (["PTP", "PARTIAL_COMMITMENT"].includes(input.businessOutcome) && input.ptp && caseId) {
    const promise = await createPromise(db, {
      customerId: interaction.customerId,
      caseId,
      interactionId: interaction.id,
      amount: input.ptp.amount,
      deadlineDate: input.ptp.deadlineDate,
      coveredLoanIds: input.ptp.coveredLoanIds,
      customerConfirmed: input.ptp.customerConfirmed,
      createdByUserId: params.actorUserId,
      ownerUserId: params.actorUserId,
      now: params.now,
      lastRpcAt: params.now,
      supersedeReason: "New promise agreed in a verified conversation",
    });
    effects.promiseId = promise.id;
  }
  if (input.businessOutcome === "CALLBACK_REQUESTED" && input.callback && caseId && preview.callbackAt) {
    const wi = await createCallbackWorkItem(db, { customerId: interaction.customerId, caseId, dueAt: preview.callbackAt, ownerUserId: input.callback.ownerMode === "ME" ? params.actorUserId : null, reason: `${input.callback.customerRequested ? "CUSTOMER_REQUESTED" : "AGENT_PROPOSED"}: ${input.note ?? "callback"}`, language: interaction.customer.language, requiredSkill: interaction.reservation?.requiredSkill ?? null, sourceInteractionId: interaction.id, now: params.now, actorUserId: params.actorUserId, campaignCode: interaction.campaignCode });
    effects.callbackWorkItemId = wi.id;
  }
  if (input.businessOutcome === "ALREADY_PAID_CLAIM" && caseId) {
    const claim = await db.paymentClaim.create({ data: { customerId: interaction.customerId, loanId: interaction.loanId, interactionId: interaction.id, claimedAmount: input.paidClaim?.amount ?? null, claimedDate: input.paidClaim?.date && isIsoDate(input.paidClaim.date) ? toDbDate(input.paidClaim.date) : null, channel: input.paidClaim?.channel ?? null, reference: input.paidClaim?.reference ?? null, status: "OPEN", holdUntil: preview.reconciliationHoldUntil } });
    await ensureTaskWorkItem(db, { customerId: interaction.customerId, caseId, type: "RECONCILIATION", dueAt: preview.reconciliationHoldUntil, ownerUserId: null, reason: `Already-paid claim ${input.paidClaim?.amount ?? "(amount unknown)"} ${input.paidClaim?.reference ?? ""}`.trim(), sourceInteractionId: interaction.id });
    await db.exceptionCase.upsert({ where: { dedupKey: `CLAIM:${claim.id}` }, create: { dedupKey: `CLAIM:${claim.id}`, type: "CLAIMED_ALREADY_PAID", severity: "WARNING", customerId: interaction.customerId, caseId, title: `Customer claims payment ${input.paidClaim?.amount ?? ""} (${input.paidClaim?.channel ?? "channel unknown"})`, evidence: { claimId: claim.id, reference: input.paidClaim?.reference ?? null } as never, slaDueAt: preview.reconciliationHoldUntil }, update: {} });
    effects.claimId = claim.id;
  }
  if (input.businessOutcome === "DISPUTE" && input.dispute && caseId) {
    const sc = await db.supportCase.create({ data: { customerId: interaction.customerId, caseId, type: "DISPUTE", status: "OPEN", reason: input.dispute.reason, interactionId: interaction.id, createdBy: params.actorUserId, slaDueAt: addHours(params.now, 72) } });
    await ensureTaskWorkItem(db, { customerId: interaction.customerId, caseId, type: "DISPUTE_REVIEW", dueAt: addHours(params.now, 72), ownerUserId: null, reason: input.dispute.reason, sourceInteractionId: interaction.id });
    effects.disputeCaseId = sc.id;
  }
  if ((input.businessOutcome === "SUPPORT_NEEDED" || input.businessOutcome === "SPECIAL_REFERRAL") && input.support && caseId) {
    const special = input.support.type === "SPECIAL_HANDLING" || input.support.type === "DECEASED_LEGAL";
    const deceased = input.support.type === "DECEASED_LEGAL";
    const reportSource = input.support.reportSource ?? (input.identityStatus === "THIRD_PARTY" ? "THIRD_PARTY_CALL" : rpc ? "CUSTOMER_LINE_CALL" : "CALL");
    const sc = await db.supportCase.create({ data: { customerId: interaction.customerId, caseId, type: input.support.type, status: "OPEN", reason: input.support.reason, interactionId: interaction.id, createdBy: params.actorUserId, restrictionUntil: special ? null : addHours(params.now, 14 * 24), restrictsCalls: true, slaDueAt: addHours(params.now, deceased ? 2 * 24 : 5 * 24), reporterRelation: deceased ? input.support.reporterRelation ?? null : null, reportSource: deceased ? reportSource : null } });
    await ensureTaskWorkItem(db, { customerId: interaction.customerId, caseId, type: special ? "HANDOVER" : "SUPPORT_REVIEW", dueAt: addHours(params.now, deceased ? 2 * 24 : 5 * 24), ownerUserId: null, reason: deceased ? `Vəfat barədə məlumat (reported by ${input.support.reporterRelation ?? "unknown"}): verify before any status change. ${input.support.reason}` : input.support.reason, sourceInteractionId: interaction.id, requiredSkill: special ? "SENIOR" : null });
    if (deceased) {
      // Reported, not confirmed: the customer is marked as notified, routine outreach stops immediately, reminders
      // are cancelled and a verification exception goes to a lead/head who confirms or rejects the report.
      await db.customer.update({ where: { id: interaction.customerId }, data: { status: "DECEASED_NOTIFIED" } });
      await db.exceptionCase.upsert({ where: { dedupKey: `DECEASED_VERIFICATION:${interaction.customerId}` }, create: { dedupKey: `DECEASED_VERIFICATION:${interaction.customerId}`, type: "DECEASED_VERIFICATION", severity: "CRITICAL", customerId: interaction.customerId, caseId, title: `Vəfat barədə məlumat: death reported by ${(input.support.reporterRelation ?? "unknown").toLowerCase().replace(/_/g, " ")} via ${reportSource.toLowerCase().replace(/_/g, " ")}; verification required`, evidence: { supportCaseId: sc.id, interactionId: interaction.id, reporterRelation: input.support.reporterRelation ?? null, reportSource } as never, slaDueAt: addHours(params.now, 2 * 24) }, update: { lastSeenAt: params.now, status: "REOPENED" } });
      effects.deceasedWork = await invalidateObsoleteWork(db, interaction.customerId, "DECEASED_REPORTED", params.now, { correlationId: interaction.correlationId });
      const promises = await db.promise.findMany({ where: { customerId: interaction.customerId, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } }, select: { id: true } });
      for (const p of promises) await cancelReminders(db, p.id, "Death reported; reminders paused pending verification", params.now);
    }
    effects.supportCaseId = sc.id;
  }
  if (input.businessOutcome === "PTP_EXCEPTION_PROPOSED" && input.ptp && caseId) {
    // Out-of-policy promise date: nothing is promised yet. A lead/head decides; approval creates the promise.
    const h = promiseHorizonCheck(input.ptp.deadlineDate as never, params.now, promisePolicy);
    const ar = await db.approvalRequest.create({ data: { type: "PTP_EXCEPTION", status: "PENDING", makerUserId: params.actorUserId, objectType: "Interaction", objectId: interaction.id, title: `Promise-date exception: ${input.ptp.amount} AZN by ${input.ptp.deadlineDate} (${interaction.customer.displayName})`, rationale: input.note?.trim() || `Customer proposed a date ${h.daysAhead} days ahead (policy maximum ${promisePolicy.maxHorizonDays} days, until ${h.maxDate}). Reason: ${input.nonPaymentReason ?? "not stated"}.`, afterJson: { customerId: interaction.customerId, caseId, interactionId: interaction.id, amount: input.ptp.amount, deadlineDate: input.ptp.deadlineDate, coveredLoanIds: input.ptp.coveredLoanIds, customerConfirmed: input.ptp.customerConfirmed, agentUserId: params.actorUserId, lastRpcAt: params.now.toISOString() } as never, evidenceJson: { horizon: h, policy: promisePolicy } as never } });
    effects.ptpExceptionApprovalId = ar.id;
  }
  if (input.businessOutcome === "DELINQUENCY_CLOSED") {
    // The verified posting already cured the case through ingestion; re-sync defensively and record the closure.
    effects.case = await syncCustomerCase(db, interaction.customerId, params.now, { actorService: "outcome-service" });
  }
  // Independent flags create owned follow-up tasks without erasing the primary outcome.
  for (const flag of input.secondaryFlags ?? []) {
    if (!caseId) break;
    if (flag === "SUPPORT_REFERRAL_REQUESTED" && input.businessOutcome !== "SUPPORT_NEEDED") {
      const t = await ensureTaskWorkItem(db, { customerId: interaction.customerId, caseId, type: "SUPPORT_REVIEW", dueAt: addHours(params.now, 5 * 24), ownerUserId: null, reason: `Flagged during call: ${input.note ?? "support follow-up"}`, sourceInteractionId: interaction.id });
      effects.supportFollowUpWorkItemId = t.id;
    }
    if (flag === "DISPUTE_RAISED" && input.businessOutcome !== "DISPUTE") {
      const t = await ensureTaskWorkItem(db, { customerId: interaction.customerId, caseId, type: "DISPUTE_REVIEW", dueAt: addHours(params.now, 72), ownerUserId: null, reason: `Flagged during call: ${input.note ?? "dispute"}`, sourceInteractionId: interaction.id });
      effects.disputeFollowUpWorkItemId = t.id;
    }
  }
  if (input.identityStatus === "WRONG_NUMBER" && input.wrongNumber) {
    const cp = interaction.customer.contactPoints.find((c) => c.id === input.wrongNumber!.contactPointId);
    if (!cp) throw unprocessable("Unknown contact point");
    await db.contactPoint.update({ where: { id: cp.id }, data: { verification: "INVALID", invalidReason: "WRONG_NUMBER", invalidatedAt: params.now, invalidatedByInteractionId: interaction.id } });
    await db.exceptionCase.upsert({ where: { dedupKey: `WRONG_NUMBER:${interaction.customerId}:${cp.id}` }, create: { dedupKey: `WRONG_NUMBER:${interaction.customerId}:${cp.id}`, type: "WRONG_NUMBER", severity: "INFO", customerId: interaction.customerId, caseId, title: "Contact point flagged as wrong number; master-data correction needed", evidence: { contactPointId: cp.id } as never }, update: { lastSeenAt: params.now } });
    effects.invalidatedContactPointId = cp.id;
  }

  if (interaction.workItemId) {
    await completeWorkItem(db, interaction.workItemId, params.now, `OUTCOME:${input.businessOutcome}`);
  }
  // Customer-wide effects: any other open voice work for this customer is re-evaluated under the new facts.
  const otherVoice = await db.workItem.findMany({ where: { customerId: interaction.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
  for (const wi of otherVoice) await refreshWorkItemEligibility(db, wi.id, params.now);
  if (rpc && caseId && !["PTP", "PARTIAL_COMMITMENT", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "DISPUTE", "SUPPORT_NEEDED", "SPECIAL_REFERRAL", "DELINQUENCY_CLOSED"].includes(input.businessOutcome)) {
    // Keep a routine CALL item so the customer resurfaces after the cooldown (deferred, not cancelled).
    const existing = await db.workItem.findFirst({ where: { customerId: interaction.customerId, type: "CALL", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } });
    if (!existing) {
      const snapshot = await db.decisionSnapshot.findFirst({ where: { customerId: interaction.customerId, isCurrent: true } });
      if (snapshot && ["AGENT_CALL", "AGENT_CALL_PRIORITY", "SENIOR_AGENT_CALL", "SELECTIVE_AGENT_CALL"].includes(snapshot.effectiveAction)) {
        const wi = await db.workItem.create({ data: { customerId: interaction.customerId, caseId, type: "CALL", status: "DEFERRED", activeKey: `${interaction.customerId}:CALL`, priority: snapshot.era ?? "0.00", rank: snapshot.rank, requiredSkill: snapshot.requiredSkill, language: interaction.customer.language, campaignCode: interaction.campaignCode, decisionSnapshotId: snapshot.id, deferredReasons: ["RPC_COOLDOWN"], nextEligibleAt: preview.cooldownUntil } });
        effects.followUpWorkItemId = wi.id;
      }
    }
  }

  await appendAudit(db, { actorUserId: params.actorUserId, action: "interaction.outcome.saved", objectType: "Interaction", objectId: interaction.id, customerId: interaction.customerId, caseId, correlationId: interaction.correlationId, changes: { identityStatus: input.identityStatus, businessOutcome: input.businessOutcome, nonPaymentReason: input.nonPaymentReason ?? null, nextAction: preview.nextAction, effects }, versionIds: { scriptVersionId: interaction.scriptVersionId, dispositionVersion: interaction.dispositionVersion, policyVersion: `${policy.code}/${policy.version}` } });

  if (interaction.channel === "VOICE_OUTBOUND" && interaction.wrapUpStatus !== "NOT_REQUIRED") {
    await enqueueOutbox(db, "dialer.wrapup", { interactionId: interaction.id, agentRef: session?.providerAgentRef ?? null, dispositionCode: saved.providerDispositionCode, returnReady: input.returnReady }, `wrapup:${interaction.id}`, interaction.correlationId);
  }
  if (session && !input.returnReady) {
    await db.agentSession.update({ where: { id: session.id }, data: { requestedState: "NOT_READY", stateReason: "Agent chose Save & stay Not ready" } });
  }
  return { interaction: saved, duplicate: false, preview, effects };
}

/**
 * Audited correction of a saved outcome: the original stays; a correction row and a new audit event are added.
 * Bank policy is re-evaluated under the corrected facts (promise cancelled when the outcome no longer is a promise,
 * RPC cooldown follows the corrected identity, open work re-checked) and provider callability is reconciled
 * explicitly through a corrected wrap-up command (never assumed from the label change).
 */
export async function correctOutcome(db: Db, params: { interactionId: string; actorUserId: string; reason: string; changes: Partial<Pick<OutcomeInput, "identityStatus" | "businessOutcome" | "nonPaymentReason" | "note">>; now: Date }) {
  const interaction = await db.interaction.findUnique({ where: { id: params.interactionId }, include: { reservation: true } });
  if (!interaction) throw notFound("Interaction not found");
  if (interaction.status !== "SAVED" && interaction.status !== "CORRECTED") throw conflict("Only saved outcomes can be corrected");
  const before = { identityStatus: interaction.identityStatus, businessOutcome: interaction.businessOutcome, nonPaymentReason: interaction.nonPaymentReason, note: interaction.note };
  const after = { ...before, ...params.changes };
  const policy = await getContactPolicy(db);
  await db.outcomeCorrection.create({ data: { interactionId: interaction.id, correctedBy: params.actorUserId, reason: params.reason, beforeJson: before as never, afterJson: after as never } });
  const stillPromise = after.businessOutcome === "PTP" || after.businessOutcome === "PARTIAL_COMMITMENT";
  const effects: Record<string, unknown> = {};
  if (!stillPromise) {
    const cancelled = await db.promise.updateMany({ where: { interactionId: interaction.id, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } }, data: { status: "CANCELLED", cancelReason: `OUTCOME_CORRECTED: ${params.reason}`, suppressionUntil: null } });
    effects.promisesCancelled = cancelled.count;
  }
  const isRpc = after.identityStatus === "RPC_VERIFIED";
  const updated = await db.interaction.update({ where: { id: interaction.id }, data: { ...after, status: "CORRECTED", isRpc, providerDispositionCode: PROVIDER_DISPOSITION_MAP[after.businessOutcome ?? "NO_CONVERSATION"] ?? "NO_RPC", factualSummary: `${interaction.factualSummary ?? ""} CORRECTED (${params.reason}): outcome ${after.businessOutcome}, identity ${after.identityStatus}.`.trim() } });
  // Re-evaluate open voice work for the customer under the corrected facts (cooldown/PTP protection derive from stored facts).
  const open = await db.workItem.findMany({ where: { customerId: interaction.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
  for (const wi of open) await refreshWorkItemEligibility(db, wi.id, params.now);
  effects.workItemsReevaluated = open.length;
  // Provider callability is reconciled explicitly: a corrected disposition is pushed as a new, idempotent wrap-up command.
  if (interaction.channel === "VOICE_OUTBOUND") {
    const session = interaction.reservation?.agentSessionId ? await db.agentSession.findUnique({ where: { id: interaction.reservation.agentSessionId } }) : null;
    await enqueueOutbox(db, "dialer.wrapup", { interactionId: interaction.id, agentRef: session?.providerAgentRef ?? null, dispositionCode: updated.providerDispositionCode, returnReady: false, correction: true, reason: params.reason }, `wrapup-correction:${interaction.id}:${params.now.getTime()}`, interaction.correlationId);
    effects.providerWrapUpCorrectionQueued = true;
  }
  await appendAudit(db, { actorUserId: params.actorUserId, action: "interaction.outcome.corrected", objectType: "Interaction", objectId: interaction.id, customerId: interaction.customerId, reason: params.reason, changes: { before, after, effects }, versionIds: { policyVersion: `${policy.code}/${policy.version}` } });
  return { interaction: updated, effects };
}
