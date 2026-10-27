import type { PrismaClient } from "@/generated/prisma/client";
import { releaseWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { maturePromises } from "@/server/modules/promises/promiseService";
import { appendAudit } from "@/server/modules/audit/audit";

/** DEMO mock inbound sync: the core/payment feeds "refresh" every few minutes so freshness stays within threshold. */
export async function refreshMockSources(prisma: PrismaClient, now: Date) {
  const sources = ["CORE_BANKING", "PAYMENT_FEED", "CUSTOMER_MASTER"];
  for (const s of sources) {
    const w = await prisma.sourceWatermark.findUnique({ where: { sourceSystem: s } });
    if (!w || w.paused || w.health === "DISABLED") continue;
    await prisma.sourceWatermark.update({ where: { sourceSystem: s }, data: { lastSuccessfulRunAt: now, sourceAsOf: new Date(now.getTime() - 60_000), lagSeconds: 60, health: "HEALTHY", errorCount: 0 } });
  }
  // Balances are re-confirmed by the mock core feed except for loans flagged stale by an operator scenario.
  const staleScenario = await prisma.exceptionCase.findMany({ where: { type: "STALE_BALANCES", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, select: { loanId: true } });
  const excluded = staleScenario.map((e) => e.loanId).filter((id): id is string => !!id);
  await prisma.loan.updateMany({ where: { status: "ACTIVE", id: { notIn: excluded } }, data: { balancesAsOf: now } });
  return { refreshed: sources.length, excludedLoans: excluded.length };
}

/** Expire leases on claimed work that was never progressed, and mature promises. */
export async function expireLeases(prisma: PrismaClient, now: Date) {
  const stale = await prisma.workItem.findMany({ where: { status: "CLAIMED", leaseExpiresAt: { lt: now } } });
  for (const wi of stale) {
    const active = await prisma.routingReservation.findFirst({ where: { workItemId: wi.id, status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } } });
    if (active) continue;
    await releaseWorkItem(prisma, wi.id, "LEASE_EXPIRED", now);
  }
  return stale.length;
}

/** Re-evaluate deferred voice work whose next eligible time has arrived. */
export async function refreshDueWork(prisma: PrismaClient, now: Date) {
  const due = await prisma.workItem.findMany({ where: { type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "DEFERRED"] }, OR: [{ nextEligibleAt: null }, { nextEligibleAt: { lte: now } }] }, select: { id: true }, take: 200 });
  let eligible = 0;
  for (const wi of due) {
    const r = await refreshWorkItemEligibility(prisma, wi.id, now);
    if (r.status === "ELIGIBLE") eligible++;
  }
  return { checked: due.length, eligible };
}

export async function runPromiseMaturation(prisma: PrismaClient, now: Date) {
  const results = await maturePromises(prisma, now);
  if (results.length) await appendAudit(prisma, { actorService: "worker", action: "promise.maturation", objectType: "Promise", changes: { results } });
  return results;
}

/** Digital reminders: queue approved SMS for DIGITAL_REMINDER work items under the running SMS campaign (local outbox only). */
export async function dispatchDigitalReminders(prisma: PrismaClient, now: Date, evaluate: (customerId: string) => Promise<{ eligible: boolean; reasonCodes: string[]; contactPointId: string | null }>) {
  const campaign = await prisma.campaign.findFirst({ where: { code: "SMS_REMINDER_DAILY", status: "RUNNING" } });
  if (!campaign) return { queued: 0, blocked: 0 };
  const items = await prisma.workItem.findMany({ where: { type: "DIGITAL_REMINDER", status: "ELIGIBLE" }, include: { customer: { include: { loans: true } } }, take: 50 });
  let queued = 0;
  let blocked = 0;
  for (const wi of items) {
    const key = `SMS_REMINDER_DAILY:${wi.customerId}:${now.toISOString().slice(0, 10)}`;
    const exists = await prisma.outboundMessage.findUnique({ where: { dedupKey: key } });
    if (exists) continue;
    const check = await evaluate(wi.customerId);
    const template = await prisma.template.findFirst({ where: { code: "SMS-REMINDER-01", status: "ACTIVE", language: wi.customer.language } });
    const overdue = wi.customer.loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2);
    const oldest = wi.customer.loans.map((l) => l.oldestUnpaidDueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const body = String((template?.body as { text?: string } | null)?.text ?? "ATB reminder").replace("{{overdueAmount}}", overdue).replace("{{oldestDueDate}}", oldest ? oldest.toISOString().slice(0, 10) : "");
    if (!check.eligible || !check.contactPointId) {
      await prisma.outboundMessage.create({ data: { dedupKey: key, campaignId: campaign.id, customerId: wi.customerId, contactPointId: check.contactPointId, templateId: template?.id, language: wi.customer.language, body, status: "BLOCKED", blockReason: check.reasonCodes.join(",") } });
      blocked++;
      continue;
    }
    const msg = await prisma.outboundMessage.create({ data: { dedupKey: key, campaignId: campaign.id, customerId: wi.customerId, contactPointId: check.contactPointId, templateId: template?.id, language: wi.customer.language, body, status: "QUEUED" } });
    await prisma.outboxMessage.create({ data: { topic: "sms.send", idempotencyKey: `sms:${msg.id}`, payload: { outboundMessageId: msg.id } as never } });
    await prisma.workItem.update({ where: { id: wi.id }, data: { status: "COMPLETED", completedAt: now, reason: "SMS reminder queued (local outbox)" } });
    queued++;
  }
  return { queued, blocked };
}
