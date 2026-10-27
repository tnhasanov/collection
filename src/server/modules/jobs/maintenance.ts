import type { PrismaClient } from "@/generated/prisma/client";
import { releaseWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { maturePromises } from "@/server/modules/promises/promiseService";
import { appendAudit } from "@/server/modules/audit/audit";
import { getOutboundControls } from "@/server/modules/settings/settingsService";
import { renderTemplate, templateText, variablesForCustomer } from "@/server/modules/templates/templateService";

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

/**
 * Digital reminders: for every RUNNING SMS campaign whose schedule has arrived, queue approved SMS for the
 * campaign's audience (ELIGIBLE DIGITAL_REMINDER work items of the approved strategy population). Balance
 * freshness and contact policy are re-checked per message at dispatch; the demo writes to the local outbound
 * log only. One message per campaign, customer and day (deterministic dedup key).
 */
export async function dispatchDigitalReminders(prisma: PrismaClient, now: Date, evaluate: (customerId: string, campaignCode: string) => Promise<{ eligible: boolean; reasonCodes: string[]; contactPointId: string | null }>) {
  const controls = await getOutboundControls(prisma);
  if (controls.killSwitch || controls.pausedChannels.includes("SMS")) return { queued: 0, blocked: 0, skipped: "KILL_SWITCH_OR_CHANNEL_PAUSED" };
  const campaigns = await prisma.campaign.findMany({ where: { kind: "SMS", status: { in: ["RUNNING", "SCHEDULED"] } }, include: { template: true } });
  let queued = 0;
  let blocked = 0;
  for (const campaign of campaigns) {
    if (campaign.scheduledAt && campaign.scheduledAt > now) continue;
    if (campaign.status === "SCHEDULED") await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING" } });
    if (controls.pausedCampaigns.includes(campaign.code)) continue;
    if (!campaign.template || campaign.template.status !== "ACTIVE") continue;
    const items = await prisma.workItem.findMany({ where: { type: "DIGITAL_REMINDER", status: "ELIGIBLE" }, include: { customer: { include: { loans: true } } }, take: 50 });
    for (const wi of items) {
      if (!campaign.languages.includes(wi.customer.language)) continue;
      const key = `${campaign.code}:${wi.customerId}:${now.toISOString().slice(0, 10)}`;
      const exists = await prisma.outboundMessage.findUnique({ where: { dedupKey: key } });
      if (exists) continue;
      const check = await evaluate(wi.customerId, campaign.code);
      const template = (await prisma.template.findFirst({ where: { code: campaign.template.code, status: "ACTIVE", language: wi.customer.language } })) ?? (await prisma.template.findFirst({ where: { code: campaign.template.code, status: "ACTIVE", language: "AZ" } })) ?? campaign.template;
      const body = renderTemplate(templateText(template.body), await variablesForCustomer(prisma, wi.customerId));
      if (!check.eligible || !check.contactPointId) {
        await prisma.outboundMessage.create({ data: { dedupKey: key, campaignId: campaign.id, customerId: wi.customerId, contactPointId: check.contactPointId, templateId: template.id, language: template.language, body, status: "BLOCKED", blockReason: check.reasonCodes.join(",") } });
        blocked++;
        continue;
      }
      const msg = await prisma.outboundMessage.create({ data: { dedupKey: key, campaignId: campaign.id, customerId: wi.customerId, contactPointId: check.contactPointId, templateId: template.id, language: template.language, body, status: "QUEUED" } });
      await prisma.outboxMessage.create({ data: { topic: "sms.send", idempotencyKey: `sms:${msg.id}`, payload: { outboundMessageId: msg.id } as never } });
      await prisma.workItem.update({ where: { id: wi.id }, data: { status: "COMPLETED", completedAt: now, reason: `SMS reminder queued (${campaign.code}, local outbox)` } });
      queued++;
    }
  }
  return { queued, blocked };
}
