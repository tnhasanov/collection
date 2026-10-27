import type { Db } from "@/server/db";
import { DateTime } from "luxon";
import { BAKU_ZONE, fromDbDate } from "@/server/dates";
import { PROMETEIA_DRAFT_MODEL } from "@/server/modules/decisions/prometeiaDraftModel";

/**
 * Model monitoring (S19). Live panels show only what the data supports: coverage, missing/stale inputs,
 * unscored rate, class distribution, overrides and version context. Observed-versus-assigned roll rates,
 * GINI/AUC, calibration and drift are reported as unavailable/insufficient until matured, labelled monthly
 * observations exist. Historical deck statistics live in the documentation box, not in live results.
 */
export async function modelMonitoring(db: Db, now: Date) {
  const active = await db.modelVersion.findFirst({ where: { status: "ACTIVE" } });
  const strategy = await db.strategyVersion.findFirst({ where: { status: "ACTIVE" } });
  const policy = await db.contactPolicyVersion.findFirst({ where: { status: "ACTIVE" } });
  const run = await db.decisionRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
  const snaps = await db.decisionSnapshot.findMany({ where: { isCurrent: true }, select: { customerId: true, segment: true, probability: true, probabilitySource: true, riskClass: true, reasonCodes: true, exposure: true } });
  const treePop = snaps.filter((s) => s.segment === "DPD_4_10");
  const scored = treePop.filter((s) => s.probability !== null);
  const unscoredReasons: Record<string, number> = {};
  for (const s of treePop.filter((x) => x.probability === null)) for (const r of s.reasonCodes.filter((c) => !c.startsWith("BUCKET") && c !== "UNSCORED_MANUAL_REVIEW")) unscoredReasons[r] = (unscoredReasons[r] ?? 0) + 1;
  const classDist = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ riskClass: c, probability: PROMETEIA_DRAFT_MODEL.leaves.find((l) => l.riskClass === c)?.probability ?? null, customers: scored.filter((s) => s.riskClass === c).length, share: scored.length ? (scored.filter((s) => s.riskClass === c).length / scored.length).toFixed(3) : null }));
  const features = await db.featureSnapshot.groupBy({ by: ["observationMonth"], _count: { _all: true }, orderBy: { observationMonth: "asc" } });
  const latestMonth = features.at(-1)?.observationMonth ?? null;
  const customersWithFeatures = await db.featureSnapshot.findMany({ where: { isLatestComplete: true }, select: { customerId: true, asOf: true, qualityFlags: true } });
  const fMap = new Map(customersWithFeatures.map((f) => [f.customerId, f]));
  const businessDate = run ? fromDbDate(run.businessDate)! : DateTime.fromJSDate(now, { zone: BAKU_ZONE }).toISODate()!;
  const stale = treePop.filter((s) => { const f = fMap.get(s.customerId); return f && DateTime.fromISO(businessDate).diff(DateTime.fromJSDate(f.asOf), "days").days > 45; }).length;
  const missing = treePop.filter((s) => !fMap.has(s.customerId)).length;
  const runs = await db.decisionRun.findMany({ where: { status: "COMPLETED" }, orderBy: { startedAt: "asc" }, select: { businessDate: true } });
  const firstRun = runs[0] ? fromDbDate(runs[0].businessDate)! : null;
  const maturedDays = firstRun ? DateTime.fromISO(businessDate).diff(DateTime.fromISO(firstRun), "days").days : 0;
  const overrides = await db.outcomeCorrection.count();
  const reassignments = await db.auditEvent.count({ where: { action: { in: ["workitem.reassigned", "work.reassigned"] } } });
  const externalScores = await db.score.count({ where: { probabilitySource: "EXTERNAL_SUPPLIED" } });
  return {
    versions: { model: active ? `${active.modelCode} ${active.version} (${active.status})` : "none", features: latestMonth ? `PROMETEIA_FEATURE_FILE ${latestMonth}` : "none", strategy: strategy ? `${strategy.code} ${strategy.version}` : "none", policy: policy ? `${policy.code} ${policy.version}` : "none", run: run ? `${run.id} · ${businessDate}` : "none" },
    coverage: { population4to10: treePop.length, withFeatures: treePop.length - missing, missingFeatures: missing, staleFeatures: stale, scored: scored.length, unscored: treePop.length - scored.length, unscoredRate: treePop.length ? ((treePop.length - scored.length) / treePop.length).toFixed(3) : null, unscoredReasons },
    classDistribution: classDist,
    featureMonths: features.map((f) => ({ month: f.observationMonth, snapshots: f._count._all })),
    observedVsAssigned: { available: false, reason: `Needs matured monthly observations (target: deterioration to over 30 DPD within the following month). Observation window matured: ${Math.max(0, Math.floor(maturedDays))} of 30 days since the first daily snapshot${firstRun ? ` (${firstRun})` : ""}. Shown as unavailable, not estimated.` },
    rankingPerformance: { available: false, reason: "GINI/AUC and calibration require labelled, matured observations in a development / out-of-time / live split. No labelled sample exists in the demo; nothing is fabricated." },
    drift: { available: features.length >= 2, reason: features.length >= 2 ? "Two or more feature months exist; PSI per feature is computed on S19 P2 (not yet implemented)" : "Population-stability needs at least two complete feature months; only one monthly file is loaded." },
    overrides: { outcomeCorrections: overrides, reassignments, externalScores },
    documentation: { developmentGini: "36.6% (train, deck)", outOfTimeGini: "40.4% (OOT, deck)", note: "Historical deck values belong to model documentation. They are not live results and are not comparable with the synthetic demo portfolio." },
    asOf: now.toISOString(),
  };
}
