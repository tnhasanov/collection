import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import type { Language } from "@/generated/prisma/enums";
import { dec, money } from "@/server/money";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { getSetting, getOutboundControls } from "@/server/modules/settings/settingsService";
import { renderTemplate, templateText, variablesForCustomer } from "@/server/modules/templates/templateService";

/**
 * SMS campaigns (S15). Audience = approved strategy population (DIGITAL_REMINDER work items). Dispatch
 * re-checks balances and contact policy at send time, never only at creation. Demo send writes to the local
 * outbound log only.
 */
export async function campaignAudience(db: Db, campaignId: string, now: Date, sampleLimit = 300) {
  const c = await db.campaign.findUnique({ where: { id: campaignId }, include: { template: true, strategyVersion: true } });
  if (!c) throw notFound("Campaign not found");
  const freshness = (await getSetting<{ balanceMaxAgeSeconds?: number }>("freshness.critical", db)) ?? {};
  const maxAge = (freshness.balanceMaxAgeSeconds ?? 900) * 1000;
  const unit = (await getSetting<{ sms: { cost: string } }>("economics.unitCosts", db)) ?? { sms: { cost: "0.031" } };
  const items = await db.workItem.findMany({ where: { type: "DIGITAL_REMINDER", status: { in: ["ELIGIBLE", "QUEUED", "DEFERRED"] } }, include: { customer: { include: { loans: { where: { status: "ACTIVE" }, select: { balancesAsOf: true } } } } } });
  const byLanguage: Record<string, number> = {};
  const exclusions: Record<string, number> = {};
  let eligible = 0, stale = 0, dedup = 0, blocked = 0;
  const dayKey = now.toISOString().slice(0, 10);
  const alreadyToday = new Set((await db.outboundMessage.findMany({ where: { campaignId: c.id, requestedAt: { gte: new Date(now.getTime() - 86400000) } }, select: { customerId: true } })).map((m) => m.customerId));
  const sample = items.slice(0, sampleLimit);
  const previews: { customerId: string; language: string; body: string }[] = [];
  for (const wi of sample) {
    byLanguage[wi.customer.language] = (byLanguage[wi.customer.language] ?? 0) + 1;
    if (alreadyToday.has(wi.customerId)) { dedup++; exclusions.ALREADY_MESSAGED_TODAY = (exclusions.ALREADY_MESSAGED_TODAY ?? 0) + 1; continue; }
    const freshOk = wi.customer.loans.every((l) => now.getTime() - l.balancesAsOf.getTime() <= maxAge);
    if (!freshOk) { stale++; exclusions.BALANCES_STALE = (exclusions.BALANCES_STALE ?? 0) + 1; continue; }
    const ev = await evaluateCustomerEligibility(db, wi.customerId, { channel: "SMS", now, campaignCode: c.code });
    if (!ev.decision.eligible) { blocked++; for (const r of ev.decision.reasonCodes) exclusions[r] = (exclusions[r] ?? 0) + 1; continue; }
    if (!c.languages.includes(wi.customer.language)) { exclusions.LANGUAGE_NOT_IN_CAMPAIGN = (exclusions.LANGUAGE_NOT_IN_CAMPAIGN ?? 0) + 1; continue; }
    eligible++;
    if (previews.length < 3 && c.template) {
      const tpl = await db.template.findFirst({ where: { code: c.template.code, language: wi.customer.language, status: { in: ["ACTIVE", "DRAFT", "TESTED"] } }, orderBy: { status: "asc" } });
      previews.push({ customerId: wi.customerId, language: wi.customer.language, body: renderTemplate(templateText((tpl ?? c.template).body), await variablesForCustomer(db, wi.customerId)) });
    }
  }
  return {
    campaign: { id: c.id, code: c.code, name: c.name, status: c.status, languages: c.languages, scheduledAt: c.scheduledAt?.toISOString() ?? null, approverUserId: c.approverUserId },
    template: c.template ? { id: c.template.id, code: c.template.code, version: c.template.version, language: c.template.language, status: c.template.status } : null,
    strategy: c.strategyVersion ? { id: c.strategyVersion.id, code: c.strategyVersion.code, version: c.strategyVersion.version, status: c.strategyVersion.status } : null,
    population: items.length,
    sampled: sample.length,
    byLanguage,
    eligible,
    excluded: { total: sample.length - eligible, dedup, stale, blocked, byReason: Object.fromEntries(Object.entries(exclusions).map(([k, v]) => [REASON_LABELS[k] ?? k, v])) },
    costEstimate: money(dec(unit.sms.cost).times(eligible)).toFixed(2),
    unitCost: unit.sms.cost,
    previews,
    asOf: now.toISOString(),
    dayKey,
    note: "Audience is re-evaluated at dispatch: balance freshness and contact policy are re-checked per message; opt-outs/restrictions block individually.",
    releaseBlockers: [
      ...(c.template && c.template.status !== "ACTIVE" ? [`Template ${c.template.code} ${c.template.version} is ${c.template.status}`] : []),
      ...(c.strategyVersion && c.strategyVersion.status !== "ACTIVE" ? [`Strategy ${c.strategyVersion.version} is ${c.strategyVersion.status}`] : []),
      ...(!c.template ? ["No template selected"] : []),
    ],
  };
}

