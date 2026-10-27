import { z } from "zod";
import type { Db } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { dec, money } from "@/server/money";
import { bakuBusinessDate, fromDbDate, type IsoDate } from "@/server/dates";
import { buildAnnuitySchedule } from "@/server/modules/finance/annuity";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";

/**
 * Hardship and arrangements (S10). The collections layer prepares and governs proposals; core banking is the
 * source of truth for any contract change. Nothing here changes balances, adds charges or capitalizes arrears:
 * comparisons are simulations with the demo rounding policy, clearly labelled.
 */
export const proposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEMPORARY_PLAN"), monthlyPayment: z.string().regex(/^\d+(\.\d{1,2})?$/), months: z.number().int().min(1).max(12), note: z.string().max(400).optional() }),
  z.object({ type: z.literal("RESTRUCTURE"), newTenorMonths: z.number().int().min(1).max(120), newAnnualRate: z.string().regex(/^0?\.\d+$|^\d+(\.\d+)?$/).optional(), firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(400).optional() }),
]);
export type Proposal = z.infer<typeof proposalSchema>;

export async function simulateArrangement(db: Db, customerId: string, proposal: Proposal, now: Date) {
  const loans = await db.loan.findMany({ where: { customerId, status: "ACTIVE" }, include: { scheduleVersions: { where: { isCurrent: true, source: "CORE_IMPORT" }, include: { installments: { orderBy: { seq: "asc" } } } } } });
  if (loans.length === 0) throw unprocessable("Customer has no active loans");
  const businessDate = bakuBusinessDate(now);
  const overdue = loans.reduce((s, l) => s.plus(l.totalOverdue.toString()), dec(0));
  const principal = loans.reduce((s, l) => s.plus(l.principalOutstanding.toString()), dec(0));
  const upcoming = loans.flatMap((l) => (l.scheduleVersions[0]?.installments ?? []).filter((i) => i.status !== "PAID" && (fromDbDate(i.dueDate) ?? "") > businessDate).map((i) => ({ loanId: l.id, dueDate: fromDbDate(i.dueDate)!, totalDue: dec(i.totalDue.toString()).minus(i.paidPrincipal.toString()).minus(i.paidInterest.toString()).minus(i.paidFee.toString()) }))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const base = { businessDate, loans: loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, principalOutstanding: l.principalOutstanding.toString(), totalOverdue: l.totalOverdue.toString(), dpd: l.dpd, regularPayment: l.scheduleVersions[0]?.installments[0]?.totalDue.toString() ?? null })), currentOverdue: money(overdue).toFixed(2), principalOutstanding: money(principal).toFixed(2) };
  if (proposal.type === "TEMPORARY_PLAN") {
    const window = upcoming.slice(0, proposal.months * loans.length);
    const contractual = window.reduce((s, i) => s.plus(i.totalDue), dec(0)).plus(overdue);
    const planTotal = dec(proposal.monthlyPayment).times(proposal.months);
    return { ...base, type: proposal.type, contractualDueInWindow: money(contractual).toFixed(2), planTotal: money(planTotal).toFixed(2), shortfallAtPlanEnd: money(contractual.minus(planTotal)).toFixed(2), overdueCovered: planTotal.greaterThanOrEqualTo(overdue), monthsCovered: proposal.months, note: "Temporary reduced plan: the contract and schedule stay unchanged in core; arrears are not capitalized and no fees are added. Any shortfall remains due per the original schedule unless core approves a restructure.", installmentsInWindow: window.map((i) => ({ loanId: i.loanId, dueDate: i.dueDate, due: money(i.totalDue).toFixed(2) })) };
  }
  const rate = proposal.newAnnualRate ? dec(proposal.newAnnualRate) : dec(loans[0].nominalAnnualRate.toString());
  const newPrincipal = principal.plus(loans.reduce((s, l) => s.plus(l.overdueInterest.toString()), dec(0)));
  const schedule = buildAnnuitySchedule({ principal: newPrincipal, nominalAnnualRate: rate, months: proposal.newTenorMonths, firstDueDate: proposal.firstDueDate as IsoDate });
  const remainingContractual = upcoming.reduce((s, i) => s.plus(i.totalDue), dec(0)).plus(overdue);
  const currentMonthly = loans.reduce((s, l) => s.plus(l.scheduleVersions[0]?.installments[0]?.totalDue.toString() ?? "0"), dec(0));
  return { ...base, type: proposal.type, simulated: { principal: money(newPrincipal).toFixed(2), rate: rate.toFixed(4), months: proposal.newTenorMonths, regularPayment: schedule.regularPayment.toFixed(2), finalPayment: schedule.installments.at(-1)!.totalDue.toFixed(2), totalInterest: schedule.totalInterest.toFixed(2), totalPayable: schedule.totalPayable.toFixed(2), firstDueDate: proposal.firstDueDate, lastDueDate: schedule.installments.at(-1)!.dueDate }, current: { regularPaymentAllLoans: money(currentMonthly).toFixed(2), remainingContractual: money(remainingContractual).toFixed(2) }, deltaRemainingPayable: money(schedule.totalPayable.minus(remainingContractual)).toFixed(2), note: "Restructure simulation on principal outstanding plus overdue interest (no penalty, no fee, no capitalization of anything else). Core banking produces the binding schedule; this comparison only supports the decision." };
}

