import type { Db } from "@/server/db";
import { dec, money, toDbMoney, ZERO } from "@/server/money";
import { fromDbDate, toDbDate, type IsoDate } from "@/server/dates";
import { deriveArrears, demoAccruedInterestNotDue } from "@/server/modules/finance/arrears";
import { allocatePayment, DEMO_ALLOCATION_POLICY } from "@/server/modules/finance/allocation";
import { getSetting } from "@/server/modules/settings/settingsService";

/**
 * Restates a loan's derived projection from authoritative facts (current schedule + posted payments).
 * DEMO mode re-runs the demo allocation policy deterministically over all non-reversed posted payments in
 * (valueDate, eventAt, id) order; so replays, late events and reversals converge to the same state.
 * INTEGRATION mode must import core allocations instead (not implemented: no core contract yet).
 */
export interface LoanStateSummary {
  loanId: string;
  dpd: number;
  totalOverdue: string;
  principalOutstanding: string;
  unappliedFunds: string;
  status: "ACTIVE" | "PAID_OFF" | "CLOSED" | "RESTRUCTURED";
  changed: boolean;
}

export async function recomputeLoanState(db: Db, loanId: string, businessDate: IsoDate, opts: { reason: string; sourceEventId?: string | null; asOf?: Date } = { reason: "recompute" }): Promise<LoanStateSummary> {
  const loan = await db.loan.findUniqueOrThrow({ where: { id: loanId } });
  const schedule = await db.scheduleVersion.findFirst({ where: { loanId, isCurrent: true, source: "CORE_IMPORT" }, include: { installments: { orderBy: { seq: "asc" } } } });
  if (!schedule) throw new Error(`Loan ${loanId} has no current core schedule`);
  const tolerance = (await getSetting<string>("product.dpdToleranceAzn", db)) ?? "0";

  const payments = await db.payment.findMany({
    where: { loanId, status: "POSTED" },
    orderBy: [{ valueDate: "asc" }, { eventAt: "asc" }, { id: "asc" }],
  });

  // Reset derived allocations and re-run the demo policy.
  await db.paymentAllocation.deleteMany({ where: { loanId } });
  const remaining = schedule.installments.map((i) => ({
    id: i.id,
    seq: i.seq,
    dueDate: fromDbDate(i.dueDate)!,
    principalDue: dec(i.principalDue),
    interestDue: dec(i.interestDue),
    feeDue: dec(i.feeDue),
    paidPrincipal: ZERO,
    paidInterest: ZERO,
    paidFee: ZERO,
  }));
  let unapplied = ZERO;
  let lastPaymentAt: Date | null = null;
  let lastPaymentAmount: string | null = null;
  for (const p of payments) {
    const valueDate = fromDbDate(p.valueDate)!;
    const alloc = allocatePayment(p.amount, remaining.map((r) => ({
      id: r.id,
      seq: r.seq,
      dueDate: r.dueDate,
      remainingInterest: r.interestDue.minus(r.paidInterest),
      remainingPrincipal: r.principalDue.minus(r.paidPrincipal),
      remainingFee: r.feeDue.minus(r.paidFee),
    })), valueDate);
    for (const line of alloc.lines) {
      const r = remaining.find((x) => x.id === line.installmentId)!;
      r.paidInterest = r.paidInterest.plus(line.interestAmount);
      r.paidPrincipal = r.paidPrincipal.plus(line.principalAmount);
      r.paidFee = r.paidFee.plus(line.feeAmount);
      await db.paymentAllocation.create({
        data: {
          paymentId: p.id,
          loanId,
          installmentId: line.installmentId,
          principalAmount: toDbMoney(line.principalAmount),
          interestAmount: toDbMoney(line.interestAmount),
          feeAmount: toDbMoney(line.feeAmount),
          policy: DEMO_ALLOCATION_POLICY,
        },
      });
    }
    if (alloc.unapplied.greaterThan(0)) {
      unapplied = unapplied.plus(alloc.unapplied);
      await db.paymentAllocation.create({ data: { paymentId: p.id, loanId, unappliedAmount: toDbMoney(alloc.unapplied), policy: DEMO_ALLOCATION_POLICY } });
    }
    lastPaymentAt = p.eventAt;
    lastPaymentAmount = toDbMoney(p.amount);
  }

  const arrears = deriveArrears(
    remaining.map((r) => ({ id: r.id, seq: r.seq, dueDate: r.dueDate, principalDue: r.principalDue, interestDue: r.interestDue, feeDue: r.feeDue, paidPrincipal: r.paidPrincipal, paidInterest: r.paidInterest, paidFee: r.paidFee })),
    businessDate,
    tolerance,
  );

  for (const r of remaining) {
    const d = arrears.installments.find((x) => x.seq === r.seq)!;
    await db.installment.update({
      where: { id: r.id },
      data: {
        paidPrincipal: toDbMoney(r.paidPrincipal),
        paidInterest: toDbMoney(r.paidInterest),
        paidFee: toDbMoney(r.paidFee),
        status: d.status,
        paidAt: d.status === "PAID" ? (lastPaymentAt ?? new Date()) : null,
      },
    });
  }

  const principalOutstanding = money(dec(loan.principalOriginal).minus(arrears.principalRepaid));
  const nextInstallment = schedule.installments.find((i) => fromDbDate(i.dueDate) === arrears.nextDueDate);
  const accrued = demoAccruedInterestNotDue(arrears.nextDueDate, nextInstallment ? dec(nextInstallment.interestDue) : null, businessDate);
  const status = arrears.isFullyPaid ? "PAID_OFF" : loan.status === "PAID_OFF" ? "ACTIVE" : loan.status;
  const asOf = opts.asOf ?? new Date();

  const changed =
    loan.dpd !== arrears.dpd ||
    dec(loan.totalOverdue).toFixed(2) !== arrears.totalOverdue.toFixed(2) ||
    dec(loan.principalOutstanding).toFixed(2) !== principalOutstanding.toFixed(2) ||
    loan.status !== status;

  const updated = await db.loan.update({
    where: { id: loanId },
    data: {
      principalOutstanding: toDbMoney(principalOutstanding),
      overduePrincipal: toDbMoney(arrears.overduePrincipal),
      overdueInterest: toDbMoney(arrears.overdueInterest),
      accruedInterestNotDue: toDbMoney(accrued),
      feesDue: toDbMoney(arrears.overdueFees),
      unappliedFunds: toDbMoney(unapplied),
      totalOverdue: toDbMoney(arrears.totalOverdue),
      dpd: arrears.dpd,
      oldestUnpaidDueDate: arrears.oldestUnpaidDueDate ? toDbDate(arrears.oldestUnpaidDueDate) : null,
      nextDueDate: arrears.nextDueDate ? toDbDate(arrears.nextDueDate) : null,
      nextDueAmount: arrears.nextDueAmount ? toDbMoney(arrears.nextDueAmount) : null,
      balanceVersion: { increment: 1 },
      balancesAsOf: asOf,
      status,
      lastPaymentAt,
      lastPaymentAmount,
    },
  });

  await db.loanSnapshot.create({
    data: {
      loanId,
      asOf,
      balanceVersion: updated.balanceVersion,
      principalOutstanding: updated.principalOutstanding,
      overduePrincipal: updated.overduePrincipal,
      overdueInterest: updated.overdueInterest,
      accruedInterestNotDue: updated.accruedInterestNotDue,
      feesDue: updated.feesDue,
      unappliedFunds: updated.unappliedFunds,
      totalOverdue: updated.totalOverdue,
      dpd: updated.dpd,
      status: updated.status,
      sourceEventId: opts.sourceEventId ?? null,
      reason: opts.reason,
    },
  });

  return { loanId, dpd: updated.dpd, totalOverdue: dec(updated.totalOverdue).toFixed(2), principalOutstanding: dec(updated.principalOutstanding).toFixed(2), unappliedFunds: dec(updated.unappliedFunds).toFixed(2), status: updated.status, changed };
}
