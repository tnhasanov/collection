import { z } from "zod";
import type { Db } from "@/server/db";
import { dec, money } from "@/server/money";
import { ACTION_LABELS, bucketTreatment, decideTreatment, type ActionCode } from "@/server/modules/decisions/treatment";
import { SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import { getSetting } from "@/server/modules/settings/settingsService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import type { DecisionSegment } from "@/generated/prisma/enums";

/**
 * Strategy configuration: data, never code. The decision tables are validated for overlaps/gaps, valid
 * probability sources, disabled channels and deterministic precedence before a dry simulation can run.
 * Publishing (APPROVED/ACTIVE) only happens through S11 maker/checker approvals.
 */
export const ACTION_CODES = ["DIGITAL_SELF_CURE", "SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "SELECTIVE_AGENT_CALL", "AGENT_CALL", "AGENT_CALL_PRIORITY", "SENIOR_AGENT_CALL", "MANUAL_REVIEW", "LATER_STAGE_REVIEW", "NO_ACTION_CURRENT"] as const;
const PROBABILITY_SOURCES = ["DEMO_ONLY_1_3_RULE", "DRAFT_TREE_4_10", "DRAFT_ROLL_RATE_11_30", "NONE"] as const;

export const treatmentRowSchema = z.object({
  recommended: z.string().min(1).max(120),
  effective: z.string().min(1).max(120),
  effectiveAction: z.enum(ACTION_CODES).optional(),
  assignment: z.string().max(160).optional(),
  reason: z.string().max(200).optional(),
});

export const strategyConfigSchema = z.object({
  population: z.object({ portfolio: z.string(), dpdBands: z.array(z.string()).min(1), laterStage: z.string() }),
  probability: z.record(z.string(), z.enum(PROBABILITY_SOURCES)),
  exposure: z.object({ definition: z.string(), currency: z.literal("AZN") }),
  actionBucket: z.object({ method: z.string(), tieHandling: z.string() }),
  treatment: z.record(z.string().regex(/^(10|[1-9])(-(10|[1-9]))?$/), treatmentRowSchema),
  channels: z.object({ sms: z.boolean(), call: z.boolean(), ivr: z.boolean(), email: z.boolean() }),
  contactPolicyVersion: z.string(),
  capacity: z.object({ seniorAgents: z.number().int().min(0), regularAgents: z.number().int().min(0), successfulContactsPerAgentDay: z.number().int().min(1) }),
  fallback: z.object({ unscored: z.string(), laterStage: z.string(), ivrUnavailable: z.string() }),
  dispatch: z.object({ mode: z.string(), oneReservationPerCustomer: z.literal(true), oneVoiceInteractionPerCustomer: z.boolean().optional(), oneVoiceInteractionPerAgent: z.literal(true) }),
});
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

function rangeOf(key: string): [number, number] {
  const [a, b] = key.split("-").map(Number);
  return [a, b ?? a];
}

/** Resolve the effective action for a bucket from the config; falls back to the source design table. */
export function effectiveActionForBucket(config: StrategyConfig, bucket: number): { action: ActionCode; row: z.infer<typeof treatmentRowSchema> | null; rangeKey: string | null } {
  for (const [key, row] of Object.entries(config.treatment)) {
    const [lo, hi] = rangeOf(key);
    if (bucket >= lo && bucket <= hi) {
      if (row.effectiveAction) return { action: row.effectiveAction, row, rangeKey: key };
      const t = row.effective.toLowerCase();
      let action: ActionCode = bucketTreatment(bucket).effective;
      if (t.includes("senior")) action = "SENIOR_AGENT_CALL";
      else if (t.includes("if capacity") || t.includes("selective")) action = "SELECTIVE_AGENT_CALL";
      else if (t.includes("call")) action = bucket >= 9 ? "AGENT_CALL_PRIORITY" : "AGENT_CALL";
      else if (t.includes("fallback")) action = "SMS_FALLBACK_IVR_UNAVAILABLE";
      else if (t.includes("self-cure")) action = "SMS_REMINDER";
      return { action, row, rangeKey: key };
    }
  }
  return { action: bucketTreatment(bucket).effective, row: null, rangeKey: null };
}

export interface ValidationIssue { severity: "ERROR" | "WARNING"; code: string; message: string }

/** Structural validation: no overlaps/gaps in bucket ranges, valid probabilities, channel consistency, deterministic precedence. */
export function validateStrategyConfig(raw: unknown): { ok: boolean; issues: ValidationIssue[]; config: StrategyConfig | null } {
  const parsed = strategyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, config: null, issues: parsed.error.issues.map((i) => ({ severity: "ERROR" as const, code: "SCHEMA", message: `${i.path.join(".") || "(root)"}: ${i.message}` })) };
  }
  const config = parsed.data;
  const issues: ValidationIssue[] = [];
  const covered = new Array<number>(11).fill(0);
  for (const key of Object.keys(config.treatment)) {
    const [lo, hi] = rangeOf(key);
    if (lo > hi) issues.push({ severity: "ERROR", code: "RANGE_INVERTED", message: `Treatment range ${key} is inverted` });
    for (let b = lo; b <= hi; b++) covered[b]++;
  }
  for (let b = 1; b <= 10; b++) {
    if (covered[b] === 0) issues.push({ severity: "ERROR", code: "BUCKET_GAP", message: `Action bucket ${b} has no treatment row` });
    if (covered[b] > 1) issues.push({ severity: "ERROR", code: "BUCKET_OVERLAP", message: `Action bucket ${b} is covered by more than one treatment row (precedence would be ambiguous)` });
  }
  for (const band of config.population.dpdBands) {
    if (!/^DPD_\d+_\d+$/.test(band)) issues.push({ severity: "ERROR", code: "BAND_FORMAT", message: `DPD band ${band} is not of the form DPD_a_b` });
  }
  const bands = config.population.dpdBands.map((b) => b.split("_").slice(1).map(Number) as [number, number]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i][0] <= bands[i - 1][1]) issues.push({ severity: "ERROR", code: "BAND_OVERLAP", message: `DPD bands ${config.population.dpdBands[i - 1]} and ${config.population.dpdBands[i]} overlap` });
    else if (bands[i][0] !== bands[i - 1][1] + 1) issues.push({ severity: "WARNING", code: "BAND_GAP", message: `DPD gap between ${bands[i - 1][1]} and ${bands[i][0]}: customers there receive no early-arrears treatment` });
  }
  if (config.probability.DPD_4_10 === "NONE") issues.push({ severity: "WARNING", code: "NO_MODEL_4_10", message: "No probability source for DPD 4-10: every case in the segment would be Unscored (manual review)" });
  if (config.probability.DPD_31_PLUS && config.probability.DPD_31_PLUS !== "NONE") issues.push({ severity: "ERROR", code: "LATER_STAGE_PROBABILITY", message: "31+ DPD has no approved early-arrears probability; it must stay NONE" });
  for (let b = 1; b <= 10; b++) {
    const { action } = effectiveActionForBucket(config, b);
    if (["SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "DIGITAL_SELF_CURE"].includes(action) && !config.channels.sms) issues.push({ severity: "ERROR", code: "CHANNEL_DISABLED", message: `Bucket ${b} maps to an SMS action but the SMS channel is disabled` });
    if (action.includes("CALL") && !config.channels.call) issues.push({ severity: "ERROR", code: "CHANNEL_DISABLED", message: `Bucket ${b} maps to an agent call but the call channel is disabled` });
  }
  if (config.channels.ivr) issues.push({ severity: "WARNING", code: "IVR_NOT_AVAILABLE", message: "IVR is enabled in the strategy but no IVR connector exists in Phase 1; dispatch would fall back to SMS" });
  if (config.capacity.seniorAgents === 0 && [8, 9, 10].some((b) => effectiveActionForBucket(config, b).action === "SENIOR_AGENT_CALL")) issues.push({ severity: "WARNING", code: "NO_SENIOR_CAPACITY", message: "Senior-only buckets with zero senior agents: items would stay queued (overflow exception)" });
  if (config.fallback.unscored !== "MANUAL_REVIEW") issues.push({ severity: "ERROR", code: "UNSCORED_FALLBACK", message: "Unscored customers must route to MANUAL_REVIEW; an invented probability is not allowed" });
  return { ok: !issues.some((i) => i.severity === "ERROR"), issues, config };
}

export interface SimulationResult {
  simulatedAt: string;
  businessDate: string | null;
  baseRunId: string | null;
  population: number;
  scored: number;
  unscored: number;
  bySegment: Record<string, number>;
  byTreatment: { action: string; label: string; candidate: number; active: number; delta: number; exposure: string }[];
  changedCustomers: { customerId: string; bucket: number | null; from: string; to: string; era: string | null }[];
  blockedContacts: { total: number; byReason: Record<string, number> };
  workload: { callItems: number; seniorItems: number; regularItems: number; smsItems: number; capacityCallsPerDay: number; seniorCapacityPerDay: number; regularCapacityPerDay: number; coverageDays: string; seniorOverflow: number; regularOverflow: number };
  channelCosts: { sms: string; agentCustomerDays: string; total: string; activeTotal: string };
  scoreChanges: { note: string; count: number };
  note: string;
}

/**
 * Dry simulation of a strategy configuration over the current decision snapshot. Nothing is written to
 * work items, reservations or customers; only the StrategyVersion's simulationJson is updated by the caller.
 */
export async function simulateStrategy(db: Db, config: StrategyConfig, now: Date, opts: { sampleBlockedLimit?: number } = {}): Promise<SimulationResult> {
  const run = await db.decisionRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
  const snapshots = await db.decisionSnapshot.findMany({ where: { isCurrent: true }, select: { customerId: true, segment: true, actionBucket: true, effectiveAction: true, era: true, exposure: true, probability: true, reasonCodes: true } });
  const selfCure = (await getSetting<boolean>("model.selfCurePreferenceDpd1to3", db)) ?? true;
  const unitCosts = (await getSetting<{ sms: { cost: string }; agent: { cost: string } }>("economics.unitCosts", db)) ?? { sms: { cost: "0.031" }, agent: { cost: "1.75" } };
  const operational = (await getSetting<{ avgHandleSeconds: number; avgAcwSeconds: number; reserveCapacityPct: number; callbackReservePct: number; workingHoursStart: string; workingHoursEnd: string }>("capacity.operational", db)) ?? { avgHandleSeconds: 240, avgAcwSeconds: 60, reserveCapacityPct: 10, callbackReservePct: 15, workingHoursStart: "09:00", workingHoursEnd: "18:00" };

  const bySegment: Record<string, number> = {};
  const byTreatment = new Map<string, { candidate: number; active: number; exposure: ReturnType<typeof dec> }>();
  const changed: SimulationResult["changedCustomers"] = [];
  let scored = 0;
  let callItems = 0, seniorItems = 0, regularItems = 0, smsItems = 0, activeSms = 0, activeCallCustomers = 0;
  const callCustomers: string[] = [];

  for (const s of snapshots) {
    bySegment[s.segment] = (bySegment[s.segment] ?? 0) + 1;
    const isScored = s.probability !== null;
    if (isScored) scored++;
    let candidate: ActionCode;
    if (s.segment === "DPD_0" || s.actionBucket === null || !isScored || ["DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS"].includes(s.segment)) {
      candidate = decideTreatment({ segment: s.segment as DecisionSegment, scored: isScored, bucket: s.actionBucket, selfCurePreference13: selfCure }).effectiveAction;
    } else {
      candidate = effectiveActionForBucket(config, s.actionBucket).action;
      if (s.segment === "DPD_1_3" && selfCure) candidate = "DIGITAL_SELF_CURE";
      if (!config.channels.call && candidate.includes("CALL")) candidate = config.channels.sms ? "SMS_REMINDER" : "MANUAL_REVIEW";
    }
    const active = s.effectiveAction;
    const entry = byTreatment.get(candidate) ?? { candidate: 0, active: 0, exposure: dec(0) };
    entry.candidate++;
    entry.exposure = entry.exposure.plus(s.exposure.toString());
    byTreatment.set(candidate, entry);
    const a = byTreatment.get(active) ?? { candidate: 0, active: 0, exposure: dec(0) };
    a.active++;
    byTreatment.set(active, a);
    if (candidate !== active) changed.push({ customerId: s.customerId, bucket: s.actionBucket, from: active, to: candidate, era: s.era ? s.era.toString() : null });
    if (candidate.includes("CALL")) {
      callItems++;
      callCustomers.push(s.customerId);
      if (candidate === "SENIOR_AGENT_CALL") seniorItems++;
      else regularItems++;
    }
    if (["SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "DIGITAL_SELF_CURE"].includes(candidate)) smsItems++;
    if (["SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "DIGITAL_SELF_CURE"].includes(active)) activeSms++;
    if (active.includes("CALL")) activeCallCustomers++;
  }

  // Blocked contacts: policy evaluation (read-only) for the call population, bounded for responsiveness.
  const limit = opts.sampleBlockedLimit ?? 400;
  const byReason: Record<string, number> = {};
  let blocked = 0;
  for (const customerId of callCustomers.slice(0, limit)) {
    const ev = await evaluateCustomerEligibility(db, customerId, { channel: "VOICE", now, hasSpareCapacity: true });
    if (!ev.decision.eligible) {
      blocked++;
      for (const code of ev.decision.reasonCodes) byReason[code] = (byReason[code] ?? 0) + 1;
    }
  }

  const hours = (() => { const [a, b] = [operational.workingHoursStart, operational.workingHoursEnd].map((h) => { const [hh, mm] = h.split(":").map(Number); return hh + mm / 60; }); return Math.max(1, b - a); })();
  const perAgentPerDay = Math.floor((hours * 3600 * (1 - operational.reserveCapacityPct / 100) * (1 - operational.callbackReservePct / 100)) / (operational.avgHandleSeconds + operational.avgAcwSeconds));
  const seniorCap = config.capacity.seniorAgents * Math.min(perAgentPerDay, config.capacity.successfulContactsPerAgentDay);
  const regularCap = config.capacity.regularAgents * Math.min(perAgentPerDay, config.capacity.successfulContactsPerAgentDay);
  const smsCost = money(dec(unitCosts.sms.cost).times(smsItems));
  const agentCost = money(dec(unitCosts.agent.cost).times(callItems));
  const activeTotal = money(dec(unitCosts.sms.cost).times(activeSms).plus(dec(unitCosts.agent.cost).times(activeCallCustomers)));
  const result: SimulationResult = {
    simulatedAt: now.toISOString(),
    businessDate: run ? run.businessDate.toISOString().slice(0, 10) : null,
    baseRunId: run?.id ?? null,
    population: snapshots.length,
    scored,
    unscored: snapshots.length - scored,
    bySegment,
    byTreatment: [...byTreatment.entries()].map(([action, v]) => ({ action, label: ACTION_LABELS[action as ActionCode] ?? action, candidate: v.candidate, active: v.active, delta: v.candidate - v.active, exposure: money(v.exposure).toFixed(2) })).sort((a, b) => b.candidate - a.candidate),
    changedCustomers: changed.slice(0, 200),
    blockedContacts: { total: blocked, byReason },
    workload: { callItems, seniorItems, regularItems, smsItems, capacityCallsPerDay: seniorCap + regularCap, seniorCapacityPerDay: seniorCap, regularCapacityPerDay: regularCap, coverageDays: seniorCap + regularCap > 0 ? dec(callItems).div(seniorCap + regularCap).toFixed(2) : "n/a", seniorOverflow: Math.max(0, seniorItems - seniorCap), regularOverflow: Math.max(0, regularItems - regularCap) },
    channelCosts: { sms: smsCost.toFixed(2), agentCustomerDays: agentCost.toFixed(2), total: smsCost.plus(agentCost).toFixed(2), activeTotal: activeTotal.toFixed(2) },
    scoreChanges: { note: "Probabilities come from the active model version; a strategy change never alters scores. Model changes are simulated on S13.", count: 0 },
    note: "Dry simulation over the current daily snapshot. Counts are customers (one case per customer); exposure is the demo exposure definition in AZN. No work item, reservation or customer record was changed.",
  };
  return result;
}

/** Customer-level explanation: how the candidate strategy would decide for one customer versus the active snapshot. */
export async function explainCustomerUnderStrategy(db: Db, customerId: string, config: StrategyConfig, now: Date) {
  const snapshot = await db.decisionSnapshot.findFirst({ where: { customerId, isCurrent: true }, include: { score: true } });
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, displayName: true } });
  if (!customer) return null;
  const selfCure = (await getSetting<boolean>("model.selfCurePreferenceDpd1to3", db)) ?? true;
  let candidate: { action: ActionCode; rangeKey: string | null; row: z.infer<typeof treatmentRowSchema> | null } = { action: "NO_ACTION_CURRENT", rangeKey: null, row: null };
  if (snapshot) {
    if (snapshot.actionBucket !== null && snapshot.probability !== null && !["DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS", "DPD_0"].includes(snapshot.segment)) candidate = effectiveActionForBucket(config, snapshot.actionBucket);
    else candidate = { action: decideTreatment({ segment: snapshot.segment, scored: snapshot.probability !== null, bucket: snapshot.actionBucket, selfCurePreference13: selfCure }).effectiveAction, rangeKey: null, row: null };
    if (snapshot.segment === "DPD_1_3" && selfCure && snapshot.probability !== null) candidate = { ...candidate, action: "DIGITAL_SELF_CURE" };
  }
  const eligibility = snapshot ? await evaluateCustomerEligibility(db, customerId, { channel: "VOICE", now, hasSpareCapacity: true }) : null;
  return {
    customer,
    snapshot: snapshot ? { segment: snapshot.segment, segmentLabel: SEGMENT_LABELS[snapshot.segment], dpd: snapshot.decisionDpd, probability: snapshot.probability?.toString() ?? null, probabilitySource: snapshot.probabilitySource, riskClass: snapshot.riskClass, exposure: snapshot.exposure.toString(), era: snapshot.era?.toString() ?? null, bucket: snapshot.actionBucket, rank: snapshot.rank, activeAction: snapshot.effectiveAction, activeLabel: ACTION_LABELS[snapshot.effectiveAction as ActionCode] ?? snapshot.effectiveAction, reasonCodes: snapshot.reasonCodes, scoreTrace: snapshot.score?.tracePath ?? null } : null,
    candidate: { action: candidate.action, label: ACTION_LABELS[candidate.action], rangeKey: candidate.rangeKey, row: candidate.row },
    changed: snapshot ? snapshot.effectiveAction !== candidate.action : false,
    eligibility: eligibility ? { eligible: eligibility.decision.eligible, reasonCodes: eligibility.decision.reasonCodes, reasons: eligibility.decision.reasonCodes.map((c) => REASON_LABELS[c] ?? c), nextAllowedAt: eligibility.decision.nextAllowedAt?.toISOString() ?? null, checks: eligibility.decision.checks.map((c) => ({ code: c.code, label: REASON_LABELS[c.code] ?? c.code, passed: c.passed, detail: c.detail ?? null })) } : null,
    note: "Contact restrictions are re-evaluated by the server at scheduling, reservation and before dispatch; a treatment never bypasses them.",
  };
}