export const ARRANGEMENT_ACTIONS = ["SUBMIT", "REVIEW", "REQUEST_APPROVAL", "SEND_TO_CORE", "REJECT"] as const;
export type ArrangementAction = (typeof ARRANGEMENT_ACTIONS)[number];

export async function createArrangement(db: Db, input: { customerId: string; supportCaseId?: string | null; intake: Record<string, unknown>; proposal: Proposal }, user: SessionUser, now: Date) {
  const c = await db.collectionCase.findFirst({ where: { customerId: input.customerId, status: { in: ["OPEN", "HANDOVER"] } } });
  const comparison = await simulateArrangement(db, input.customerId, input.proposal, now);
  const a = await db.arrangement.create({ data: { customerId: input.customerId, caseId: c?.id ?? null, supportCaseId: input.supportCaseId ?? null, type: input.proposal.type, status: "DRAFT", intake: input.intake as never, proposal: input.proposal as never, comparison: comparison as never, createdBy: user.id } });
  await appendAudit(db, { actorUserId: user.id, action: "arrangement.created", objectType: "Arrangement", objectId: a.id, customerId: input.customerId, changes: { type: input.proposal.type } });
  return a;
}

export async function transitionArrangement(prisma: PrismaClient, id: string, action: ArrangementAction, user: SessionUser, note: string, now: Date) {
  const a = await prisma.arrangement.findUnique({ where: { id } });
  if (!a) throw notFound("Arrangement not found");
  const expect = (statuses: string[]) => { if (!statuses.includes(a.status)) throw conflict(`${action} is not allowed from status ${a.status}`); };
  let effect: Record<string, unknown> = {};
  switch (action) {
    case "SUBMIT": expect(["DRAFT"]); await prisma.arrangement.update({ where: { id }, data: { status: "SUBMITTED" } }); break;
    case "REVIEW": expect(["SUBMITTED"]); if (a.createdBy === user.id) throw conflict("The reviewer must differ from the proposer"); await prisma.arrangement.update({ where: { id }, data: { status: "REVIEWED", reviewerUserId: user.id } }); break;
    case "REQUEST_APPROVAL": {
      expect(["REVIEWED"]);
      const open = await prisma.approvalRequest.findFirst({ where: { objectType: "Arrangement", objectId: id, status: { in: ["PENDING", "INFO_REQUESTED"] } } });
      if (open) throw conflict(`Approval ${open.id} already open`);
      const ar = await prisma.approvalRequest.create({ data: { type: a.type === "RESTRUCTURE" ? "RESTRUCTURE" : "WAIVER", makerUserId: user.id, objectType: "Arrangement", objectId: id, title: `${a.type === "RESTRUCTURE" ? "Restructure" : "Temporary plan"} for ${a.customerId}`, rationale: note, beforeJson: { status: a.status } as never, afterJson: a.proposal as never, impactJson: a.comparison as never } });
      await prisma.arrangement.update({ where: { id }, data: { approvalId: ar.id } });
      effect = { approvalId: ar.id };
      break;
    }
    case "SEND_TO_CORE": {
      expect(["APPROVED"]);
      const ref = `MOCK-CORE-ARR-${id.slice(-6).toUpperCase()}`;
      await prisma.arrangement.update({ where: { id }, data: { status: "CORE_CONFIRMED", coreReference: ref } });
      // Demo: core confirmation is immediate and mocked; the plan period restricts routine calls via a support case hold.
      const months = (a.proposal as { months?: number }).months ?? 3;
      const until = new Date(now.getTime() + months * 30 * 86400000);
      await prisma.supportCase.create({ data: { customerId: a.customerId, caseId: a.caseId, type: "HARDSHIP", status: "RESOLVED", reason: `Arrangement ${id} confirmed by core (${ref}); routine outreach paused for the plan period`, restrictionUntil: until, restrictsCalls: true, createdBy: user.id, resolution: "ARRANGEMENT_ACTIVE", resolvedAt: now } });
      await prisma.arrangement.update({ where: { id }, data: { status: "ACTIVE" } });
      effect = { coreReference: ref, restrictionUntil: until.toISOString(), note: "Mock core confirmation: no real core banking call was made" };
      break;
    }
    case "REJECT": expect(["DRAFT", "SUBMITTED", "REVIEWED"]); await prisma.arrangement.update({ where: { id }, data: { status: "REJECTED" } }); break;
  }
  await appendAudit(prisma, { actorUserId: user.id, action: `arrangement.${action.toLowerCase()}`, objectType: "Arrangement", objectId: id, customerId: a.customerId, reason: note, changes: effect });
  return effect;
}
