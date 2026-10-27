import { z } from "zod";

export const IDENTITY_STATUSES = ["RPC_VERIFIED", "THIRD_PARTY", "VERIFICATION_FAILED", "WRONG_PERSON", "WRONG_NUMBER", "NOT_ESTABLISHED"] as const;
export const BUSINESS_OUTCOMES = ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "SPECIAL_REFERRAL", "NO_CONVERSATION"] as const;
export const NON_PAYMENT_REASONS = ["SALARY_TIMING", "TEMPORARY_SHORTFALL", "INCOME_INTERRUPTION", "AFFORDABILITY", "FORGOT", "TECHNICAL_PAYMENT_ISSUE", "DISPUTED_DEBT", "OTHER", "NOT_STATED"] as const;
export const TECHNICAL_RESULTS = ["ANSWERED", "NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE", "CANCELLED", "UNKNOWN"] as const;

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
  support: z.object({ type: z.enum(["HARDSHIP", "COMPLAINT", "SPECIAL_HANDLING", "DECEASED_LEGAL"]), reason: z.string().min(3).max(500) }).nullable().optional(),
  technicalResultCorrection: z.object({ result: z.enum(TECHNICAL_RESULTS), reason: z.string().min(3) }).nullable().optional(),
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

/** Business validation of the structured outcome (beyond shape). Returns human-readable errors. */
export function validateOutcomeBusinessRules(input: OutcomeInput): string[] {
  const errors: string[] = [];
  const rpc = input.identityStatus === "RPC_VERIFIED";
  const conversationOutcomes = ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "DISPUTE", "SUPPORT_NEEDED", "REFUSED"];
  if (!rpc && conversationOutcomes.includes(input.businessOutcome)) errors.push(`${OUTCOME_LABELS[input.businessOutcome]} requires a verified right party`);
  if (input.identityStatus === "THIRD_PARTY" && !["NO_CONVERSATION", "SPECIAL_REFERRAL"].includes(input.businessOutcome)) errors.push("A third-party answer can only be recorded as no conversation or a special-case referral");
  if (input.identityStatus === "WRONG_NUMBER" && !input.wrongNumber?.contactPointId) errors.push("Select the contact point that is wrong");
  if (["WRONG_NUMBER", "WRONG_PERSON", "VERIFICATION_FAILED", "NOT_ESTABLISHED"].includes(input.identityStatus) && input.businessOutcome !== "NO_CONVERSATION") errors.push("Without an established right party the business outcome must be 'No conversation'");
  if (rpc && ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED"].includes(input.businessOutcome) && !input.nonPaymentReason) errors.push("Reason for nonpayment is required for this outcome");
  if (input.nonPaymentReason === "OTHER" && !input.note?.trim()) errors.push("A note is required when the reason is 'Other'");
  if (input.businessOutcome === "SPECIAL_REFERRAL" && !input.note?.trim()) errors.push("A note is required for a special-case referral");
  if (["PTP", "PARTIAL_COMMITMENT"].includes(input.businessOutcome)) {
    if (!input.ptp) errors.push("Promise details are required");
    else {
      if (Number(input.ptp.amount) <= 0) errors.push("Promise amount must be positive");
      if (!input.ptp.customerConfirmed) errors.push("The customer must explicitly confirm the promise");
    }
  }
  if (input.businessOutcome === "CALLBACK_REQUESTED" && !input.callback) errors.push("Callback details are required");
  if (input.businessOutcome === "ALREADY_PAID_CLAIM" && !input.paidClaim) errors.push("Claim details are required (fields may be left empty if unknown)");
  if (input.businessOutcome === "DISPUTE" && !input.dispute) errors.push("Dispute reason is required");
  if (input.businessOutcome === "SUPPORT_NEEDED" && !input.support) errors.push("Support referral details are required");
  if (input.businessOutcome === "SPECIAL_REFERRAL" && !input.support) errors.push("Referral type and reason are required");
  if (input.technicalResultCorrection && !input.technicalResultCorrection.reason.trim()) errors.push("A technical-result correction needs a reason");
  return errors;
}
