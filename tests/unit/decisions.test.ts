import { describe, expect, it } from "vitest";
import { evaluateRulePackage, validateRulePackage } from "@/server/modules/decisions/ruleInterpreter";
import { PROMETEIA_DRAFT_MODEL } from "@/server/modules/decisions/prometeiaDraftModel";
import { scoreCustomer, segmentForDpd } from "@/server/modules/decisions/segments";
import { buildDecileBuckets, computeEra, breakEvenEra } from "@/server/modules/decisions/era";
import { decideTreatment } from "@/server/modules/decisions/treatment";
import { rankCandidates } from "@/server/modules/decisions/ranking";

const base = { DPD_MAX_MAX12: 5, DPD_RATIO_ADJ_MAX12: 0.05, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: 0.1 };

function cls(features: Record<string, number | null>) {
  const r = evaluateRulePackage(PROMETEIA_DRAFT_MODEL, features);
  return r.status === "SCORED" ? r.riskClass : `UNSCORED:${r.reasonCodes.join(",")}`;
}

describe("Prometeia draft tree (acceptance case 4)", () => {
  it("reaches all eight classes", () => {
    expect(cls({ ...base, DPD_MAX_MAX12: 5, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe(1);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe(2);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.01 })).toBe(3);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.028 })).toBe(4);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.1 })).toBe(5);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.3 })).toBe(6);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 2 })).toBe(7);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.5 })).toBe(8);
  });

  it("verifies boundaries at 7, 30, 0.025, 0.03, -0.4, 1 and 0.2", () => {
    expect(cls({ ...base, DPD_MAX_MAX12: 7, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe(1);
    expect(cls({ ...base, DPD_MAX_MAX12: 7.5, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe(2);
    expect(cls({ ...base, DPD_MAX_MAX12: 30, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe(2);
    expect(cls({ ...base, DPD_MAX_MAX12: 30.5, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: 0.1 })).toBe(5);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.025 })).toBe(3);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.0251 })).toBe(4);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.03 })).toBe(4);
    expect(cls({ ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.0301 })).toBe(2);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.4 })).toBe(8);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.39, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.2 })).toBe(5);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.39, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.21 })).toBe(6);
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.39, DPD30_ADJ100_CNT_L6M: 1.5 })).toBe(7);
  });

  it("treats missing data as unknown, never as zero", () => {
    expect(cls({ ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: null })).toBe("UNSCORED:MISSING_PATH_INPUT");
    // A feature that is not on the resolved path does not block scoring.
    expect(cls({ DPD_MAX_MAX12: 5, DPD_RATIO_ADJ_MAX12: 0.05, DPD_RATIO_ADJ_V3LM: null, DPD30_ADJ100_CNT_L6M: null, DPD_RATIO_ADJ_VLM: null })).toBe(1);
    expect(cls({ DPD_MAX_MAX12: null, DPD_RATIO_ADJ_MAX12: 0.05 })).toBe("UNSCORED:MISSING_PATH_INPUT");
  });

  it("maps the spelling alias explicitly", () => {
    const r = evaluateRulePackage(PROMETEIA_DRAFT_MODEL, { DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: 0, DPD_30_ADJ100_CNT_L6M: 2 });
    expect(r.status === "SCORED" && r.riskClass).toBe(7);
  });

  it("validates package structure without executing code", () => {
    expect(validateRulePackage(PROMETEIA_DRAFT_MODEL).ok).toBe(true);
    const bad = { ...PROMETEIA_DRAFT_MODEL, leaves: [{ riskClass: 1, probability: "1.5", label: "x", rule: { feature: "NOPE", cmp: "??", value: "1" } }] };
    const v = validateRulePackage(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

describe("segment coverage (acceptance case 5)", () => {
  const common = { features: { ...base, MAX_DPD_L3M: 3 }, featuresAsOf: "2026-09-30", featureAgeDays: 27, featureMaxAgeDays: 45, modelPackage: PROMETEIA_DRAFT_MODEL, modelValid: true, demoOnlyEnabled: true };
  it("scores DPD 10 through the draft tree and DPD 11 through the later-band assumption", () => {
    const s10 = scoreCustomer({ ...common, dpd: 10 });
    expect(s10.probabilitySource).toBe("DRAFT_TREE_4_10");
    expect(s10.riskClass).toBe(1);
    const s11 = scoreCustomer({ ...common, dpd: 11 });
    expect(s11.probabilitySource).toBe("DRAFT_ROLL_RATE_11_30");
    expect(s11.probability).toBe("0.198");
    expect(s11.reasonCodes).toContain("BOUNDARY_11_30_DEMO_ASSUMPTION");
  });
  it("never invents an early model score for DPD 31", () => {
    const s31 = scoreCustomer({ ...common, dpd: 31 });
    expect(s31.status).toBe("UNSCORED");
    expect(s31.probability).toBeNull();
    expect(s31.reasonCodes).toContain("UNSUPPORTED_POPULATION_LATER_STAGE");
  });
  it("tags 1-3 DPD probabilities as DEMO_ONLY and unscores when the rule is disabled", () => {
    expect(scoreCustomer({ ...common, dpd: 2 }).probabilitySource).toBe("DEMO_ONLY_1_3_RULE");
    expect(scoreCustomer({ ...common, dpd: 2, demoOnlyEnabled: false }).reasonCodes).toContain("RULE_NOT_SUPPLIED_1_3");
  });
  it("unscores stale or missing features and an invalid model", () => {
    expect(scoreCustomer({ ...common, dpd: 6, featureAgeDays: 90 }).reasonCodes).toContain("STALE_FEATURES");
    expect(scoreCustomer({ ...common, dpd: 6, features: null }).reasonCodes).toContain("MISSING_FEATURE_SNAPSHOT");
    expect(scoreCustomer({ ...common, dpd: 6, modelValid: false }).reasonCodes).toContain("MODEL_NOT_VALID");
  });
  it("maps DPD to segments", () => {
    expect(segmentForDpd(0)).toBe("DPD_0");
    expect(segmentForDpd(3)).toBe("DPD_1_3");
    expect(segmentForDpd(4)).toBe("DPD_4_10");
    expect(segmentForDpd(16)).toBe("DPD_11_16");
    expect(segmentForDpd(17)).toBe("DPD_17_23");
    expect(segmentForDpd(24)).toBe("DPD_24_30");
    expect(segmentForDpd(45)).toBe("DPD_31_45");
    expect(segmentForDpd(46)).toBe("DPD_46_60");
  });
});

describe("ERA, buckets, treatment and ranking (acceptance cases 6, 7, 15)", () => {
  it("computes ERA and lets a 4-10 customer outrank a later-band customer", () => {
    expect(computeEra("0.42", "10000")?.toFixed(2)).toBe("4200.00");
    expect(computeEra("0.337", "1000")?.toFixed(2)).toBe("337.00");
    const ranked = rankCandidates([
      { customerId: "later", era: "337.00", oldestOverdueDueDate: "2026-10-03" },
      { customerId: "early", era: "4200.00", oldestOverdueDueDate: "2026-10-20" },
    ]);
    expect(ranked[0].customerId).toBe("early");
    expect(ranked[0].rank).toBe(1);
  });

  it("assigns deterministic decile buckets with ties in the same bucket", () => {
    const eras = Array.from({ length: 100 }, (_, i) => String((i + 1) * 10));
    const b = buildDecileBuckets(eras);
    expect(b.assign("10")).toBe(1);
    expect(b.assign("100")).toBe(1);
    expect(b.assign("110")).toBe(2);
    expect(b.assign("1000")).toBe(10);
    const tied = buildDecileBuckets(["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "6", "7"]);
    expect(tied.assign("5")).toBe(1);
    expect(tied.distinctValues).toBe(3);
    // Identical input produces identical cutoffs.
    expect(buildDecileBuckets(eras).cutoffs).toEqual(b.cutoffs);
  });

  it("computes exact break-even ERA values", () => {
    expect(breakEvenEra("0.031", "0.003").toFixed(4)).toBe("10.3333");
    expect(breakEvenEra("0.20", "0.01").toFixed(2)).toBe("20.00");
    expect(breakEvenEra("1.75", "0.05").toFixed(2)).toBe("35.00");
    expect(() => breakEvenEra("1", "0")).toThrow();
  });

  it("keeps model class and action bucket separate and applies Phase 1 fallbacks", () => {
    const t56 = decideTreatment({ segment: "DPD_4_10", scored: true, bucket: 5, selfCurePreference13: true });
    expect(t56.effectiveAction).toBe("SMS_FALLBACK_IVR_UNAVAILABLE");
    expect(t56.routineCallAllowed).toBe(false);
    const t10 = decideTreatment({ segment: "DPD_4_10", scored: true, bucket: 10, selfCurePreference13: true });
    expect(t10.requiredSkill).toBe("SENIOR");
    const t13 = decideTreatment({ segment: "DPD_1_3", scored: true, bucket: 9, selfCurePreference13: true });
    expect(t13.recommendedAction).toBe("AGENT_CALL_PRIORITY");
    expect(t13.effectiveAction).toBe("DIGITAL_SELF_CURE");
    const t31 = decideTreatment({ segment: "DPD_31_45", scored: false, bucket: null, selfCurePreference13: true });
    expect(t31.effectiveAction).toBe("LATER_STAGE_REVIEW");
    const un = decideTreatment({ segment: "DPD_4_10", scored: false, bucket: null, selfCurePreference13: true });
    expect(un.effectiveAction).toBe("MANUAL_REVIEW");
  });
});
