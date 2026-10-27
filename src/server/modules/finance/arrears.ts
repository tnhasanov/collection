import { Decimal, dec, money, ZERO } from "@/server/money";
import { addMonthsClamped, compareIso, daysBetween, type IsoDate } from "@/server/dates";

/**
 * Arrears and DPD derivation for the demo projection.
 * Core DPD stays authoritative in INTEGRATION mode; this module derives the same quantities for
 * synthetic data and for reconciliation comparison.
 *
 * Demo DPD = calendar days from the oldest installment with a strictly overdue unpaid eligible balance
 * above the configured tolerance. Due today = DPD 0; tomorrow = DPD 1 if still unpaid.
 * Partial payment does not cure the oldest installment until its remaining eligible due is satisfied.
 */
export interface InstallmentState {
  id?: string;
  seq: number;
  dueDate: IsoDate;
  principalDue: Decimal.Value;
  interestDue: Decimal.Value;
  feeDue: Decimal.Value;
  paidPrincipal: Decimal.Value;
  paidInterest: Decimal.Value;
  paidFee: Decimal.Value;
}

export type InstallmentStatus = "SCHEDULED" | "DUE" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export interface DerivedInstallment {
  seq: number;
  dueDate: IsoDate;
  totalDue: Decimal;
  paidTotal: Decimal;
  remainingPrincipal: Decimal;
  remainingInterest: Decimal;
  remainingFee: Decimal;
  remainingTotal: Decimal;
  status: InstallmentStatus;
}

export interface LoanArrears {
  installments: DerivedInstallment[];
  overduePrincipal: Decimal;
  overdueInterest: Decimal;
  overdueFees: Decimal;
  totalOverdue: Decimal;
  oldestUnpaidDueDate: IsoDate | null;
  dpd: number;
  nextDueDate: IsoDate | null;
  nextDueAmount: Decimal | null;
  principalRepaid: Decimal;
  isFullyPaid: boolean;
}

export function deriveArrears(installments: InstallmentState[], businessDate: IsoDate, toleranceAzn: Decimal.Value = 0): LoanArrears {
  const tolerance = dec(toleranceAzn);
  const sorted = [...installments].sort((a, b) => a.seq - b.seq);
  const derived: DerivedInstallment[] = [];
  let overduePrincipal = ZERO;
  let overdueInterest = ZERO;
  let overdueFees = ZERO;
  let oldestUnpaidDueDate: IsoDate | null = null;
  let nextDueDate: IsoDate | null = null;
  let nextDueAmount: Decimal | null = null;
  let principalRepaid = ZERO;

  for (const i of sorted) {
    const totalDue = money(dec(i.principalDue).plus(i.interestDue).plus(i.feeDue));
    const paidTotal = money(dec(i.paidPrincipal).plus(i.paidInterest).plus(i.paidFee));
    const remainingPrincipal = money(dec(i.principalDue).minus(i.paidPrincipal));
    const remainingInterest = money(dec(i.interestDue).minus(i.paidInterest));
    const remainingFee = money(dec(i.feeDue).minus(i.paidFee));
    const remainingTotal = money(remainingPrincipal.plus(remainingInterest).plus(remainingFee));
    principalRepaid = principalRepaid.plus(i.paidPrincipal);

    const isDue = compareIso(i.dueDate, businessDate) <= 0;
    const isStrictlyOverdue = compareIso(i.dueDate, businessDate) < 0;
    let status: InstallmentStatus;
    if (remainingTotal.lessThanOrEqualTo(tolerance)) {
      status = "PAID";
    } else if (isStrictlyOverdue) {
      status = "OVERDUE";
    } else if (isDue) {
      status = paidTotal.greaterThan(0) ? "PARTIALLY_PAID" : "DUE";
    } else {
      status = paidTotal.greaterThan(0) ? "PARTIALLY_PAID" : "SCHEDULED";
    }
    if (status === "OVERDUE" && paidTotal.greaterThan(0)) {
      // Keep OVERDUE as the operational status; partial payment is visible via paidTotal.
    }

    if (status === "OVERDUE" || (status === "DUE") || (status === "PARTIALLY_PAID" && isDue)) {
      overduePrincipal = overduePrincipal.plus(remainingPrincipal);
      overdueInterest = overdueInterest.plus(remainingInterest);
      overdueFees = overdueFees.plus(remainingFee);
      if (status === "OVERDUE" && oldestUnpaidDueDate === null) oldestUnpaidDueDate = i.dueDate;
    }
    if (!isDue && nextDueDate === null && status !== "PAID") {
      nextDueDate = i.dueDate;
      nextDueAmount = remainingTotal;
    }
    derived.push({ seq: i.seq, dueDate: i.dueDate, totalDue, paidTotal, remainingPrincipal, remainingInterest, remainingFee, remainingTotal, status });
  }

  const dpd = oldestUnpaidDueDate ? Math.max(0, daysBetween(oldestUnpaidDueDate, businessDate)) : 0;
  const totalOverdue = money(overduePrincipal.plus(overdueInterest).plus(overdueFees));
  const isFullyPaid = derived.every((d) => d.status === "PAID");
  return {
    installments: derived,
    overduePrincipal: money(overduePrincipal),
    overdueInterest: money(overdueInterest),
    overdueFees: money(overdueFees),
    totalOverdue,
    oldestUnpaidDueDate,
    dpd,
    nextDueDate,
    nextDueAmount,
    principalRepaid: money(principalRepaid),
    isFullyPaid,
  };
}

/** "Due now" overdue excludes the installment that is due today but not yet strictly overdue? No: due today counts as due now (DPD 0). */
export function overdueDueNow(arrears: LoanArrears): Decimal {
  return arrears.totalOverdue;
}

/**
 * Demo-only accrued-but-not-overdue interest: pro-rata of the next installment's interest by elapsed days
 * of the current period. Labelled demo; a daily-accrual contract requires its configured rule.
 */
export function demoAccruedInterestNotDue(nextDueDate: IsoDate | null, nextInterestDue: Decimal.Value | null, businessDate: IsoDate): Decimal {
  if (!nextDueDate || nextInterestDue === null) return ZERO;
  const periodStart = addMonthsClamped(nextDueDate, -1);
  const periodDays = Math.max(1, daysBetween(periodStart, nextDueDate));
  const elapsed = Math.min(periodDays, Math.max(0, daysBetween(periodStart, businessDate)));
  return money(dec(nextInterestDue).times(elapsed).div(periodDays));
}
