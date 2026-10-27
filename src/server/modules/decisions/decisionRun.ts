import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import { bakuBusinessDate, daysBetween, fromDbDate, toDbDate, type IsoDate } from "@/server/dates";
import { dec, toDbMoney } from "@/server/money";
import { scoreCustomer } from "@/server/modules/decisions/segments";
import { buildDecileBuckets, computeEra } from "@/server/modules/decisions/era";
import { decideTreatment } from "@/server/modules/decisions/treatment";
import { rankCandidates, TIEBREAK_DESCRIPTION } from "@/server/modules/decisions/ranking";
import type { RulePackage } from "@/server/modules/decisions/ruleInterpreter";
import { getSetting } from "@/server/modules/settings/settingsService";
import { refreshWorkItemEligibility, syncRoutineWorkItem } from "@/server/modules/work/workItemService";
import { appendAudit } from "@/server/modules/audit/audit";

export interface DecisionRunSummary {
  runId: string;
  businessDate: IsoDate;
  population: number;
  scored: number;
  unscored: number;
  byClass: Record<string, number>;
  byBucket: Record<string, number>;
  bySegment: Record<string, number>;
  eligibleCalls: number;
  deferredCalls: number;
  seniorOverflow: number;
}

const EXPOSURE_DEFINITION = "SUM_ELIGIBLE_ACTIVE_CASH_LOAN_PRINCIPAL_OUTSTANDING_PER_CUSTOMER";
const VOICE_CAMPAIGN = "SOFT_COLLECTIONS_VOICE";

/**
 * Daily decision snapshot: segment → probability → exposure/ERA → action bucket → treatment → work items → eligibility.
 * Repeated runs on identical facts and policy produce identical scores, ties and ranks.
 */
