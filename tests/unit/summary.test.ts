import { describe, expect, it } from "vitest";
import { buildFactualSummary, deriveCoverage } from "@/server/modules/interactions/summary";
import { outcomeSchema, validateOutcomeBusinessRules } from "@/server/modules/interactions/outcomeSchema";

const customer = { displayName: "Demo customer 001", overdueDueNow: "499.24", balancesAsOf: new Date("2026-10-27T05:55:00Z"), loans: [{ id: "L-DEMO-001", coreLoanId: "CORE-L-DEMO-001", totalOverdue: "499.24" }] };
const base = { idempotencyKey: "unit-summary-0001", identityStatus: "RPC_VERIFIED", returnReady: true } as const;
const ctx = { technicalResult: "ANSWERED", customer, policyVersion: "CONTACT_POLICY/DEMO-01", nextActionLabel: "monitor the promise under the active contact policy", routineCallsBlockedUntil: new Date("2026-11-01T19:59:59.999Z"), callbackAt: null, reconciliationHoldUntil: null };

describe("guided outcome: derived coverage and deterministic factual summary", () => {
  it("derives full versus partial coverage from bank-verified obligations instead of an agent choice", () => {
    const full = outcomeSchema.parse({ ...base, businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "499.24", deadlineDate: "2026-10-30", coveredLoanIds: ["L-DEMO-001"], customerConfirmed: true } });
    expect(deriveCoverage(full, customer)).toMatchObject({ coverage: "FULL", derivedOutcome: "PTP" });
    const partial = outcomeSchema.parse({ ...full, ptp: { ...full.ptp!, amount: "200.00" } });
    expect(deriveCoverage(partial, customer)).toMatchObject({ coverage: "PARTIAL", derivedOutcome: "PARTIAL_COMMITMENT", coveredOverdue: "499.24" });
    const nothingDue = outcomeSchema.parse({ ...full, ptp: { ...full.ptp!, coveredLoanIds: ["L-OTHER"] } });
    expect(deriveCoverage(nothingDue, { ...customer, loans: [{ id: "L-OTHER", coreLoanId: "X", totalOverdue: "0.00" }] })).toMatchObject({ coverage: "NOTHING_DUE", derivedOutcome: "PTP" });
  });

  it("writes the blueprint example wording with provenance and keeps the claim a claim", () => {
    const ptp = outcomeSchema.parse({ ...base, businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "499.24", deadlineDate: "2026-10-30", coveredLoanIds: ["L-DEMO-001"], customerConfirmed: true } });
    const text = buildFactualSummary(ptp, ctx);
    expect(text).toBe("Borrower verified under the approved procedure. Customer reported: salary timing (customer-stated). Overdue due now 499.24 AZN (bank-verified, as of 27 Oct 2026, 09:55). Agreed payment: 499.24 AZN by 30 Oct 2026 (customer explicitly confirmed); covers the overdue amount in full. Payment pending verification by core banking. Next action: monitor the promise under the active contact policy; no routine call before 01 Nov 2026, 23:59 (policy CONTACT_POLICY/DEMO-01).");
    expect(buildFactualSummary(ptp, ctx)).toBe(text); // deterministic
    const claim = outcomeSchema.parse({ ...base, businessOutcome: "ALREADY_PAID_CLAIM", nonPaymentReason: "TECHNICAL_PAYMENT_ISSUE", paidClaim: { amount: "499.24", date: "2026-10-26" } });
    const claimText = buildFactualSummary(claim, { ...ctx, nextActionLabel: "reconcile the claimed payment", reconciliationHoldUntil: new Date("2026-10-29T05:55:00Z") });
    expect(claimText).toContain("Customer claims a payment of 499.24 AZN on 26 Oct 2026 (customer-stated, not verified); reconciliation opened, hold until 29 Oct 2026, 09:55.");
    expect(claimText).not.toMatch(/verified payment|payment received/i);
  });

  it("keeps 'might pay Friday' a statement and refuses unconfirmed or inconsistent promises", () => {
    const statement = outcomeSchema.parse({ ...base, businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", customerStatement: { indicativePaymentDate: "2026-10-30", text: "might pay Friday" } });
    expect(validateOutcomeBusinessRules(statement)).toEqual([]);
    expect(buildFactualSummary(statement, { ...ctx, nextActionLabel: "verified-contact cooldown" })).toContain("Customer mentioned a possible payment around 30 Oct 2026 \"might pay Friday\" (customer-stated, not a commitment; no promise created).");
    const unconfirmed = outcomeSchema.parse({ ...base, businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "499.24", deadlineDate: "2026-10-30", coveredLoanIds: ["L-DEMO-001"], customerConfirmed: false } });
    expect(validateOutcomeBusinessRules(unconfirmed)).toContain("The customer must explicitly confirm the promise");
    const mixed = outcomeSchema.parse({ ...unconfirmed, ptp: { ...unconfirmed.ptp!, customerConfirmed: true }, customerStatement: { indicativePaymentDate: "2026-11-02" } });
    expect(validateOutcomeBusinessRules(mixed).some((e) => e.includes("cannot accompany a confirmed promise"))).toBe(true);
    const thirdParty = outcomeSchema.parse({ ...base, identityStatus: "THIRD_PARTY", businessOutcome: "PTP", ptp: { amount: "1.00", deadlineDate: "2026-10-30", coveredLoanIds: ["x"], customerConfirmed: true } });
    expect(validateOutcomeBusinessRules(thirdParty).length).toBeGreaterThan(0);
    const flagged = outcomeSchema.parse({ ...base, businessOutcome: "NO_COMMITMENT", nonPaymentReason: "AFFORDABILITY", secondaryFlags: ["SUPPORT_REFERRAL_REQUESTED"] });
    expect(validateOutcomeBusinessRules(flagged)).toContain("A short factual note is required when a support referral is flagged alongside another outcome");
  });
});
