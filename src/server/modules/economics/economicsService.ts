import { z } from "zod";
import type { Db } from "@/server/db";
import { dec, money, Decimal } from "@/server/money";
import { formatBakuDateTime, BAKU_ZONE } from "@/server/dates";
import { breakEvenEra } from "@/server/modules/decisions/era";
import { getSetting } from "@/server/modules/settings/settingsService";
import { DateTime } from "luxon";

/**
 * Action economics and capacity (S14). Uplift is an ASSUMPTION per scenario (relative ERA reduction), never a
 * measured causal benefit. Break-even ERA = unit cost ÷ assumed uplift. Nothing here activates anything.
 */
export const economicsInputSchema = z.object({
  unitCosts: z.object({ sms: z.string().regex(/^\d+(\.\d+)?$/), ivr: z.string().regex(/^\d+(\.\d+)?$/), agent: z.string().regex(/^\d+(\.\d+)?$/) }),
  uplift: z.object({ sms: z.string().regex(/^\d*\.?\d+$/), ivr: z.string().regex(/^\d*\.?\d+$/), agent: z.string().regex(/^\d*\.?\d+$/) }),
  channels: z.object({ sms: z.boolean(), call: z.boolean(), ivr: z.boolean(), email: z.boolean() }),
  capacity: z.object({
    seniorAgents: z.number().int().min(0).max(500),
    regularAgents: z.number().int().min(0).max(500),
    workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
    workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
    avgHandleSeconds: z.number().int().min(30).max(3600),
    avgAcwSeconds: z.number().int().min(0).max(1800),
    reserveCapacityPct: z.number().min(0).max(90),
    callbackReservePct: z.number().min(0).max(90),
    expectedRpcRate: z.string().regex(/^\d*\.?\d+$/),
    retryDemandPct: z.number().min(0).max(300),
    successfulContactsPerAgentDay: z.number().int().min(1).max(1000),
  }),
});
export type EconomicsInput = z.infer<typeof economicsInputSchema>;

export async function defaultEconomicsInput(db: Db, scenario: "conservative" | "base" | "upside" = "base"): Promise<EconomicsInput> {
  const costs = (await getSetting<{ sms: { cost: string }; ivr: { cost: string }; agent: { cost: string } }>("economics.unitCosts", db)) ?? { sms: { cost: "0.031" }, ivr: { cost: "0.20" }, agent: { cost: "1.75" } };
  const uplifts = (await getSetting<Record<"sms" | "ivr" | "agent", Record<"conservative" | "base" | "upside", string>>>("economics.upliftScenarios", db)) ?? { sms: { conservative: "0.001", base: "0.003", upside: "0.005" }, ivr: { conservative: "0.005", base: "0.01", upside: "0.025" }, agent: { conservative: "0.025", base: "0.05", upside: "0.075" } };
  const channels = (await getSetting<EconomicsInput["channels"]>("economics.channels", db)) ?? { sms: true, call: true, ivr: false, email: false };
  const planning = (await getSetting<{ seniorAgents: number; regularAgents: number; successfulContactsPerAgentDay: number; historicalRpcRate: string }>("capacity.planning", db)) ?? { seniorAgents: 2, regularAgents: 4, successfulContactsPerAgentDay: 80, historicalRpcRate: "0.76" };
  const op = (await getSetting<{ workingHoursStart: string; workingHoursEnd: string; avgHandleSeconds: number; avgAcwSeconds: number; reserveCapacityPct: number; callbackReservePct: number }>("capacity.operational", db)) ?? { workingHoursStart: "09:00", workingHoursEnd: "18:00", avgHandleSeconds: 240, avgAcwSeconds: 60, reserveCapacityPct: 10, callbackReservePct: 15 };
  return {
    unitCosts: { sms: costs.sms.cost, ivr: costs.ivr.cost, agent: costs.agent.cost },
    uplift: { sms: uplifts.sms[scenario], ivr: uplifts.ivr[scenario], agent: uplifts.agent[scenario] },
    channels,
    capacity: { seniorAgents: planning.seniorAgents, regularAgents: planning.regularAgents, workingHoursStart: op.workingHoursStart, workingHoursEnd: op.workingHoursEnd, avgHandleSeconds: op.avgHandleSeconds, avgAcwSeconds: op.avgAcwSeconds, reserveCapacityPct: op.reserveCapacityPct, callbackReservePct: op.callbackReservePct, expectedRpcRate: planning.historicalRpcRate ?? "0.76", retryDemandPct: 35, successfulContactsPerAgentDay: planning.successfulContactsPerAgentDay },
  };
}

