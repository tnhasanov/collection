import type { Db } from "@/server/db";
import { bakuBusinessDate, toDbDate, type IsoDate } from "@/server/dates";
import { recomputeLoanState } from "@/server/modules/finance/loanState";
import { syncCustomerCase } from "@/server/modules/cases/caseService";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * Daily aging: when the Baku business date advances, DPD and arrears of every active loan are re-derived from the
 * authoritative facts (schedule + posted payments) for the new date. Only the derivation runs again; no balance is
 * ever made to look fresh by touching its timestamp alone. Idempotent: a loan already aged for the date is skipped,
 * so a restarted or delayed worker catches up safely.
 */
export async function runDailyAging(db: Db, now: Date, opts: { reason?: string; limit?: number } = {}) {
  const businessDate: IsoDate = bakuBusinessDate(now);
  const target = toDbDate(businessDate);
  const loans = await db.loan.findMany({
    where: { status: "ACTIVE", OR: [{ agedForDate: null }, { agedForDate: { lt: target } }] },
    select: { id: true, customerId: true, dpd: true, totalOverdue: true },
    take: opts.limit ?? 5000,
  });
  const touchedCustomers = new Set<string>();
  let changed = 0;
  for (const loan of loans) {
    const summary = await recomputeLoanState(db, loan.id, businessDate, { reason: opts.reason ?? `daily-aging ${businessDate}`, asOf: now });
    await db.loan.update({ where: { id: loan.id }, data: { agedForDate: target } });
    if (summary.changed) {
      changed++;
      touchedCustomers.add(loan.customerId);
    }
  }
  for (const customerId of touchedCustomers) await syncCustomerCase(db, customerId, now, { actorService: "aging" });
  if (loans.length) await appendAudit(db, { actorService: "aging", action: "loans.aged", objectType: "Loan", changes: { businessDate, loans: loans.length, changed, customersSynced: touchedCustomers.size } });
  return { businessDate, loans: loans.length, changed, customersSynced: touchedCustomers.size };
}
