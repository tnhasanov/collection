import type { Db } from "@/server/db";
import { dec, money, formatAzn } from "@/server/money";
import { fromDbDate } from "@/server/dates";
import { regularPayment } from "@/server/modules/finance/annuity";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { ACTION_LABELS, type ActionCode } from "@/server/modules/decisions/treatment";
import { SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { rpcCooldownEnd } from "@/server/modules/contactPolicy/evaluator";
import { maskNumber } from "@/server/modules/dialer/contract";
import { notFound } from "@/server/errors";

export const PROBABILITY_SOURCE_LABELS: Record<string, string> = {
  DRAFT_TREE_4_10: "Draft tree (4–10 DPD)",
  DEMO_ONLY_1_3_RULE: "DEMO_ONLY placeholder (1–3 DPD)",
  DRAFT_ROLL_RATE_11_30: "Draft band roll rate (11–30 DPD)",
  NONE: "No approved probability",
};

export type Customer360 = Awaited<ReturnType<typeof getCustomer360>>;

export async function getCustomer360(db: Db, customerId: string, opts: { now: Date; maskContacts: boolean; includeEligibility?: boolean }) {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      contactPoints: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      loans: { orderBy: { originationDate: "asc" } },
      cases: { orderBy: { openedAt: "desc" }, take: 5, include: { owner: true, team: true } },
      promises: { orderBy: { createdAt: "desc" }, take: 10, include: { paymentLinks: true } },
      supportCases: { where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } },
      paymentClaims: { where: { status: "OPEN" } },
      interactions: { orderBy: { startedAt: "desc" }, take: 20, include: { agent: { select: { displayName: true } } } },
      payments: { orderBy: { eventAt: "desc" }, take: 20 },
      workItems: { where: { status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, include: { owner: { select: { displayName: true } } } },
    },
  });
  if (!customer) throw notFound("Customer not found");
  const decision = await db.decisionSnapshot.findFirst({ where: { customerId, isCurrent: true }, include: { modelVersion: true, strategyVersion: true, policyVersion: true, score: true } });
  const policy = await getContactPolicy(db);
  const lastRpc = customer.interactions.find((i) => i.isRpc && (i.status === "SAVED" || i.status === "CORRECTED"));
  const eligibility = opts.includeEligibility === false ? null : await evaluateCustomerEligibility(db, customerId, { channel: "VOICE", now: opts.now });
  const audit = await db.auditEvent.findMany({ where: { customerId }, orderBy: { at: "desc" }, take: 30 });

  const active = customer.loans.filter((l) => l.status === "ACTIVE");
  const overdueDueNow = active.reduce((s, l) => s.plus(l.totalOverdue), dec(0));
  const principalOutstanding = active.reduce((s, l) => s.plus(l.principalOutstanding), dec(0));
  const accrued = active.reduce((s, l) => s.plus(l.accruedInterestNotDue), dec(0));
  const lastPayment = customer.payments.filter((p) => p.status === "POSTED").sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime())[0] ?? null;
  const nextDue = active.filter((l) => l.nextDueDate).sort((a, b) => a.nextDueDate!.getTime() - b.nextDueDate!.getTime())[0] ?? null;
  const openCase = customer.cases.find((c) => c.status === "OPEN" || c.status === "HANDOVER") ?? null;

  const timeline = [
    ...customer.interactions.map((i) => ({ at: i.startedAt, kind: "interaction", text: `${i.channel === "VOICE_OUTBOUND" ? "Call" : i.channel} · ${i.technicalResult ?? ""} · ${i.identityStatus ?? ""} · ${i.businessOutcome ?? "open"}${i.agent ? ` · ${i.agent.displayName}` : ""}`.replace(/ · +· /g, " · "), id: i.id })),
    ...customer.payments.map((p) => ({ at: p.eventAt, kind: "payment", text: `Payment ${p.status} ${formatAzn(p.amount)} (${p.sourceTransactionId})`, id: p.id })),
    ...customer.promises.map((p) => ({ at: p.createdAt, kind: "promise", text: `Promise ${formatAzn(p.amount)} by ${fromDbDate(p.deadlineDate)} · ${p.status}`, id: p.id })),
    ...audit.filter((a) => !["interaction.outcome.saved", "payment.posted", "promise.created"].includes(a.action)).map((a) => ({ at: a.at, kind: "audit", text: `${a.action}${a.reason ? ` · ${a.reason}` : ""}`, id: a.id })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 40);

  return {
    customer: { id: customer.id, cif: customer.cif, displayName: customer.displayName, branch: customer.branch, language: customer.language, status: customer.status, specialHandling: customer.specialHandling, specialHandlingReason: customer.specialHandlingReason, sourceAsOf: customer.sourceAsOf },
    contacts: customer.contactPoints.map((c) => ({ id: c.id, type: c.type, value: opts.maskContacts ? maskNumber(c.value) : c.value, masked: opts.maskContacts, isPrimary: c.isPrimary, verification: c.verification, invalidReason: c.invalidReason, restricted: c.restricted, preferredWindow: c.preferredWindow })),
    loans: customer.loans.map((l) => ({
      id: l.id,
      coreLoanId: l.coreLoanId,
      product: l.product,
      status: l.status,
      principalOriginal: l.principalOriginal.toString(),
      nominalAnnualRate: l.nominalAnnualRate.toString(),
      tenorMonths: l.tenorMonths,
      originationDate: fromDbDate(l.originationDate),
      maturityDate: fromDbDate(l.maturityDate),
      firstDueDate: fromDbDate(l.firstDueDate),
      regularInstallment: money(regularPayment(l.principalOriginal.toString(), l.nominalAnnualRate.toString(), l.tenorMonths)).toFixed(2),
      principalOutstanding: l.principalOutstanding.toString(),
      overduePrincipal: l.overduePrincipal.toString(),
      overdueInterest: l.overdueInterest.toString(),
      accruedInterestNotDue: l.accruedInterestNotDue.toString(),
      feesDue: l.feesDue.toString(),
      unappliedFunds: l.unappliedFunds.toString(),
      totalOverdue: l.totalOverdue.toString(),
      dpd: l.dpd,
      oldestUnpaidDueDate: fromDbDate(l.oldestUnpaidDueDate),
      nextDueDate: fromDbDate(l.nextDueDate),
      nextDueAmount: l.nextDueAmount?.toString() ?? null,
      balancesAsOf: l.balancesAsOf,
      balanceVersion: l.balanceVersion,
      sourceVersion: l.sourceVersion,
      lastPaymentAt: l.lastPaymentAt,
      lastPaymentAmount: l.lastPaymentAmount?.toString() ?? null,
    })),
    summary: {
      overdueDueNow: money(overdueDueNow).toFixed(2),
      principalOutstanding: money(principalOutstanding).toFixed(2),
      accruedInterestNotDue: money(accrued).toFixed(2),
      lastVerifiedPayment: lastPayment ? { at: lastPayment.eventAt, amount: lastPayment.amount.toString(), transactionId: lastPayment.sourceTransactionId } : null,
      nextDue: nextDue ? { date: fromDbDate(nextDue.nextDueDate), amount: nextDue.nextDueAmount?.toString() ?? null, loanId: nextDue.id } : null,
      loansCount: customer.loans.length,
      activeLoans: active.length,
      maxDpd: active.reduce((m, l) => Math.max(m, l.dpd), 0),
      modelExposure: money(principalOutstanding).toFixed(2),
      balancesAsOf: active.reduce<Date | null>((m, l) => (!m || l.balancesAsOf < m ? l.balancesAsOf : m), null),
    },
    case: openCase ? { id: openCase.id, status: openCase.status, episodeNo: openCase.episodeNo, openedAt: openCase.openedAt, ownerName: openCase.owner?.displayName ?? null, teamName: openCase.team?.name ?? null, portfolio: openCase.portfolio } : null,
    caseHistory: customer.cases.map((c) => ({ id: c.id, status: c.status, episodeNo: c.episodeNo, openedAt: c.openedAt, closedAt: c.closedAt, closeReason: c.closeReason })),
    decision: decision
      ? {
          id: decision.id,
          businessDate: fromDbDate(decision.businessDate),
          decisionDpd: decision.decisionDpd,
          segment: decision.segment,
          segmentLabel: SEGMENT_LABELS[decision.segment],
          exposure: decision.exposure.toString(),
          exposureDefinition: decision.exposureDefinition,
          probability: decision.probability?.toString() ?? null,
          probabilitySource: decision.probabilitySource,
          probabilitySourceLabel: PROBABILITY_SOURCE_LABELS[decision.probabilitySource] ?? decision.probabilitySource,
          riskClass: decision.riskClass,
          era: decision.era?.toString() ?? null,
          actionBucket: decision.actionBucket,
          recommendedAction: decision.recommendedAction,
          recommendedActionLabel: ACTION_LABELS[decision.recommendedAction as ActionCode] ?? decision.recommendedAction,
          effectiveAction: decision.effectiveAction,
          effectiveActionLabel: ACTION_LABELS[decision.effectiveAction as ActionCode] ?? decision.effectiveAction,
          rank: decision.rank,
          reasonCodes: decision.reasonCodes,
          requiredSkill: decision.requiredSkill,
          featuresAsOf: decision.score?.featuresAsOf ?? null,
          trace: decision.score?.tracePath ?? null,
          modelVersion: decision.modelVersion ? `${decision.modelVersion.modelCode} ${decision.modelVersion.version} (${decision.modelVersion.status})` : null,
          strategyVersion: decision.strategyVersion ? `${decision.strategyVersion.code} ${decision.strategyVersion.version}` : null,
          policyVersion: decision.policyVersion ? `${decision.policyVersion.code} ${decision.policyVersion.version}` : null,
          createdAt: decision.createdAt,
        }
      : null,
    eligibility: eligibility
      ? { eligible: eligibility.decision.eligible, reasonCodes: eligibility.decision.reasonCodes, reasons: eligibility.decision.reasonCodes.map((c) => REASON_LABELS[c] ?? c), nextAllowedAt: eligibility.decision.nextAllowedAt, policyVersion: eligibility.decision.policyVersion, checks: eligibility.decision.checks.map((c) => ({ code: c.code, label: REASON_LABELS[c.code] ?? c.code, passed: c.passed, detail: c.detail ?? null, blockedUntil: c.blockedUntil ?? null })), contactPointId: eligibility.contactPointId }
      : null,
    restrictions: {
      openDisputes: customer.supportCases.filter((s) => s.type === "DISPUTE").map((s) => ({ id: s.id, reason: s.reason, status: s.status })),
      supportCases: customer.supportCases.filter((s) => s.type !== "DISPUTE").map((s) => ({ id: s.id, type: s.type, reason: s.reason, status: s.status, restrictionUntil: s.restrictionUntil })),
      paidClaims: customer.paymentClaims.map((c) => ({ id: c.id, claimedAmount: c.claimedAmount?.toString() ?? null, reference: c.reference, holdUntil: c.holdUntil })),
      lastRpcAt: lastRpc?.connectedAt ?? lastRpc?.startedAt ?? null,
      cooldownUntil: lastRpc ? rpcCooldownEnd(lastRpc.connectedAt ?? lastRpc.startedAt, policy) : null,
    },
    promises: customer.promises.map((p) => ({ id: p.id, amount: p.amount.toString(), paidAmount: p.paidAmount.toString(), remainingAmount: p.remainingAmount.toString(), deadlineDate: fromDbDate(p.deadlineDate), status: p.status, coveredLoanIds: p.coveredLoanIds, suppressionUntil: p.suppressionUntil, createdAt: p.createdAt, customerConfirmed: p.customerConfirmed, links: p.paymentLinks.length })),
    payments: customer.payments.map((p) => ({ id: p.id, sourceTransactionId: p.sourceTransactionId, loanId: p.loanId, amount: p.amount.toString(), status: p.status, reconciliation: p.reconciliation, valueDate: fromDbDate(p.valueDate), eventAt: p.eventAt })),
    interactions: customer.interactions.map((i) => ({ id: i.id, startedAt: i.startedAt, channel: i.channel, technicalResult: i.technicalResult, identityStatus: i.identityStatus, businessOutcome: i.businessOutcome, nonPaymentReason: i.nonPaymentReason, nextAction: i.nextAction, agentName: i.agent?.displayName ?? null, isRpc: i.isRpc, status: i.status, note: i.note })),
    workItems: customer.workItems.map((w) => ({ id: w.id, type: w.type, status: w.status, deferredReasons: w.deferredReasons, nextEligibleAt: w.nextEligibleAt, dueAt: w.dueAt, ownerName: w.owner?.displayName ?? null, reason: w.reason, rank: w.rank })),
    timeline,
  };
}

export async function searchCustomers(db: Db, q: string, limit = 20) {
  const term = q.trim();
  if (!term) return [];
  const loan = await db.loan.findFirst({ where: { OR: [{ id: term }, { coreLoanId: term }] } });
  const customers = await db.customer.findMany({
    where: { OR: [{ id: { contains: term, mode: "insensitive" } }, { cif: { contains: term, mode: "insensitive" } }, { displayName: { contains: term, mode: "insensitive" } }, ...(loan ? [{ id: loan.customerId }] : [])] },
    take: limit,
    include: { loans: { select: { id: true, dpd: true, totalOverdue: true } } },
  });
  return customers.map((c) => ({ id: c.id, cif: c.cif, displayName: c.displayName, branch: c.branch, maxDpd: c.loans.reduce((m, l) => Math.max(m, l.dpd), 0), totalOverdue: c.loans.reduce((s, l) => s.plus(l.totalOverdue), dec(0)).toFixed(2), loans: c.loans.length }));
}