type Snap = { customerId: string; era: Decimal | null; actionBucket: number | null; effectiveAction: string; rank: number | null; requiredSkill: string | null; segment: string };

function channelEconomics(name: "sms" | "ivr" | "agent", enabled: boolean, cost: string, uplift: string, population: Snap[]) {
  if (dec(uplift).lessThanOrEqualTo(0)) return { channel: name, enabled, unitCost: cost, uplift, breakEvenEra: null, eligible: 0, aboveBreakEven: 0, assumedBenefit: "0.00", cost: "0.00", netBenefit: "0.00", eraTotal: "0.00", note: "Uplift must be positive" };
  const be = breakEvenEra(cost, uplift);
  const scored = population.filter((s) => s.era !== null);
  const above = scored.filter((s) => s.era!.greaterThanOrEqualTo(be));
  const eraTotal = above.reduce((a, s) => a.plus(s.era!), dec(0));
  const benefit = money(eraTotal.times(uplift));
  const totalCost = money(dec(cost).times(above.length));
  return { channel: name, enabled, unitCost: cost, uplift, breakEvenEra: money(be).toFixed(2), eligible: scored.length, aboveBreakEven: above.length, assumedBenefit: benefit.toFixed(2), cost: totalCost.toFixed(2), netBenefit: benefit.minus(totalCost).toFixed(2), eraTotal: money(eraTotal).toFixed(2), note: enabled ? "Assumed uplift × ERA of customers at or above break-even; not a measured causal effect" : "Channel disabled in Phase 1: shown for comparison only; unavailable IVR cannot turn every digital case into an agent call" };
}

