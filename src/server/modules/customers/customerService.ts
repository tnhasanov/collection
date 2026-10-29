import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { customerWhere, type CustomerScope } from "@/server/auth/scope";
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

/** Normalizes a telephone search term to digits (international prefix 00 → +, leading 0 dropped) for matching stored E.164 values. */
export function normalizePhoneTerm(term: string): string | null {
  const digits = term.replace(/[^\d+]/g, "");
  if (!/^\+?\d{5,15}$/.test(digits)) return null;
  let d = digits.replace(/^\+/, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length <= 10) d = `994${d.slice(1)}`;
  return d;
}

export interface SearchResult {
  rows: { id: string; cif: string; displayName: string; branch: string; maxDpd: number; totalOverdue: string; loans: number; matchedBy: "NAME_OR_ID" | "CIF" | "LOAN" | "PHONE" }[];
  hiddenByScope: number;
  normalized: { phone: string | null } | null;
}

/**
 * Scoped customer search by name, customer id, CIF, loan id or telephone number. The authorization scope is part of
 * the query (not a post-filter), so paging never leaks rows; the count of matches hidden by scope is reported.
 * A shared telephone number is a lookup aid only, never proof of identity.
 */
export async function searchCustomers(db: Db, q: string, opts: { limit?: number; scope?: CustomerScope } = {}): Promise<SearchResult> {
  const limit = opts.limit ?? 20;
  const term = q.trim();
  if (!term) return { rows: [], hiddenByScope: 0, normalized: null };
  const phone = normalizePhoneTerm(term);
  const loan = await db.loan.findFirst({ where: { OR: [{ id: term }, { coreLoanId: term }] }, select: { customerId: true } });
  const phoneCustomers = phone ? await db.contactPoint.findMany({ where: { type: { in: ["MOBILE", "LANDLINE"] }, value: { contains: phone.slice(-9) } }, select: { customerId: true }, take: 50 }) : [];
  const or: Prisma.CustomerWhereInput[] = [
    { id: { contains: term, mode: "insensitive" } },
    { cif: { contains: term, mode: "insensitive" } },
    { displayName: { contains: term, mode: "insensitive" } },
    ...(loan ? [{ id: loan.customerId }] : []),
    ...(phoneCustomers.length ? [{ id: { in: [...new Set(phoneCustomers.map((p) => p.customerId))] } }] : []),
  ];
  const match: Prisma.CustomerWhereInput = { OR: or };
  const scopeWhere = opts.scope ? customerWhere(opts.scope) : {};
  const [customers, total] = await Promise.all([
    db.customer.findMany({ where: { AND: [match, scopeWhere] }, take: limit, orderBy: { displayName: "asc" }, include: { loans: { select: { id: true, dpd: true, totalOverdue: true } } } }),
    opts.scope ? db.customer.count({ where: match }) : Promise.resolve(0),
  ]);
  const rows = customers.map((c) => ({
    id: c.id,
    cif: c.cif,
    displayName: c.displayName,
    branch: c.branch,
    maxDpd: c.loans.reduce((m, l) => Math.max(m, l.dpd), 0),
    totalOverdue: c.loans.reduce((s, l) => s.plus(l.totalOverdue), dec(0)).toFixed(2),
    loans: c.loans.length,
    matchedBy: (loan && loan.customerId === c.id ? "LOAN" : phoneCustomers.some((p) => p.customerId === c.id) ? "PHONE" : c.cif.toLowerCase().includes(term.toLowerCase()) ? "CIF" : "NAME_OR_ID") as SearchResult["rows"][number]["matchedBy"],
  }));
  return { rows, hiddenByScope: opts.scope ? Math.max(0, total - rows.length) : 0, normalized: { phone } };
}
