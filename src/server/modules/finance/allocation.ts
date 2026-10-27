import { Decimal, dec, money, ZERO } from "@/server/money";
import { compareIso, type IsoDate } from "@/server/dates";

/**
 * DEMO-ONLY payment allocation: oldest due installment first, interest before principal, no fee creation.
 * Only installments due on or before the payment value date receive allocations; any remainder stays
 * unapplied (no automatic prepayment is invented). Production uses imported core allocations.
 */
export const DEMO_ALLOCATION_POLICY = "DEMO_OLDEST_DUE_FIRST_INTEREST_THEN_PRINCIPAL";

export interface AllocatableInstallment {
  id: string;
  seq: number;
  dueDate: IsoDate;
  remainingInterest: Decimal.Value;
  remainingPrincipal: Decimal.Value;
  remainingFee: Decimal.Value;
}

export interface AllocationLine {
  installmentId: string;
  seq: number;
  interestAmount: Decimal;
  principalAmount: Decimal;
  feeAmount: Decimal;
}

export interface AllocationResult {
  lines: AllocationLine[];
  unapplied: Decimal;
  policy: string;
}

export function allocatePayment(amount: Decimal.Value, installments: AllocatableInstallment[], valueDate: IsoDate): AllocationResult {
  let remaining = money(amount);
  if (remaining.lessThanOrEqualTo(0)) return { lines: [], unapplied: ZERO, policy: DEMO_ALLOCATION_POLICY };
  const due = installments
    .filter((i) => compareIso(i.dueDate, valueDate) <= 0)
    .sort((a, b) => a.seq - b.seq);
  const lines: AllocationLine[] = [];
  for (const inst of due) {
    if (remaining.lessThanOrEqualTo(0)) break;
    let interest = ZERO;
    let principal = ZERO;
    let fee = ZERO;
    const remInterest = money(inst.remainingInterest);
    const remPrincipal = money(inst.remainingPrincipal);
    const remFee = money(inst.remainingFee);
    if (remInterest.greaterThan(0)) {
      interest = Decimal.min(remInterest, remaining);
      remaining = remaining.minus(interest);
    }
    if (remaining.greaterThan(0) && remPrincipal.greaterThan(0)) {
      principal = Decimal.min(remPrincipal, remaining);
      remaining = remaining.minus(principal);
    }
    if (remaining.greaterThan(0) && remFee.greaterThan(0)) {
      fee = Decimal.min(remFee, remaining);
      remaining = remaining.minus(fee);
    }
    if (interest.greaterThan(0) || principal.greaterThan(0) || fee.greaterThan(0)) {
      lines.push({ installmentId: inst.id, seq: inst.seq, interestAmount: interest, principalAmount: principal, feeAmount: fee });
    }
  }
  return { lines, unapplied: money(remaining), policy: DEMO_ALLOCATION_POLICY };
}

export { dec };
