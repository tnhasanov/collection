import { z } from "zod";
import { t, type Locale } from "@/i18n/dictionaries";
import { ot } from "@/i18n/outcomeText";

export const IDENTITY_STATUSES = ["RPC_VERIFIED", "THIRD_PARTY", "VERIFICATION_FAILED", "WRONG_PERSON", "WRONG_NUMBER", "NOT_ESTABLISHED"] as const;
export const BUSINESS_OUTCOMES = ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "SPECIAL_REFERRAL", "NO_CONVERSATION", "DELINQUENCY_CLOSED", "PTP_EXCEPTION_PROPOSED"] as const;
/** Who reported a special case (deceased / legal) relative to the customer; stored on the support case, never inferred. */
export const REPORTER_RELATIONS = ["SPOUSE", "CHILD", "PARENT", "SIBLING", "RELATIVE", "EMPLOYER", "LEGAL_REPRESENTATIVE", "OTHER"] as const;
export const REPORTER_RELATION_LABELS: Record<(typeof REPORTER_RELATIONS)[number], string> = { SPOUSE: "Spouse", CHILD: "Child", PARENT: "Parent", SIBLING: "Sibling", RELATIVE: "Other relative", EMPLOYER: "Employer", LEGAL_REPRESENTATIVE: "Legal representative", OTHER: "Other" };
export const NON_PAYMENT_REASONS = ["SALARY_TIMING", "TEMPORARY_SHORTFALL", "INCOME_INTERRUPTION", "AFFORDABILITY", "FORGOT", "TECHNICAL_PAYMENT_ISSUE", "DISPUTED_DEBT", "OTHER", "NOT_STATED"] as const;
export const TECHNICAL_RESULTS = ["ANSWERED", "NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE", "CANCELLED", "UNKNOWN"] as const;
/** Independent facts that may accompany any primary outcome (blueprint §5 step C). */
export const SECONDARY_FLAGS = ["SUPPORT_REFERRAL_REQUESTED", "DISPUTE_RAISED", "CONTACT_DETAILS_CHANGED", "VULNERABILITY_INDICATED"] as const;
export const SECONDARY_FLAG_LABELS: Record<(typeof SECONDARY_FLAGS)[number], string> = {
  SUPPORT_REFERRAL_REQUESTED: "Repayment-support follow-up requested",
  DISPUTE_RAISED: "Dispute raised",
  CONTACT_DETAILS_CHANGED: "Contact details changed",
  VULNERABILITY_INDICATED: "Vulnerability indicated",
};

const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive number with up to 2 decimals");

export const outcomeSchema = z.object({
  idempotencyKey: z.string().min(8).max(120),
  identityStatus: z.enum(IDENTITY_STATUSES),
  businessOutcome: z.enum(BUSINESS_OUTCOMES),
  nonPaymentReason: z.enum(NON_PAYMENT_REASONS).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  ptp: z.object({ amount: moneyString, deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), coveredLoanIds: z.array(z.string()).min(1), customerConfirmed: z.boolean() }).nullable().optional(),
  callback: z.object({ dueAt: z.string(), customerRequested: z.boolean(), ownerMode: z.enum(["ME", "POOL"]) }).nullable().optional(),
  paidClaim: z.object({ amount: moneyString.nullable().optional(), date: z.string().nullable().optional(), channel: z.string().max(80).nullable().optional(), reference: z.string().max(80).nullable().optional() }).nullable().optional(),
  wrongNumber: z.object({ contactPointId: z.string() }).nullable().optional(),
  dispute: z.object({ reason: z.string().min(3).max(500) }).nullable().optional(),
  support: z.object({ type: z.enum(["HARDSHIP", "COMPLAINT", "SPECIAL_HANDLING", "DECEASED_LEGAL"]), reason: z.string().min(3).max(500), reporterRelation: z.enum(REPORTER_RELATIONS).nullable().optional(), reportSource: z.string().max(80).nullable().optional() }).nullable().optional(),
  technicalResultCorrection: z.object({ result: z.enum(TECHNICAL_RESULTS), reason: z.string().min(3) }).nullable().optional(),
  /** Customer-stated, non-binding information ("I might pay Friday"): recorded with provenance, never a promise. */
  customerStatement: z.object({ indicativePaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), indicativeAmount: moneyString.nullable().optional(), text: z.string().max(300).nullable().optional() }).nullable().optional(),
  secondaryFlags: z.array(z.enum(SECONDARY_FLAGS)).max(4).optional(),
  returnReady: z.boolean(),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

export const draftSchema = outcomeSchema.partial().extend({ idempotencyKey: z.string().min(8).max(120) });
export type DraftInput = z.infer<typeof draftSchema>;

export const OUTCOME_LABELS: Record<(typeof BUSINESS_OUTCOMES)[number], string> = {
  PTP: "Promise to pay",
  PARTIAL_COMMITMENT: "Partial-payment commitment",
  NO_COMMITMENT: "No commitment",
  CALLBACK_REQUESTED: "Customer-requested callback",
  ALREADY_PAID_CLAIM: "Already-paid claim",
  DISPUTE: "Dispute",
  SUPPORT_NEEDED: "Repayment support needed",
  REFUSED: "Refused to discuss",
  SPECIAL_REFERRAL: "Special-case referral",
  NO_CONVERSATION: "No conversation",
  DELINQUENCY_CLOSED: "Overdue cleared during the call (Gecikmə bağlanıb)",
  PTP_EXCEPTION_PROPOSED: "Promise date outside policy (exception proposed)",
};