export const CAMPAIGN_ACTIONS = ["REVIEW", "REQUEST_RELEASE", "PAUSE", "RESUME", "CANCEL", "COMPLETE"] as const;
export type CampaignAction = (typeof CAMPAIGN_ACTIONS)[number];

export async function createCampaign(db: Db, input: { code: string; name: string; templateId: string | null; strategyVersionId: string | null; languages: Language[]; scheduledAt: Date | null }, user: SessionUser) {
  const exists = await db.campaign.findUnique({ where: { code: input.code } });
  if (exists) throw conflict(`Campaign code ${input.code} already exists`);
  const c = await db.campaign.create({ data: { code: input.code, name: input.name, kind: "SMS", status: "DRAFT", templateId: input.templateId, strategyVersionId: input.strategyVersionId, languages: input.languages, scheduledAt: input.scheduledAt, createdBy: user.id } });
  await appendAudit(db, { actorUserId: user.id, action: "campaign.created", objectType: "Campaign", objectId: c.id });
  return c;
}

export async function transitionCampaign(prisma: PrismaClient, id: string, action: CampaignAction, user: SessionUser, note: string, now: Date) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw notFound("Campaign not found");
  const expect = (s: string[]) => { if (!s.includes(c.status)) throw conflict(`${action} not allowed from ${c.status}`); };
  let effect: Record<string, unknown> = {};
  switch (action) {
    case "REVIEW": {
      expect(["DRAFT"]);
      const audience = await campaignAudience(prisma, id, now);
      await prisma.campaign.update({ where: { id }, data: { status: "REVIEWED", audienceSnapshot: audience as never, exclusions: audience.excluded as never, costEstimate: audience.costEstimate } });
      effect = { eligible: audience.eligible, excluded: audience.excluded.total, costEstimate: audience.costEstimate };
      break;
    }
    case "REQUEST_RELEASE": {
      expect(["REVIEWED"]);
      const audience = await campaignAudience(prisma, id, now);
      if (audience.releaseBlockers.length) throw unprocessable("Release blocked", audience.releaseBlockers);
      const open = await prisma.approvalRequest.findFirst({ where: { objectType: "Campaign", objectId: id, status: { in: ["PENDING", "INFO_REQUESTED"] } } });
      if (open) throw conflict(`Approval ${open.id} already open`);
      const ar = await prisma.approvalRequest.create({ data: { type: "CAMPAIGN_RELEASE", makerUserId: user.id, objectType: "Campaign", objectId: id, title: `Release campaign ${c.code}`, rationale: note, afterJson: { code: c.code, scheduledAt: c.scheduledAt, languages: c.languages, templateId: c.templateId } as never, impactJson: audience as never, proposedEffectiveAt: c.scheduledAt } });
      effect = { approvalId: ar.id };
      break;
    }
    case "PAUSE": expect(["RUNNING", "SCHEDULED"]); await prisma.campaign.update({ where: { id }, data: { status: "PAUSED" } }); break;
    case "RESUME": expect(["PAUSED"]); await prisma.campaign.update({ where: { id }, data: { status: c.scheduledAt && c.scheduledAt > now ? "SCHEDULED" : "RUNNING" } }); break;
    case "CANCEL": {
      expect(["DRAFT", "REVIEWED", "SCHEDULED", "RUNNING", "PAUSED"]);
      const cancelled = await prisma.outboundMessage.updateMany({ where: { campaignId: id, status: "QUEUED" }, data: { status: "CANCELLED", failureReason: `Campaign cancelled: ${note}` } });
      await prisma.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
      effect = { cancelledQueuedMessages: cancelled.count };
      break;
    }
    case "COMPLETE": expect(["RUNNING", "PAUSED", "SCHEDULED"]); await prisma.campaign.update({ where: { id }, data: { status: "COMPLETED" } }); break;
  }
  await appendAudit(prisma, { actorUserId: user.id, action: `campaign.${action.toLowerCase()}`, objectType: "Campaign", objectId: id, reason: note, changes: effect });
  return effect;
}

export async function campaignCounters(db: Db, campaignId: string) {
  const rows = await db.outboundMessage.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const out: Record<string, number> = { QUEUED: 0, SENT: 0, DELIVERED: 0, FAILED: 0, UNKNOWN: 0, CANCELLED: 0, BLOCKED: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  const controls = await getOutboundControls(db);
  return { counts: out, paused: controls.pausedCampaigns, killSwitch: controls.killSwitch };
}
