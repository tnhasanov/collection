import { dec, money } from "@/server/money";
import { formatDate, formatBakuDateTime } from "@/server/dates";
import type { OutcomeInput } from "@/server/modules/interactions/outcomeSchema";
import { ot } from "@/i18n/outcomeText";
import type { Locale } from "@/i18n/dictionaries";

/**
 * Deterministic factual summary. Built only from the selected facts; it labels provenance (provider-observed,
 * bank-verified, customer-stated, policy-derived) and never upgrades a claim or a statement into a verified payment
 * or a confirmed promise. The same input and language always produce the same text. English is the reference; the
 * Azerbaijani text carries the same facts in the same order with numeric dates.
 */
export interface SummaryCustomerContext {
  displayName: string;
  overdueDueNow: string; // bank-verified, AZN
  balancesAsOf: Date | string | null;
  loans: { id: string; coreLoanId: string; totalOverdue: string; totalOwed?: string }[];
}
export type Coverage = "FULL" | "PARTIAL" | "NOTHING_DUE" | null;

export function deriveCoverage(input: OutcomeInput, customer: SummaryCustomerContext | null): { coverage: Coverage; coveredOverdue: string | null; derivedOutcome: OutcomeInput["businessOutcome"] } {
  if (!["PTP", "PARTIAL_COMMITMENT"].includes(input.businessOutcome) || !input.ptp || !customer) return { coverage: null, coveredOverdue: null, derivedOutcome: input.businessOutcome };
  const covered = customer.loans.filter((l) => input.ptp!.coveredLoanIds.includes(l.id)).reduce((s, l) => s.plus(l.totalOverdue), dec(0));
  const amount = dec(input.ptp.amount);
  if (covered.lessThanOrEqualTo(0)) return { coverage: "NOTHING_DUE", coveredOverdue: "0.00", derivedOutcome: "PTP" };
  const coverage: Coverage = amount.greaterThanOrEqualTo(covered) ? "FULL" : "PARTIAL";
  return { coverage, coveredOverdue: money(covered).toFixed(2), derivedOutcome: coverage === "PARTIAL" ? "PARTIAL_COMMITMENT" : "PTP" };
}

