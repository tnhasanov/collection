import { dec, money } from "@/server/money";
import { formatDate, formatBakuDateTime } from "@/server/dates";
import { IDENTITY_LABELS, REASON_LABELS_NP, SECONDARY_FLAG_LABELS, type OutcomeInput } from "@/server/modules/interactions/outcomeSchema";

/**
 * Deterministic factual summary (blueprint §5 step D). Built only from the selected facts; it labels provenance
 * (provider-observed, bank-verified, customer-stated, policy-derived) and never upgrades a claim or a statement
 * into a verified payment or a confirmed promise. The same input always produces the same text.
 */
export interface SummaryCustomerContext {
  displayName: string;
  overdueDueNow: string; // bank-verified, AZN
  balancesAsOf: Date | string | null;
  loans: { id: string; coreLoanId: string; totalOverdue: string }[];
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

export function buildFactualSummary(input: OutcomeInput, ctx: { technicalResult: string | null; customer: SummaryCustomerContext | null; policyVersion: string; nextActionLabel: string; routineCallsBlockedUntil: Date | null; callbackAt: Date | null; reconciliationHoldUntil: Date | null }): string {
  const parts: string[] = [];
  const rpc = input.identityStatus === "RPC_VERIFIED";
  if (ctx.technicalResult && ctx.technicalResult !== "ANSWERED") parts.push(`Provider result: ${ctx.technicalResult.toLowerCase().replace(/_/g, " ")} (provider-observed).`);
  parts.push(rpc ? "Borrower verified under the approved procedure." : `${IDENTITY_LABELS[input.identityStatus]}; no verified borrower contact.`);
  if (rpc && input.nonPaymentReason) parts.push(input.nonPaymentReason === "NOT_STATED" ? "Reason not stated by the customer." : `Customer reported: ${REASON_LABELS_NP[input.nonPaymentReason].toLowerCase()} (customer-stated).`);
  if (ctx.customer && rpc) parts.push(`Overdue due now ${fmt(ctx.customer.overdueDueNow)} AZN (bank-verified, as of ${ctx.customer.balancesAsOf ? formatBakuDateTime(ctx.customer.balancesAsOf) : "n/a"}).`);
  const { coverage, coveredOverdue } = deriveCoverage(input, ctx.customer);
  switch (input.businessOutcome) {
    case "PTP":
    case "PARTIAL_COMMITMENT":
      if (input.ptp) {
        const cov = coverage === "FULL" ? "covers the overdue amount in full" : coverage === "PARTIAL" ? `covers ${fmt(input.ptp.amount)} of ${fmt(coveredOverdue ?? "0")} AZN overdue (partial; residual arrears remain)` : "covers the next installment (nothing overdue on the covered loans)";
        parts.push(`Agreed payment: ${fmt(input.ptp.amount)} AZN by ${formatDate(input.ptp.deadlineDate)}${input.ptp.customerConfirmed ? " (customer explicitly confirmed)" : " (NOT confirmed by the customer)"}; ${cov}. Payment pending verification by core banking.`);
      }
      break;
    case "NO_COMMITMENT":
      parts.push("No payment commitment made.");
      break;
    case "REFUSED":
      parts.push("Customer declined to discuss the debt.");
      break;
    case "CALLBACK_REQUESTED":
      parts.push(`Customer requested a callback${input.callback ? ` for ${formatBakuDateTime(input.callback.dueAt)}` : ""}${ctx.callbackAt ? `; scheduled ${formatBakuDateTime(ctx.callbackAt)} under policy` : ""}.`);
      break;
    case "ALREADY_PAID_CLAIM":
      parts.push(`Customer claims a payment${input.paidClaim?.amount ? ` of ${fmt(input.paidClaim.amount)} AZN` : ""}${input.paidClaim?.date ? ` on ${formatDate(input.paidClaim.date)}` : ""}${input.paidClaim?.channel ? ` via ${input.paidClaim.channel}` : ""}${input.paidClaim?.reference ? ` (ref ${input.paidClaim.reference})` : ""} (customer-stated, not verified); reconciliation opened${ctx.reconciliationHoldUntil ? `, hold until ${formatBakuDateTime(ctx.reconciliationHoldUntil)}` : ""}.`);
      break;
    case "DISPUTE":
      parts.push(`Customer disputes the debt: ${input.dispute?.reason ?? "reason recorded"} (customer-stated); specialist review opened.`);
      break;
    case "SUPPORT_NEEDED":
      parts.push(`Repayment support requested (${input.support?.type?.toLowerCase().replace(/_/g, " ") ?? "support"}): ${input.support?.reason ?? ""} (customer-stated); no contract change agreed.`);
      break;
    case "SPECIAL_REFERRAL":
      parts.push(input.support?.type === "DECEASED_LEGAL" ? `Death of the borrower reported${input.support.reporterRelation ? ` by ${input.support.reporterRelation.toLowerCase().replace(/_/g, " ")}` : ""} (reported, not confirmed); verification task opened and routine contact stopped.` : `Special-case referral (${input.support?.type?.toLowerCase().replace(/_/g, " ") ?? "special handling"}).`);
      break;
    case "NO_CONVERSATION":
      parts.push("No conversation with the borrower took place.");
      break;
    case "DELINQUENCY_CLOSED":
      parts.push("Overdue cleared by a verified core posting during the conversation (bank-verified); the collection episode closes (Gecikmə bağlanıb). No promise or follow-up contact created.");
      break;
    case "PTP_EXCEPTION_PROPOSED":
      if (input.ptp) parts.push(`Customer proposed ${fmt(input.ptp.amount)} AZN by ${formatDate(input.ptp.deadlineDate)}${input.ptp.customerConfirmed ? " (customer confirmed the proposal)" : ""}; the date is outside the promise policy, so a promise-date exception was sent for approval. No promise, reminder or protection exists until it is approved.`);
      break;
  }
  if (input.customerStatement && (input.customerStatement.indicativePaymentDate || input.customerStatement.indicativeAmount || input.customerStatement.text)) {
    const bits = [input.customerStatement.indicativeAmount ? `${fmt(input.customerStatement.indicativeAmount)} AZN` : null, input.customerStatement.indicativePaymentDate ? `around ${formatDate(input.customerStatement.indicativePaymentDate)}` : null, input.customerStatement.text ? `"${input.customerStatement.text}"` : null].filter(Boolean).join(" ");
    parts.push(`Customer mentioned a possible payment ${bits} (customer-stated, not a commitment; no promise created).`);
  }
  if (input.identityStatus === "WRONG_NUMBER") parts.push("Contact point flagged as wrong number (evidence-based correction).");
  if (input.secondaryFlags?.length) parts.push(`Also noted: ${input.secondaryFlags.map((f) => SECONDARY_FLAG_LABELS[f].toLowerCase()).join("; ")}.`);
  parts.push(`Next action: ${ctx.nextActionLabel}${ctx.routineCallsBlockedUntil ? `; no routine call before ${formatBakuDateTime(ctx.routineCallsBlockedUntil)}` : ""} (policy ${ctx.policyVersion}).`);
  return parts.join(" ");
}

function fmt(v: string) {
  return money(dec(v)).toFixed(2);
}

export const NEXT_ACTION_LABELS: Record<string, string> = {
  POLICY_RETRY: "retry only within policy timing and limits",
  CONTACT_CORRECTION: "contact correction; use an eligible alternative contact",
  COOLDOWN: "verified-contact cooldown",
  MONITOR_PTP: "monitor the promise under the active contact policy",
  ELIGIBLE_CALLBACK: "eligible callback",
  RECONCILE_CLAIM: "reconcile the claimed payment",
  DISPUTE_REVIEW: "dispute review",
  SUPPORT_REFERRAL: "repayment-support assessment",
  SPECIAL_REFERRAL: "special-case handling",
};
