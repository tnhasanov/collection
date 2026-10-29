import type { Db } from "@/server/db";
import { dec, money, toDbMoney, ZERO } from "@/server/money";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * One coordinated collection case per customer. Eligible active cash loans are linked to the case.
 * Clearing all arrears cures the episode (loan contracts stay active); a later arrears event opens a new episode.
 */
export interface CaseSyncResult {
  caseId: string | null;
  status: "OPEN" | "CURED" | "CLOSED" | "HANDOVER" | "NONE";
  maxDpd: number;
  totalOverdue: string;
  modelExposure: string;
  opened: boolean;
  cured: boolean;
}

export async function syncCustomerCase(db: Db, customerId: string, now: Date, opts: { actorService?: string; sourceEventId?: string | null } = {}): Promise<CaseSyncResult> {
  const loans = await db.loan.findMany({ where: { customerId } });
  const active = loans.filter((l) => l.status === "ACTIVE");
  const maxDpd = active.reduce((m, l) => Math.max(m, l.dpd), 0);
  const totalOverdue = active.reduce((s, l) => s.plus(l.totalOverdue), ZERO);
  // Demo exposure definition: principal outstanding of eligible active cash loans, once per customer.
  const exposure = active.reduce((s, l) => s.plus(l.principalOutstanding), ZERO);
  const inArrears = active.some((l) => l.dpd > 0 || dec(l.totalOverdue).greaterThan(0));

  const open = await db.collectionCase.findFirst({ where: { customerId, status: { in: ["OPEN", "HANDOVER"] } }, include: { caseLoans: true } });

  if (inArrears) {
    if (!open) {
      const episodes = await db.collectionCase.count({ where: { customerId } });
      const created = await db.collectionCase.create({
        data: {
          customerId,
          episodeNo: episodes + 1,
          status: "OPEN",
          openedAt: now,
          maxDpd,
          totalOverdue: toDbMoney(totalOverdue),
          modelExposure: toDbMoney(exposure),
          entryDpd: maxDpd,
          entryExposure: toDbMoney(exposure),
          caseLoans: { create: active.map((l) => ({ loanId: l.id })) },
        },
      });
      await appendAudit(db, { actorService: opts.actorService ?? "case-service", action: "case.opened", objectType: "CollectionCase", objectId: created.id, customerId, caseId: created.id, sourceEventId: opts.sourceEventId, changes: { maxDpd, totalOverdue: totalOverdue.toFixed(2) } });
      return { caseId: created.id, status: "OPEN", maxDpd, totalOverdue: money(totalOverdue).toFixed(2), modelExposure: money(exposure).toFixed(2), opened: true, cured: false };
    }
    const linked = new Set(open.caseLoans.map((cl) => cl.loanId));
    for (const l of active) if (!linked.has(l.id)) await db.caseLoan.create({ data: { caseId: open.id, loanId: l.id } });
    // Loan-level closure: a loan whose arrears are cleared (or whose contract closed) leaves the case scope while
    // the other loans keep the episode open; it re-enters if arrears return. Promises and SMS amounts follow scope.
    for (const cl of open.caseLoans) {
      const l = loans.find((x) => x.id === cl.loanId);
      const loanInArrears = !!l && l.status === "ACTIVE" && (l.dpd > 0 || dec(l.totalOverdue).greaterThan(0));
      if (!loanInArrears && !cl.releasedAt) {
        const releaseReason = !l || l.status !== "ACTIVE" ? "LOAN_CLOSED" : "LOAN_ARREARS_CLEARED";
        await db.caseLoan.update({ where: { caseId_loanId: { caseId: open.id, loanId: cl.loanId } }, data: { releasedAt: now, releaseReason } });
        await appendAudit(db, { actorService: opts.actorService ?? "case-service", action: "case.loan_released", objectType: "CollectionCase", objectId: open.id, customerId, caseId: open.id, sourceEventId: opts.sourceEventId, changes: { loanId: cl.loanId, releaseReason } });
      } else if (loanInArrears && cl.releasedAt) {
        await db.caseLoan.update({ where: { caseId_loanId: { caseId: open.id, loanId: cl.loanId } }, data: { releasedAt: null, releaseReason: null } });
        await appendAudit(db, { actorService: opts.actorService ?? "case-service", action: "case.loan_relinked", objectType: "CollectionCase", objectId: open.id, customerId, caseId: open.id, sourceEventId: opts.sourceEventId, changes: { loanId: cl.loanId } });
      }
    }
    await db.collectionCase.update({ where: { id: open.id }, data: { maxDpd, totalOverdue: toDbMoney(totalOverdue), modelExposure: toDbMoney(exposure) } });
    return { caseId: open.id, status: open.status, maxDpd, totalOverdue: money(totalOverdue).toFixed(2), modelExposure: money(exposure).toFixed(2), opened: false, cured: false };
  }

  if (open) {
    await db.collectionCase.update({ where: { id: open.id }, data: { status: "CURED", closedAt: now, closeReason: "ARREARS_CLEARED", maxDpd: 0, totalOverdue: "0.00", modelExposure: toDbMoney(exposure) } });
    await db.caseLoan.updateMany({ where: { caseId: open.id, releasedAt: null }, data: { releasedAt: now, releaseReason: "CASE_CURED" } });
    // Obsolete outreach is withdrawn by the caller (work-item service) so provider withdrawal can be requested.
    await appendAudit(db, { actorService: opts.actorService ?? "case-service", action: "case.cured", objectType: "CollectionCase", objectId: open.id, customerId, caseId: open.id, sourceEventId: opts.sourceEventId, reason: "All arrears cleared by verified postings" });
    return { caseId: open.id, status: "CURED", maxDpd: 0, totalOverdue: "0.00", modelExposure: money(exposure).toFixed(2), opened: false, cured: true };
  }
  return { caseId: null, status: "NONE", maxDpd: 0, totalOverdue: "0.00", modelExposure: money(exposure).toFixed(2), opened: false, cured: false };
}
