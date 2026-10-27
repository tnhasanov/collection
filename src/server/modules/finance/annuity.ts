import { Decimal, dec, money, ZERO } from "@/server/money";
import { addMonthsClamped, isIsoDate, type IsoDate } from "@/server/dates";

/**
 * Regular monthly annuity engine (demo generator, simulation and comparison tool).
 *
 * r = j / 12 ; A = P × r / (1 − (1 + r)^−n) ; if r = 0, A = P / n.
 * Per period: interest = opening × r ; principal = A − interest ; closing = opening − principal.
 *
 * Rounding policy (demo default, documented): AZN cents, half-up, applied per installment component.
 * The final installment is adjusted so the remaining principal is cleared exactly; the difference versus
 * the regular payment is disclosed as `finalAdjustment`.
 *
 * This engine does not model irregular first periods, daily accrual, rate changes, insurance or fees.
 * Imported core schedules are authoritative; this engine never overwrites them.
 */
export interface AnnuityInput {
  principal: Decimal.Value;
  /** Nominal annual rate as a fraction, e.g. 0.18 for 18%. */
  nominalAnnualRate: Decimal.Value;
  months: number;
  firstDueDate: IsoDate;
  /** Day-of-month anchor for subsequent due dates (defaults to the day of the first due date). */
  paymentDay?: number;
}

export interface AnnuityInstallment {
  seq: number;
  dueDate: IsoDate;
  openingPrincipal: Decimal;
  interestDue: Decimal;
  principalDue: Decimal;
  totalDue: Decimal;
  closingPrincipal: Decimal;
}

export interface AnnuitySchedule {
  regularPayment: Decimal;
  regularPaymentUnrounded: Decimal;
  periodicRate: Decimal;
  installments: AnnuityInstallment[];
  finalAdjustment: Decimal;
  totalInterest: Decimal;
  totalPayable: Decimal;
  basis: {
    formula: string;
    rounding: string;
    calendar: string;
    rateLabel: string;
  };
}

export class AnnuityValidationError extends Error {}

export function regularPayment(principal: Decimal.Value, nominalAnnualRate: Decimal.Value, months: number): Decimal {
  const P = dec(principal);
  const r = dec(nominalAnnualRate).div(12);
  if (r.isZero()) return P.div(months);
  const one = new Decimal(1);
  const factor = one.minus(one.plus(r).pow(-months));
  return P.times(r).div(factor);
}

export function buildAnnuitySchedule(input: AnnuityInput): AnnuitySchedule {
  const P = dec(input.principal);
  const j = dec(input.nominalAnnualRate);
  const n = input.months;

  if (!P.isFinite() || P.lessThanOrEqualTo(0)) throw new AnnuityValidationError("Principal must be positive");
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new AnnuityValidationError("Tenor must be an integer number of months between 1 and 600");
  if (!j.isFinite() || j.isNegative() || j.greaterThan(5)) throw new AnnuityValidationError("Nominal annual rate must be between 0 and 500%");
  if (!isIsoDate(input.firstDueDate)) throw new AnnuityValidationError("First due date must be an ISO date");

  const r = j.div(12);
  const A = regularPayment(P, j, n);
  const Ar = money(A);
  const anchorDay = input.paymentDay ?? Number(input.firstDueDate.slice(8, 10));

  const installments: AnnuityInstallment[] = [];
  let opening = money(P);
  let totalInterest = ZERO;
  for (let t = 1; t <= n; t++) {
    const interest = money(opening.times(r));
    let principal: Decimal;
    let total: Decimal;
    if (t < n) {
      principal = Ar.minus(interest);
      total = Ar;
    } else {
      principal = opening;
      total = money(interest.plus(principal));
    }
    if (principal.lessThanOrEqualTo(0)) {
      throw new AnnuityValidationError(`Negative or zero amortization in period ${t}: payment does not cover interest`);
    }
    const closing = money(opening.minus(principal));
    installments.push({
      seq: t,
      dueDate: t === 1 ? input.firstDueDate : addMonthsClamped(input.firstDueDate, t - 1, anchorDay),
      openingPrincipal: opening,
      interestDue: interest,
      principalDue: principal,
      totalDue: total,
      closingPrincipal: closing,
    });
    totalInterest = totalInterest.plus(interest);
    opening = closing;
  }

  const last = installments[installments.length - 1];
  const finalAdjustment = last.totalDue.minus(Ar);
  const totalPayable = installments.reduce((acc, i) => acc.plus(i.totalDue), ZERO);

  return {
    regularPayment: Ar,
    regularPaymentUnrounded: A,
    periodicRate: r,
    installments,
    finalAdjustment,
    totalInterest,
    totalPayable,
    basis: {
      formula: "A = P × r / (1 − (1 + r)^−n), r = j / 12, end-of-period payments",
      rounding: "AZN cents, half-up per interest/principal component; final installment adjusted to clear principal exactly",
      calendar: "Monthly due dates on the first-due-date day of month, clamped to month end; no business-day shifting (demo policy)",
      rateLabel: "Nominal annual rate (not APR/EIR; disclosed borrowing cost requires the bank-approved cash-flow method)",
    },
  };
}

/** Serialize a schedule for API responses / persistence (strings keep decimal exactness). */
export function serializeSchedule(schedule: AnnuitySchedule) {
  return {
    regularPayment: schedule.regularPayment.toFixed(2),
    regularPaymentUnrounded: schedule.regularPaymentUnrounded.toString(),
    periodicRate: schedule.periodicRate.toString(),
    finalAdjustment: schedule.finalAdjustment.toFixed(2),
    totalInterest: schedule.totalInterest.toFixed(2),
    totalPayable: schedule.totalPayable.toFixed(2),
    basis: schedule.basis,
    installments: schedule.installments.map((i) => ({
      seq: i.seq,
      dueDate: i.dueDate,
      openingPrincipal: i.openingPrincipal.toFixed(2),
      interestDue: i.interestDue.toFixed(2),
      principalDue: i.principalDue.toFixed(2),
      totalDue: i.totalDue.toFixed(2),
      closingPrincipal: i.closingPrincipal.toFixed(2),
    })),
  };
}
