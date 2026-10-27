export const IDENTITY_OPTIONS: [string, string][] = [
  ["RPC_VERIFIED", "Right party verified"],
  ["THIRD_PARTY", "Third party answered"],
  ["VERIFICATION_FAILED", "Verification failed"],
  ["WRONG_PERSON", "Wrong person"],
  ["WRONG_NUMBER", "Wrong number"],
  ["NOT_ESTABLISHED", "Not established"],
];
export const OUTCOME_OPTIONS: [string, string][] = [
  ["PTP", "Promise to pay"],
  ["PARTIAL_COMMITMENT", "Partial-payment commitment"],
  ["NO_COMMITMENT", "No commitment"],
  ["CALLBACK_REQUESTED", "Customer-requested callback"],
  ["ALREADY_PAID_CLAIM", "Already-paid claim"],
  ["DISPUTE", "Dispute"],
  ["SUPPORT_NEEDED", "Repayment support needed"],
  ["REFUSED", "Refused to discuss"],
  ["SPECIAL_REFERRAL", "Special-case referral"],
  ["NO_CONVERSATION", "No conversation"],
];
export const REASON_OPTIONS: [string, string][] = [
  ["SALARY_TIMING", "Salary timing"],
  ["TEMPORARY_SHORTFALL", "Temporary cash shortfall"],
  ["INCOME_INTERRUPTION", "Income interruption"],
  ["AFFORDABILITY", "Affordability difficulty"],
  ["FORGOT", "Forgot"],
  ["TECHNICAL_PAYMENT_ISSUE", "Technical payment issue"],
  ["DISPUTED_DEBT", "Disputed debt"],
  ["OTHER", "Other"],
  ["NOT_STATED", "Not stated"],
];
export const TECHNICAL_OPTIONS: [string, string][] = [
  ["ANSWERED", "Answered"],
  ["NO_ANSWER", "No answer"],
  ["BUSY", "Busy"],
  ["UNREACHABLE", "Unreachable"],
  ["MACHINE", "Machine / voicemail"],
  ["FAILED", "Failed"],
];
export function allowedOutcomesFor(identity: string | undefined): string[] {
  if (identity === "RPC_VERIFIED") return OUTCOME_OPTIONS.map((o) => o[0]).filter((o) => o !== "NO_CONVERSATION");
  if (identity === "THIRD_PARTY") return ["NO_CONVERSATION", "SPECIAL_REFERRAL"];
  return ["NO_CONVERSATION"];
}