export function buildFactualSummary(input: OutcomeInput, ctx: { technicalResult: string | null; customer: SummaryCustomerContext | null; policyVersion: string; nextActionLabel: string; routineCallsBlockedUntil: Date | null; callbackAt: Date | null; reconciliationHoldUntil: Date | null; locale?: Locale }): string {
  const L = ctx.locale ?? "en";
  const T = (key: string, vars?: Record<string, string | number | null | undefined>) => ot(L, key, vars);
  const d = (iso: string | Date) => formatDate(typeof iso === "string" ? iso.slice(0, 10) : iso, L);
  const dt = (at: string | Date) => formatBakuDateTime(at, { locale: L });
  const parts: string[] = [];
  const rpc = input.identityStatus === "RPC_VERIFIED";
  if (ctx.technicalResult && ctx.technicalResult !== "ANSWERED") parts.push(T("s.provider", { result: T(`tr.${ctx.technicalResult}`) }));
  parts.push(rpc ? T("s.rpc") : T("s.noRpc", { identity: T(`id.${input.identityStatus}`) }));
  if (rpc && input.nonPaymentReason) parts.push(input.nonPaymentReason === "NOT_STATED" ? T("s.reasonNotStated") : T("s.reason", { reason: T(`rs.${input.nonPaymentReason}`) }));
  if (ctx.customer && rpc) parts.push(T("s.overdue", { amount: fmt(ctx.customer.overdueDueNow), asOf: ctx.customer.balancesAsOf ? dt(ctx.customer.balancesAsOf) : "n/a" }));
  const { coverage, coveredOverdue } = deriveCoverage(input, ctx.customer);
  switch (input.businessOutcome) {
    case "PTP":
    case "PARTIAL_COMMITMENT":
      if (input.ptp) {
        const cov = coverage === "FULL" ? T("s.covFull") : coverage === "PARTIAL" ? T("s.covPartial", { amount: fmt(input.ptp.amount), covered: fmt(coveredOverdue ?? "0"), rest: money(dec(coveredOverdue ?? "0").minus(input.ptp.amount)).toFixed(2) }) : T("s.covNothing");
        parts.push(T("s.ptp", { amount: fmt(input.ptp.amount), date: d(input.ptp.deadlineDate), confirmed: input.ptp.customerConfirmed ? T("s.ptpConfirmed") : T("s.ptpNotConfirmed"), coverage: cov }));
      }
      break;
    case "NO_COMMITMENT":
      parts.push(T("s.noCommitment"));
      break;
    case "REFUSED":
      parts.push(T("s.refused"));
      break;
    case "CALLBACK_REQUESTED":
      parts.push(T("s.callback", { requested: input.callback ? T("s.callbackFor", { at: dt(input.callback.dueAt) }) : "", scheduled: ctx.callbackAt ? T("s.callbackScheduled", { at: dt(ctx.callbackAt) }) : "" }));
      break;
    case "ALREADY_PAID_CLAIM":
      parts.push(T("s.claim", { amount: input.paidClaim?.amount ? T("s.claimAmount", { amount: fmt(input.paidClaim.amount) }) : "", date: input.paidClaim?.date ? T("s.claimDate", { date: d(input.paidClaim.date) }) : "", channel: input.paidClaim?.channel ? T("s.claimChannel", { channel: input.paidClaim.channel }) : "", reference: input.paidClaim?.reference ? T("s.claimRef", { reference: input.paidClaim.reference }) : "", hold: ctx.reconciliationHoldUntil ? T("s.claimHold", { at: dt(ctx.reconciliationHoldUntil) }) : "" }));
      break;
    case "DISPUTE":
      parts.push(T("s.dispute", { reason: input.dispute?.reason ?? "reason recorded" }));
      break;
    case "SUPPORT_NEEDED":
      parts.push(T("s.support", { type: input.support?.type ? T(`st.${input.support.type}`) : "support", reason: input.support?.reason ?? "" }));
      break;
    case "SPECIAL_REFERRAL":
      parts.push(input.support?.type === "DECEASED_LEGAL" ? T("s.deceased", { by: input.support.reporterRelation ? T("s.deceasedBy", { relation: T(`rel.${input.support.reporterRelation}`) }) : "" }) : T("s.special", { type: input.support?.type ? T(`st.${input.support.type}`) : T("st.SPECIAL_HANDLING") }));
      break;
    case "NO_CONVERSATION":
      parts.push(T("s.noConversation"));
      break;
    case "DELINQUENCY_CLOSED":
      parts.push(T("s.closed"));
      break;
    case "PTP_EXCEPTION_PROPOSED":
      if (input.ptp) parts.push(T("s.exception", { amount: fmt(input.ptp.amount), date: d(input.ptp.deadlineDate), confirmed: input.ptp.customerConfirmed ? T("s.exceptionConfirmed") : "" }));
      break;
  }
  if (input.customerStatement && (input.customerStatement.indicativePaymentDate || input.customerStatement.indicativeAmount || input.customerStatement.text)) {
    const bits = [input.customerStatement.indicativeAmount ? `${fmt(input.customerStatement.indicativeAmount)} AZN` : null, input.customerStatement.indicativePaymentDate ? T("s.statementAround", { date: d(input.customerStatement.indicativePaymentDate) }) : null, input.customerStatement.text ? `"${input.customerStatement.text}"` : null].filter(Boolean).join(" ");
    parts.push(T("s.statement", { bits }));
  }
  if (input.identityStatus === "WRONG_NUMBER") parts.push(T("s.wrongNumber"));
  if (input.secondaryFlags?.length) parts.push(T("s.flags", { flags: input.secondaryFlags.map((f) => T(`fl.${f}`)).join("; ") }));
  parts.push(T("s.next", { label: ctx.nextActionLabel, blocked: ctx.routineCallsBlockedUntil ? T("s.nextBlocked", { at: dt(ctx.routineCallsBlockedUntil) }) : "", policy: ctx.policyVersion }));
  return parts.join(" ");
}

function fmt(v: string) {
  return money(dec(v)).toFixed(2);
}

/** English next-action phrases (kept for callers that rebuild an English summary). */
export const NEXT_ACTION_LABELS: Record<string, string> = Object.fromEntries(["POLICY_RETRY", "CONTACT_CORRECTION", "COOLDOWN", "MONITOR_PTP", "ELIGIBLE_CALLBACK", "RECONCILE_CLAIM", "DISPUTE_REVIEW", "SUPPORT_REFERRAL", "SPECIAL_REFERRAL"].map((k) => [k, ot("en", `na.${k}`)]));