export const IDENTITY_LABELS: Record<(typeof IDENTITY_STATUSES)[number], string> = {
  RPC_VERIFIED: "Right party verified",
  THIRD_PARTY: "Third party",
  VERIFICATION_FAILED: "Verification failed",
  WRONG_PERSON: "Wrong person",
  WRONG_NUMBER: "Wrong number",
  NOT_ESTABLISHED: "Not established",
};

export const REASON_LABELS_NP: Record<(typeof NON_PAYMENT_REASONS)[number], string> = {
  SALARY_TIMING: "Salary timing",
  TEMPORARY_SHORTFALL: "Temporary cash shortfall",
  INCOME_INTERRUPTION: "Income interruption",
  AFFORDABILITY: "Affordability difficulty",
  FORGOT: "Forgot",
  TECHNICAL_PAYMENT_ISSUE: "Technical payment issue",
  DISPUTED_DEBT: "Disputed debt",
  OTHER: "Other",
  NOT_STATED: "Not stated",
};

/** Business validation of the structured outcome (beyond shape). Returns human-readable errors in the given language. */
export function validateOutcomeBusinessRules(input: OutcomeInput, locale: Locale = "en"): string[] {
  const T = (k: string, v?: Record<string, string | number>) => ot(locale, k, v);
  const outcomeLabel = (o: string) => (locale === "en" ? OUTCOME_LABELS[o as keyof typeof OUTCOME_LABELS] : t(locale, `agent.outcomes.${o}`));
  const errors: string[] = [];
  const rpc = input.identityStatus === "RPC_VERIFIED";
  const conversationOutcomes = ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "DELINQUENCY_CLOSED", "PTP_EXCEPTION_PROPOSED"];
  if (!rpc && conversationOutcomes.includes(input.businessOutcome)) errors.push(T("v.requiresRpc", { outcome: outcomeLabel(input.businessOutcome) }));
  if (input.identityStatus === "THIRD_PARTY" && !["NO_CONVERSATION", "SPECIAL_REFERRAL"].includes(input.businessOutcome)) errors.push(T("v.thirdPartyLimited"));
  if (input.identityStatus === "WRONG_NUMBER" && !input.wrongNumber?.contactPointId) errors.push(T("v.wrongNumberPick"));
  if (["WRONG_NUMBER", "WRONG_PERSON", "VERIFICATION_FAILED", "NOT_ESTABLISHED"].includes(input.identityStatus) && input.businessOutcome !== "NO_CONVERSATION") errors.push(T("v.noPartyNoConversation"));
  if (rpc && ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED", "PTP_EXCEPTION_PROPOSED"].includes(input.businessOutcome) && !input.nonPaymentReason) errors.push(T("v.reasonRequired"));
  if (input.nonPaymentReason === "OTHER" && !input.note?.trim()) errors.push(T("v.otherNote"));
  if (input.businessOutcome === "SPECIAL_REFERRAL" && !input.note?.trim()) errors.push(T("v.specialNote"));
  if (["PTP", "PARTIAL_COMMITMENT", "PTP_EXCEPTION_PROPOSED"].includes(input.businessOutcome)) {
    if (!input.ptp) errors.push(T("v.promiseDetails"));
    else {
      if (Number(input.ptp.amount) <= 0) errors.push(T("v.promisePositive"));
      if (!input.ptp.customerConfirmed) errors.push(T("v.promiseConfirm"));
    }
  }
  if (input.businessOutcome === "CALLBACK_REQUESTED" && !input.callback) errors.push(T("v.callbackDetails"));
  if (input.businessOutcome === "ALREADY_PAID_CLAIM" && !input.paidClaim) errors.push(T("v.claimDetails"));
  if (input.businessOutcome === "DISPUTE" && !input.dispute) errors.push(T("v.disputeReason"));
  if (input.businessOutcome === "SUPPORT_NEEDED" && !input.support) errors.push(T("v.supportDetails"));
  if (input.businessOutcome === "SPECIAL_REFERRAL" && !input.support) errors.push(T("v.referralDetails"));
  if (input.support?.type === "DECEASED_LEGAL" && !input.support.reporterRelation) errors.push(T("v.deceasedReporter"));
  if (input.technicalResultCorrection && !input.technicalResultCorrection.reason.trim()) errors.push(T("v.correctionReason"));
  if (input.customerStatement && (input.customerStatement.indicativePaymentDate || input.customerStatement.indicativeAmount) && ["PTP", "PARTIAL_COMMITMENT"].includes(input.businessOutcome)) errors.push(T("v.statementWithPromise"));
  if (input.customerStatement && (input.customerStatement.indicativePaymentDate || input.customerStatement.indicativeAmount) && !["NO_COMMITMENT", "REFUSED", "CALLBACK_REQUESTED"].includes(input.businessOutcome)) errors.push(T("v.statementOnlyWith"));
  for (const flag of input.secondaryFlags ?? []) {
    if (flag === "DISPUTE_RAISED" && input.businessOutcome !== "DISPUTE" && !input.note?.trim()) errors.push(T("v.flagDisputeNote"));
    if (flag === "SUPPORT_REFERRAL_REQUESTED" && input.businessOutcome !== "SUPPORT_NEEDED" && !input.note?.trim()) errors.push(T("v.flagSupportNote"));
    if (!rpc && (flag === "DISPUTE_RAISED" || flag === "SUPPORT_REFERRAL_REQUESTED")) errors.push(T("v.flagsRequireRpc"));
  }
  return [...new Set(errors)];
}