export async function computeEconomics(db: Db, input: EconomicsInput, now: Date) {
  const snapshots = await db.decisionSnapshot.findMany({ where: { isCurrent: true }, select: { customerId: true, era: true, actionBucket: true, effectiveAction: true, rank: true, requiredSkill: true, segment: true } });
  const pop: Snap[] = snapshots.map((s) => ({ ...s, era: s.era ? dec(s.era.toString()) : null }));
  const smsPop = pop.filter((s) => s.actionBucket !== null && s.actionBucket <= 7);
  const ivrPop = pop.filter((s) => s.actionBucket !== null && s.actionBucket >= 5 && s.actionBucket <= 7);
  const callPop = pop.filter((s) => s.actionBucket !== null && s.actionBucket >= 7);
  const channels = [
    channelEconomics("sms", input.channels.sms, input.unitCosts.sms, input.uplift.sms, smsPop),
    channelEconomics("ivr", input.channels.ivr, input.unitCosts.ivr, input.uplift.ivr, ivrPop),
    channelEconomics("agent", input.channels.call, input.unitCosts.agent, input.uplift.agent, callPop),
  ];

  // Capacity
  const c = input.capacity;
  const [hs, ms] = c.workingHoursStart.split(":").map(Number);
  const [he, me] = c.workingHoursEnd.split(":").map(Number);
  const hours = Math.max(0, he + me / 60 - (hs + ms / 60));
  const productiveSeconds = hours * 3600 * (1 - c.reserveCapacityPct / 100) * (1 - c.callbackReservePct / 100);
  const attemptsPerAgentDay = Math.floor(productiveSeconds / (c.avgHandleSeconds + c.avgAcwSeconds));
  const rpc = dec(c.expectedRpcRate);
  const successfulPerAgentDay = Math.min(c.successfulContactsPerAgentDay, Math.floor(dec(attemptsPerAgentDay).times(rpc).toNumber()));
  const agents = c.seniorAgents + c.regularAgents;
  const attemptsCapacity = attemptsPerAgentDay * agents;
  const successfulCapacity = successfulPerAgentDay * agents;
  const seniorSuccessful = successfulPerAgentDay * c.seniorAgents;
  const regularSuccessful = successfulPerAgentDay * c.regularAgents;
  const callItems = pop.filter((s) => s.effectiveAction.includes("CALL"));
  const seniorItems = callItems.filter((s) => s.requiredSkill === "SENIOR");
  const regularItems = callItems.filter((s) => s.requiredSkill !== "SENIOR");
  const retryDemand = Math.round(callItems.length * (c.retryDemandPct / 100));
  const distinctCustomersPerDay = Math.max(0, Math.floor(attemptsCapacity / (1 + c.retryDemandPct / 100)));
  const ranked = callItems.filter((s) => s.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const cutIndex = Math.min(ranked.length, successfulCapacity) - 1;
  const riskPriorityCut = cutIndex >= 0 ? { rank: ranked[cutIndex].rank, era: ranked[cutIndex].era ? money(ranked[cutIndex].era!).toFixed(2) : null, bucket: ranked[cutIndex].actionBucket } : null;

  // Observed today (Baku business day): attempts vs distinct customers vs successful contacts
  const dayStart = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const attempts = await db.dialAttempt.findMany({ where: { startedAt: { gte: dayStart } }, select: { reservation: { select: { customerId: true } } } });
  const rpcs = await db.interaction.count({ where: { startedAt: { gte: dayStart }, isRpc: true } });
  const ptps = await db.promise.count({ where: { createdAt: { gte: dayStart } } });
  const sms = await db.outboundMessage.count({ where: { requestedAt: { gte: dayStart } } });
  const observed = { attempts: attempts.length, distinctCustomers: new Set(attempts.map((a) => a.reservation.customerId)).size, successfulContacts: rpcs, promises: ptps, smsQueued: sms, since: formatBakuDateTime(dayStart) };

  return {
    computedAt: now.toISOString(),
    population: { customers: pop.length, scored: pop.filter((s) => s.era !== null).length, callItems: callItems.length, seniorItems: seniorItems.length, regularItems: regularItems.length, smsItems: pop.filter((s) => ["SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "DIGITAL_SELF_CURE"].includes(s.effectiveAction)).length, eraTotal: money(pop.reduce((a, s) => a.plus(s.era ?? 0), dec(0))).toFixed(2) },
    channels,
    capacity: { agents, hours: dec(hours).toFixed(2), attemptsPerAgentDay, successfulPerAgentDay, attemptsCapacity, successfulCapacity, seniorSuccessful, regularSuccessful, retryDemand, distinctCustomersPerDay, seniorOverflow: Math.max(0, seniorItems.length - seniorSuccessful), regularOverflow: Math.max(0, regularItems.length - regularSuccessful), coverageDays: successfulCapacity > 0 ? dec(callItems.length + retryDemand).div(successfulCapacity).toFixed(2) : "n/a", riskPriorityCut },
    observed,
    fallback: { ivrEnabled: input.channels.ivr, ivrPopulation: ivrPop.length, note: input.channels.ivr ? "IVR enabled in the scenario, but no Phase 1 connector exists: dispatch would still fall back to SMS." : `IVR unavailable: ${ivrPop.length} bucket 5–7 customers fall back to SMS. Converting them into agent calls would add ${ivrPop.length} call items (${successfulCapacity > 0 ? dec(ivrPop.length).div(successfulCapacity).toFixed(2) : "n/a"} days of successful-contact capacity).` },
    disclaimers: ["Uplift values are scenario assumptions, not measured causal benefit.", "ERA is a ranking amount (probability × exposure), not expected recovery.", "Capacity figures are planning estimates; the real limiter is successful contacts, not attempts."],
  };
}
