import type { Db } from "@/server/db";
import { fromDbDate } from "@/server/dates";
import { dec, money } from "@/server/money";
import { buildAnnuitySchedule, serializeSchedule } from "@/server/modules/finance/annuity";
import { notFound } from "@/server/errors";

export async function getLoanDetail(db: Db, loanId: string) {
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { customer: true, scheduleVersions: { orderBy: { versionNo: "desc" }, include: { installments: { orderBy: { seq: "asc" }, include: { allocations: { include: { payment: true } } } } } }, payments: { orderBy: { eventAt: "desc" } }, allocations: { include: { payment: true, installment: { select: { seq: true } } } }, snapshots: { orderBy: { asOf: "desc" }, take: 20 } } });
  if (!loan) throw notFound("Loan not found");
  const current = loan.scheduleVersions.find((v) => v.isCurrent && v.source === "CORE_IMPORT") ?? loan.scheduleVersions[0];
  const local = buildAnnuitySchedule({ principal: loan.principalOriginal.toString(), nominalAnnualRate: loan.nominalAnnualRate.toString(), months: loan.tenorMonths, firstDueDate: fromDbDate(loan.firstDueDate)!, paymentDay: Number(fromDbDate(loan.firstDueDate)!.slice(8, 10)) });
  const mismatches = current
    ? current.installments
        .map((i) => {
          const l = local.installments[i.seq - 1];
          if (!l) return null;
          const diffInterest = dec(i.interestDue).minus(l.interestDue);
          const diffPrincipal = dec(i.principalDue).minus(l.principalDue);
          const diffDate = fromDbDate(i.dueDate) !== l.dueDate;
          if (diffInterest.isZero() && diffPrincipal.isZero() && !diffDate) return null;
          return { seq: i.seq, coreInterest: i.interestDue.toString(), localInterest: l.interestDue.toFixed(2), corePrincipal: i.principalDue.toString(), localPrincipal: l.principalDue.toFixed(2), coreDueDate: fromDbDate(i.dueDate), localDueDate: l.dueDate };
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
    : [];
  return {
    loan: { ...loan, principalOriginal: loan.principalOriginal.toString(), nominalAnnualRate: loan.nominalAnnualRate.toString(), principalOutstanding: loan.principalOutstanding.toString(), overduePrincipal: loan.overduePrincipal.toString(), overdueInterest: loan.overdueInterest.toString(), accruedInterestNotDue: loan.accruedInterestNotDue.toString(), feesDue: loan.feesDue.toString(), unappliedFunds: loan.unappliedFunds.toString(), totalOverdue: loan.totalOverdue.toString(), nextDueAmount: loan.nextDueAmount?.toString() ?? null, lastPaymentAmount: loan.lastPaymentAmount?.toString() ?? null, originationDate: fromDbDate(loan.originationDate), maturityDate: fromDbDate(loan.maturityDate), firstDueDate: fromDbDate(loan.firstDueDate), oldestUnpaidDueDate: fromDbDate(loan.oldestUnpaidDueDate), nextDueDate: fromDbDate(loan.nextDueDate), customer: { id: loan.customer.id, displayName: loan.customer.displayName, cif: loan.customer.cif }, scheduleVersions: undefined, payments: undefined, allocations: undefined, snapshots: undefined },
    schedule: current
      ? {
          id: current.id,
          versionNo: current.versionNo,
          source: current.source,
          sourceRef: current.sourceRef,
          effectiveFrom: fromDbDate(current.effectiveFrom),
          checksum: current.checksum,
          installments: current.installments.map((i) => ({
            seq: i.seq,
            dueDate: fromDbDate(i.dueDate),
            openingPrincipal: i.openingPrincipal.toString(),
            principalDue: i.principalDue.toString(),
            interestDue: i.interestDue.toString(),
            feeDue: i.feeDue.toString(),
            totalDue: i.totalDue.toString(),
            paid: money(dec(i.paidPrincipal).plus(i.paidInterest).plus(i.paidFee)).toFixed(2),
            remaining: money(dec(i.totalDue).minus(i.paidPrincipal).minus(i.paidInterest).minus(i.paidFee)).toFixed(2),
            status: i.status,
            closingPrincipal: i.closingPrincipal.toString(),
          })),
        }
      : null,
    versions: loan.scheduleVersions.map((v) => ({ id: v.id, versionNo: v.versionNo, source: v.source, sourceRef: v.sourceRef, isCurrent: v.isCurrent, effectiveFrom: fromDbDate(v.effectiveFrom), createdAt: v.createdAt, installments: v.installments.length })),
    payments: loan.payments.map((p) => ({ id: p.id, sourceTransactionId: p.sourceTransactionId, amount: p.amount.toString(), status: p.status, reconciliation: p.reconciliation, valueDate: fromDbDate(p.valueDate), eventAt: p.eventAt, allocations: loan.allocations.filter((a) => a.paymentId === p.id).map((a) => ({ installmentId: a.installmentId, installmentSeq: a.installment?.seq ?? null, principal: a.principalAmount.toString(), interest: a.interestAmount.toString(), fee: a.feeAmount.toString(), unapplied: a.unappliedAmount.toString(), policy: a.policy })) })),
    snapshots: loan.snapshots.map((s) => ({ id: s.id, asOf: s.asOf, balanceVersion: s.balanceVersion, dpd: s.dpd, totalOverdue: s.totalOverdue.toString(), principalOutstanding: s.principalOutstanding.toString(), reason: s.reason, status: s.status })),
    localSimulation: serializeSchedule(local),
    mismatches,
  };
}
