import type { Db } from "@/server/db";
import { dec, money } from "@/server/money";
import { daysBetween, fromDbDate, bakuBusinessDate } from "@/server/dates";
import { evaluateRulePackage, validateRulePackage, canonicalizeFeatures, type RulePackage } from "@/server/modules/decisions/ruleInterpreter";
import { GOLDEN_CASES } from "@/server/modules/decisions/prometeiaDraftModel";
import { scoreCustomer, segmentForDpd, SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import { computeEra } from "@/server/modules/decisions/era";
import { decideTreatment, ACTION_LABELS } from "@/server/modules/decisions/treatment";
import { getSetting } from "@/server/modules/settings/settingsService";

/** Golden-case run for a package: every expected class/reason must be reproduced before a version can be activated. */
export function runGoldenCases(pkg: RulePackage) {
  const results = GOLDEN_CASES.map((g) => {
    const ev = evaluateRulePackage(pkg, g.features);
    const got = ev.status === "SCORED" ? ev.riskClass : null;
    const reason = ev.status === "UNSCORED" ? ev.reasonCodes[0] : null;
    const pass = g.expectedClass === null ? got === null && (!g.expectedReason || reason === g.expectedReason) : got === g.expectedClass;
    return { name: g.name, expected: g.expectedClass ?? `Unscored (${g.expectedReason ?? "any"})`, got: got ?? `Unscored (${reason ?? "—"})`, pass };
  });
  return { passed: results.filter((r) => r.pass).length, total: results.length, results };
}

/** Leaf-by-leaf comparison of two packages (rules and probabilities). */
export function compareRulePackages(a: RulePackage, b: RulePackage) {
  const classes = new Set([...a.leaves.map((l) => l.riskClass), ...b.leaves.map((l) => l.riskClass)]);
  return [...classes].sort((x, y) => x - y).map((c) => {
    const la = a.leaves.find((l) => l.riskClass === c);
    const lb = b.leaves.find((l) => l.riskClass === c);
    const ruleA = la ? JSON.stringify(la.rule) : null;
    const ruleB = lb ? JSON.stringify(lb.rule) : null;
    return { riskClass: c, probabilityA: la?.probability ?? null, probabilityB: lb?.probability ?? null, ruleChanged: ruleA !== ruleB, probabilityChanged: (la?.probability ?? null) !== (lb?.probability ?? null), missingInA: !la, missingInB: !lb };
  });
}

export interface TestScoreInput { features: Record<string, number | null>; dpd: number; exposure: string; featuresAsOf: string | null; modelVersionId?: string | null }

/** Test-case scoring: features → decision path → class/probability → ERA → bucket (current cutoffs) → action and reason codes. */
export async function testScore(db: Db, input: TestScoreInput, now: Date) {
  const model = input.modelVersionId ? await db.modelVersion.findUnique({ where: { id: input.modelVersionId } }) : await db.modelVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { activatedAt: "desc" } });
  if (!model) return null;
  const pkg = model.rulesJson as unknown as RulePackage;
  const featureMaxAgeDays = (await getSetting<number>("freshness.featureSnapshotMaxAgeDays", db)) ?? 45;
  const selfCure = (await getSetting<boolean>("model.selfCurePreferenceDpd1to3", db)) ?? true;
  const businessDate = bakuBusinessDate(now);
  const featureAgeDays = input.featuresAsOf ? daysBetween(input.featuresAsOf, businessDate) : null;
  const modelValid = ["ACTIVE", "APPROVED", "TESTED", "DRAFT"].includes(model.status) && (!model.validTo || model.validTo >= now);
  const { unmapped } = canonicalizeFeatures(pkg, input.features);
  const scoring = scoreCustomer({ dpd: input.dpd, features: input.features, featuresAsOf: input.featuresAsOf, featureAgeDays, featureMaxAgeDays, modelPackage: pkg, modelValid, demoOnlyEnabled: true });
  const era = scoring.probability ? computeEra(scoring.probability, input.exposure) : null;
  const run = await db.decisionRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
  const cutoffs = ((run?.bucketCutoffs as { cutoffs?: string[] } | null)?.cutoffs ?? []).map((c) => dec(c));
  let bucket: number | null = null;
  if (era !== null && cutoffs.length === 9) {
    bucket = 1;
    for (const c of cutoffs) if (era.greaterThan(c)) bucket++;
    bucket = Math.min(10, bucket);
  }
  const treatment = decideTreatment({ segment: scoring.segment, scored: scoring.status === "SCORED", bucket, selfCurePreference13: selfCure });
  const trace = scoring.trace as { path?: string[]; leafChecks?: { riskClass: number; result: boolean | "UNKNOWN"; missing: string[] }[] } | null;
  return {
    model: { id: model.id, version: model.version, status: model.status },
    segment: scoring.segment,
    segmentLabel: SEGMENT_LABELS[scoring.segment],
    status: scoring.status,
    riskClass: scoring.riskClass,
    probability: scoring.probability,
    probabilitySource: scoring.probabilitySource,
    era: era ? money(era).toFixed(2) : null,
    bucket,
    bucketBasis: run ? `Decile cutoffs of run ${run.id} (${run.businessDate.toISOString().slice(0, 10)})` : "No daily run yet: bucket unavailable",
    action: treatment.effectiveAction,
    actionLabel: ACTION_LABELS[treatment.effectiveAction],
    recommendedAction: treatment.recommendedAction,
    requiredSkill: treatment.requiredSkill,
    reasonCodes: [...scoring.reasonCodes, ...treatment.reasonCodes],
    decisionPath: trace?.path ?? [],
    leafChecks: trace?.leafChecks ?? [],
    unmappedFeatures: unmapped,
    featureAgeDays,
    featureMaxAgeDays,
    note: "Missing or stale features produce Unscored and a manual-review queue, never an invented probability.",
  };
}

/** Preview: score the latest complete feature snapshots of a few customers through a package (read-only). */
export async function sampleScores(db: Db, pkg: RulePackage, customerIds: string[]) {
  const snaps = await db.featureSnapshot.findMany({ where: { customerId: { in: customerIds }, isLatestComplete: true }, orderBy: { asOf: "desc" } });
  const seen = new Set<string>();
  const out: { customerId: string; asOf: string; riskClass: number | null; probability: string | null; status: string; reasons: string[] }[] = [];
  for (const s of snaps) {
    if (seen.has(s.customerId)) continue;
    seen.add(s.customerId);
    const ev = evaluateRulePackage(pkg, s.features as Record<string, number | null>);
    out.push({ customerId: s.customerId, asOf: fromDbDate(s.asOf) ?? "", riskClass: ev.status === "SCORED" ? ev.riskClass : null, probability: ev.status === "SCORED" ? ev.probability : null, status: ev.status, reasons: ev.status === "UNSCORED" ? [...ev.reasonCodes, ...ev.missingFeatures.map((m) => `MISSING:${m}`)] : [] });
  }
  return out;
}

export function validateImportedPackage(raw: unknown) {
  const v = validateRulePackage(raw);
  if (!v.ok) return { ok: false as const, errors: v.errors, golden: null };
  const pkg = raw as RulePackage;
  const golden = runGoldenCases(pkg);
  return { ok: true as const, errors: [] as string[], golden, pkg };
}

export { segmentForDpd };