export async function runDailyDecision(prisma: PrismaClient, opts: { triggeredBy: string; now: Date }): Promise<DecisionRunSummary> {
  const now = opts.now;
  const businessDate = bakuBusinessDate(now);
  const [model, strategy, policy] = await Promise.all([
    prisma.modelVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { activatedAt: "desc" } }),
    prisma.strategyVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { activatedAt: "desc" } }),
    prisma.contactPolicyVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { activatedAt: "desc" } }),
  ]);
  const selfCure = (await getSetting<boolean>("model.selfCurePreferenceDpd1to3")) ?? true;
  const featureMaxAgeDays = (await getSetting<number>("freshness.featureSnapshotMaxAgeDays")) ?? 45;
  const capacity = (await getSetting<{ seniorAgents: number; successfulContactsPerAgentDay: number }>("capacity.planning")) ?? { seniorAgents: 2, successfulContactsPerAgentDay: 80 };

  const run = await prisma.decisionRun.create({
    data: { businessDate: toDbDate(businessDate), triggeredBy: opts.triggeredBy, modelVersionId: model?.id, strategyVersionId: strategy?.id, policyVersionId: policy?.id, tieHandling: "IDENTICAL_ERA_SAME_BUCKET_LOWER" },
  });

  const cases = await prisma.collectionCase.findMany({ where: { status: { in: ["OPEN", "HANDOVER"] } }, include: { customer: { include: { loans: true, featureSnapshots: { where: { isLatestComplete: true }, orderBy: { asOf: "desc" }, take: 1 } } } } });
  const modelPackage = (model?.rulesJson ?? null) as RulePackage | null;

  type Row = {
    caseId: string;
    customerId: string;
    language: "AZ" | "EN" | "RU";
    dpd: number;
    exposure: string;
    totalOverdue: string;
    oldestOverdue: string | null;
    scoring: ReturnType<typeof scoreCustomer>;
    era: string | null;
    featureSnapshotId: string | null;
    featuresAsOf: Date | null;
  };
  const rows: Row[] = [];
  for (const c of cases) {
    const active = c.customer.loans.filter((l) => l.status === "ACTIVE");
    const dpd = active.reduce((m, l) => Math.max(m, l.dpd), 0);
    const exposure = active.reduce((s, l) => s.plus(l.principalOutstanding), dec(0));
    const totalOverdue = active.reduce((s, l) => s.plus(l.totalOverdue), dec(0));
    const oldest = active.map((l) => fromDbDate(l.oldestUnpaidDueDate)).filter((d): d is string => !!d).sort()[0] ?? null;
    const fs = c.customer.featureSnapshots[0] ?? null;
    const featuresAsOf = fs ? fromDbDate(fs.asOf) : null;
    const scoring = scoreCustomer({
      dpd,
      features: fs ? (fs.features as Record<string, number | null>) : null,
      featuresAsOf,
      featureAgeDays: featuresAsOf ? daysBetween(featuresAsOf, businessDate) : null,
      featureMaxAgeDays,
      modelPackage: modelPackage ?? { modelCode: "NONE", version: "0", provider: "none", features: [], leaves: [], provenance: "", status: "DRAFT", targetEvent: "", horizon: "", population: "", unresolvedIssues: [] },
      modelValid: !!model && !!modelPackage && (!model.validTo || model.validTo.getTime() > now.getTime()),
      demoOnlyEnabled: process.env.APP_MODE === "DEMO",
    });
    const era = scoring.status === "SCORED" ? computeEra(scoring.probability, exposure) : null;
    rows.push({ caseId: c.id, customerId: c.customerId, language: c.customer.language, dpd, exposure: toDbMoney(exposure), totalOverdue: toDbMoney(totalOverdue), oldestOverdue: oldest, scoring, era: era ? era.toFixed(2) : null, featureSnapshotId: fs?.id ?? null, featuresAsOf: fs?.asOf ?? null });
  }

  const buckets = buildDecileBuckets(rows.filter((r) => r.era !== null).map((r) => r.era!));
  const ranked = rankCandidates(rows.map((r) => ({ customerId: r.customerId, era: r.era, oldestOverdueDueDate: r.oldestOverdue, row: r })));

  const byClass: Record<string, number> = {};
  const byBucket: Record<string, number> = {};
  const bySegment: Record<string, number> = {};
  let scoredCount = 0;
  let eligibleCalls = 0;
  let deferredCalls = 0;
  let seniorEligible = 0;

  await prisma.decisionSnapshot.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });

  for (const r of ranked) {
    const row = r.row;
    const s = row.scoring;
    const bucket = row.era !== null ? buckets.assign(row.era) : null;
    const treatment = decideTreatment({ segment: s.segment, scored: s.status === "SCORED", bucket, selfCurePreference13: selfCure });
    bySegment[s.segment] = (bySegment[s.segment] ?? 0) + 1;
    if (s.status === "SCORED") scoredCount++;
    if (s.riskClass) byClass[String(s.riskClass)] = (byClass[String(s.riskClass)] ?? 0) + 1;
    if (bucket) byBucket[String(bucket)] = (byBucket[String(bucket)] ?? 0) + 1;

    await prisma.$transaction(async (tx: Db) => {
      let scoreId: string | null = null;
      if (s.segment !== "DPD_0") {
        const score = await tx.score.create({
          data: {
            customerId: row.customerId,
            featureSnapshotId: row.featureSnapshotId,
            modelVersionId: s.probabilitySource === "DRAFT_TREE_4_10" ? model?.id : null,
            segment: s.segment,
            status: s.status,
            riskClass: s.riskClass,
            probability: s.probability,
            probabilitySource: s.probabilitySource,
            tracePath: (s.trace ?? {}) as never,
            reasonCodes: s.reasonCodes,
            featuresAsOf: row.featuresAsOf,
          },
        });
        scoreId = score.id;
      }
      const snapshot = await tx.decisionSnapshot.create({
        data: {
          runId: run.id,
          businessDate: toDbDate(businessDate),
          customerId: row.customerId,
          caseId: row.caseId,
          decisionDpd: row.dpd,
          segment: s.segment,
          exposure: row.exposure,
          exposureDefinition: EXPOSURE_DEFINITION,
          totalOverdue: row.totalOverdue,
          scoreId,
          probability: s.probability,
          probabilitySource: s.probabilitySource,
          riskClass: s.riskClass,
          era: row.era,
          actionBucket: bucket,
          recommendedAction: treatment.recommendedAction,
          effectiveAction: treatment.effectiveAction,
          eligibility: { treatment: { routineCallAllowed: treatment.routineCallAllowed, capacityGated: treatment.capacityGated, reasons: treatment.reasonCodes } } as never,
          reasonCodes: [...s.reasonCodes, ...treatment.reasonCodes],
          rank: r.rank,
          tiebreak: { rule: TIEBREAK_DESCRIPTION, oldestOverdueDueDate: row.oldestOverdue } as never,
          requiredSkill: treatment.requiredSkill,
          modelVersionId: s.probabilitySource === "DRAFT_TREE_4_10" ? model?.id : null,
          strategyVersionId: strategy?.id,
          policyVersionId: policy?.id,
          isCurrent: true,
        },
      });
      await tx.collectionCase.update({ where: { id: row.caseId }, data: { latestDecisionId: snapshot.id, maxDpd: row.dpd, totalOverdue: row.totalOverdue, modelExposure: row.exposure } });
      const wi = await syncRoutineWorkItem(tx, {
        customerId: row.customerId,
        caseId: row.caseId,
        snapshotId: snapshot.id,
        effectiveAction: treatment.effectiveAction,
        era: row.era,
        rank: r.rank,
        requiredSkill: treatment.requiredSkill,
        language: row.language,
        campaignCode: treatment.effectiveAction.includes("CALL") ? VOICE_CAMPAIGN : null,
        now,
      });
      if (wi && wi.type === "CALL") {
        const refreshed = await refreshWorkItemEligibility(tx, wi.id, now);
        if (refreshed.status === "ELIGIBLE") {
          eligibleCalls++;
          if (refreshed.requiredSkill === "SENIOR") seniorEligible++;
        } else if (refreshed.status === "DEFERRED") deferredCalls++;
      } else if (wi) {
        await refreshWorkItemEligibility(tx, wi.id, now);
      }
    });
  }

  const seniorCapacity = capacity.seniorAgents * capacity.successfulContactsPerAgentDay;
  const overflow = Math.max(0, seniorEligible - seniorCapacity);
  if (overflow > 0) {
    await prisma.exceptionCase.upsert({
      where: { dedupKey: `SENIOR_OVERFLOW:${businessDate}` },
      create: { dedupKey: `SENIOR_OVERFLOW:${businessDate}`, type: "SENIOR_CAPACITY_OVERFLOW", severity: "WARNING", title: `Senior-only eligible backlog (${seniorEligible}) exceeds senior capacity (${seniorCapacity})`, evidence: { seniorEligible, seniorCapacity, businessDate } as never },
      update: { lastSeenAt: now, occurrences: { increment: 1 }, evidence: { seniorEligible, seniorCapacity, businessDate } as never, status: "OPEN" },
    });
  }

  await prisma.decisionRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", finishedAt: now, populationCount: rows.length, scoredCount, unscoredCount: rows.length - scoredCount, bucketCutoffs: { cutoffs: buckets.cutoffs, distinctValues: buckets.distinctValues, population: buckets.populationCount, method: "DECILE_AT_DAILY_SNAPSHOT" } as never },
  });
  await appendAudit(prisma, { actorService: opts.triggeredBy, action: "decision.run.completed", objectType: "DecisionRun", objectId: run.id, versionIds: { modelVersionId: model?.id, strategyVersionId: strategy?.id, policyVersionId: policy?.id }, changes: { population: rows.length, scored: scoredCount, byClass, byBucket } });

  return { runId: run.id, businessDate, population: rows.length, scored: scoredCount, unscored: rows.length - scoredCount, byClass, byBucket, bySegment, eligibleCalls, deferredCalls, seniorOverflow: overflow };
}
