import type { PrismaClient } from "@/generated/prisma/client";
import { BUSINESS_DATE, SEED_NOW } from "./portfolio";
import { recomputeLoanState } from "@/server/modules/finance/loanState";
import { syncCustomerCase } from "@/server/modules/cases/caseService";
import { runDailyDecision } from "@/server/modules/decisions/decisionRun";
import { createCallbackWorkItem, ensureTaskWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { bakuDateTime } from "@/server/dates";
import { setSetting } from "@/server/modules/settings/settingsService";
import { DEMO_SEED_INSTANT } from "@/server/clock";

export async function restateLoansAndCases(prisma: PrismaClient) {
  const loans = await prisma.loan.findMany({ select: { id: true, customerId: true } });
  for (const l of loans) await recomputeLoanState(prisma, l.id, BUSINESS_DATE, { reason: "SEED_RESTATEMENT", asOf: SEED_NOW });
  const customers = await prisma.customer.findMany({ select: { id: true } });
  for (const c of customers) await syncCustomerCase(prisma, c.id, SEED_NOW, { actorService: "seed" });
  // Stale balance scenario: balances last refreshed two hours before the business clock.
  await prisma.loan.update({ where: { id: "L-DEMO-018" }, data: { balancesAsOf: new Date(SEED_NOW.getTime() - 2 * 3600000) } });
  await prisma.exceptionCase.upsert({ where: { dedupKey: "STALE_BALANCES:C-DEMO-018" }, create: { dedupKey: "STALE_BALANCES:C-DEMO-018", type: "STALE_BALANCES", severity: "WARNING", customerId: "C-DEMO-018", loanId: "L-DEMO-018", title: "Loan balances older than the 15-minute freshness threshold; amount-specific outreach blocked", evidence: { balancesAsOf: new Date(SEED_NOW.getTime() - 2 * 3600000).toISOString(), thresholdMinutes: 15 } as never }, update: {} });
}

export async function runDecisionsAndTasks(prisma: PrismaClient) {
  const summary = await runDailyDecision(prisma, { triggeredBy: "seed", now: SEED_NOW });
  // Scenario tasks after the decision run.
  const caseOf = async (customerId: string) => (await prisma.collectionCase.findFirstOrThrow({ where: { customerId, status: "OPEN" } })).id;
  await createCallbackWorkItem(prisma, { customerId: "C-DEMO-025", caseId: await caseOf("C-DEMO-025"), dueAt: bakuDateTime(BUSINESS_DATE, "10:30"), ownerUserId: "U-AGENT-A", reason: "CUSTOMER_REQUESTED: confirm payment plan", language: "AZ", requiredSkill: null, now: SEED_NOW, actorUserId: "U-AGENT-A", campaignCode: "SOFT_COLLECTIONS_VOICE" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-015", caseId: await caseOf("C-DEMO-015"), type: "RECONCILIATION", dueAt: new Date(SEED_NOW.getTime() + 24 * 3600000), ownerUserId: "U-INTEGRATION", reason: "Already-paid claim 300.00 AZN (TRM-55821) awaiting payment feed" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-016", caseId: await caseOf("C-DEMO-016"), type: "DISPUTE_REVIEW", dueAt: new Date(SEED_NOW.getTime() + 3 * 86400000), ownerUserId: "U-LEAD", reason: "Dispute: October installment amount" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-017", caseId: await caseOf("C-DEMO-017"), type: "SUPPORT_REVIEW", dueAt: new Date(SEED_NOW.getTime() + 5 * 86400000), ownerUserId: "U-LEAD", reason: "Hardship assessment: temporary reduced plan requested" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-013", caseId: await caseOf("C-DEMO-013"), type: "PTP_FOLLOWUP", dueAt: SEED_NOW, ownerUserId: "U-AGENT-D", reason: "Promise matured; pending source reconciliation" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-014", caseId: await caseOf("C-DEMO-014"), type: "PTP_FOLLOWUP", dueAt: SEED_NOW, ownerUserId: "U-AGENT-E", reason: "Broken promise follow-up" });
  await ensureTaskWorkItem(prisma, { customerId: "C-DEMO-029", caseId: await caseOf("C-DEMO-029"), type: "HANDOVER", dueAt: new Date(SEED_NOW.getTime() + 7 * 86400000), ownerUserId: "U-LEAD", reason: "Deceased notification: special-case referral", requiredSkill: "SENIOR" });
  const laterStage = await prisma.workItem.findMany({ where: { type: "LATER_STAGE_REVIEW", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } });
  for (const wi of laterStage) await prisma.workItem.update({ where: { id: wi.id }, data: { ownerUserId: "U-LEAD", reason: "31+ DPD: separately governed later-stage queue (no early model score)" } });
  // Re-evaluate eligibility of all voice items after history/tasks were added.
  const voice = await prisma.workItem.findMany({ where: { type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
  for (const wi of voice) await refreshWorkItemEligibility(prisma, wi.id, SEED_NOW);
  return summary;
}

export async function setDemoClock(prisma: PrismaClient) {
  const offset = DEMO_SEED_INSTANT.getTime() - Date.now();
  await setSetting(prisma, "clock.demoOffsetMs", offset, "seed");
  await setSetting(prisma, "clock.demoBusinessDate", BUSINESS_DATE, "seed");
  await prisma.auditEvent.create({ data: { actorService: "seed", action: "seed.completed", objectType: "System", changes: { businessDate: BUSINESS_DATE, clockOffsetMs: offset, mode: "DEMO" } as never } });
}
