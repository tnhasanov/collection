import type { DecisionSegment, ProbabilitySource } from "@/generated/prisma/enums";
import { evaluateRulePackage, type FeatureValues, type RulePackage } from "@/server/modules/decisions/ruleInterpreter";
import { DRAFT_ROLL_RATES } from "@/server/modules/decisions/prometeiaDraftModel";
import { demoOnlyProbabilityForDpd1to3 } from "@/server/modules/decisions/DEMO_ONLY_dpd1to3_policy";

export function segmentForDpd(dpd: number): DecisionSegment {
  if (dpd <= 0) return "DPD_0";
  if (dpd <= 3) return "DPD_1_3";
  if (dpd <= 10) return "DPD_4_10";
  if (dpd <= 16) return "DPD_11_16";
  if (dpd <= 23) return "DPD_17_23";
  if (dpd <= 30) return "DPD_24_30";
  if (dpd <= 45) return "DPD_31_45";
  if (dpd <= 60) return "DPD_46_60";
  if (dpd <= 90) return "DPD_61_90";
  return "DPD_91_PLUS";
}

export const SEGMENT_LABELS: Record<DecisionSegment, string> = {
  DPD_0: "Current / pre-due",
  DPD_1_3: "1–3 DPD",
  DPD_4_10: "4–10 DPD",
  DPD_11_16: "11–16 DPD",
  DPD_17_23: "17–23 DPD",
  DPD_24_30: "24–30 DPD",
  DPD_31_45: "31–45 DPD",
  DPD_46_60: "46–60 DPD",
  DPD_61_90: "61–90 DPD",
  DPD_91_PLUS: "91+ DPD",
};

export interface ScoringInput {
  dpd: number;
  features: FeatureValues | null;
  featuresAsOf: string | null;
  featureAgeDays: number | null;
  featureMaxAgeDays: number;
  modelPackage: RulePackage;
  modelValid: boolean; // status APPROVED/ACTIVE/DRAFT-for-demo and within validity
  demoOnlyEnabled: boolean;
}

export interface ScoringResult {
  segment: DecisionSegment;
  status: "SCORED" | "UNSCORED";
  probability: string | null;
  probabilitySource: ProbabilitySource;
  riskClass: number | null;
  reasonCodes: string[];
  trace: unknown;
}

/**
 * Segment-aware probability assignment. Only supported populations receive probabilities.
 * DPD 0: no score. 1-3: DEMO_ONLY rule (tagged). 4-10: draft tree. 11-30: draft roll rates.
 * 31+: never receives an early-arrears score (separately governed queue).
 */
export function scoreCustomer(input: ScoringInput): ScoringResult {
  const segment = segmentForDpd(input.dpd);
  const base = { segment, trace: null as unknown };
  if (segment === "DPD_0") {
    return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: ["NOT_IN_ARREARS"] };
  }
  if (segment === "DPD_31_45" || segment === "DPD_46_60" || segment === "DPD_61_90" || segment === "DPD_91_PLUS") {
    return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: ["UNSUPPORTED_POPULATION_LATER_STAGE"] };
  }
  if (segment === "DPD_11_16" || segment === "DPD_17_23" || segment === "DPD_24_30") {
    return {
      ...base,
      status: "SCORED",
      probability: DRAFT_ROLL_RATES[segment],
      probabilitySource: "DRAFT_ROLL_RATE_11_30",
      riskClass: null,
      reasonCodes: ["DRAFT_BAND_ROLL_RATE", "BOUNDARY_11_30_DEMO_ASSUMPTION"],
    };
  }
  if (segment === "DPD_1_3") {
    if (!input.demoOnlyEnabled) {
      return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: ["RULE_NOT_SUPPLIED_1_3"] };
    }
    const maxDpdL3m = input.features?.MAX_DPD_L3M;
    const r = demoOnlyProbabilityForDpd1to3(typeof maxDpdL3m === "number" ? maxDpdL3m : null);
    if (!r) return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: ["RULE_NOT_SUPPLIED_1_3", "MISSING_MAX_DPD_L3M"] };
    return { ...base, status: "SCORED", probability: r.probability, probabilitySource: "DEMO_ONLY_1_3_RULE", riskClass: null, reasonCodes: ["DEMO_ONLY_PLACEHOLDER", r.band], trace: { band: r.band } };
  }
  // DPD_4_10: draft tree
  const reasons: string[] = [];
  if (!input.modelValid) reasons.push("MODEL_NOT_VALID");
  if (!input.features) reasons.push("MISSING_FEATURE_SNAPSHOT");
  if (input.featureAgeDays !== null && input.featureAgeDays > input.featureMaxAgeDays) reasons.push("STALE_FEATURES");
  if (reasons.length > 0) {
    return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: reasons };
  }
  const ev = evaluateRulePackage(input.modelPackage, input.features!);
  if (ev.status === "UNSCORED") {
    return { ...base, status: "UNSCORED", probability: null, probabilitySource: "NONE", riskClass: null, reasonCodes: [...ev.reasonCodes, ...ev.missingFeatures.map((m) => `MISSING:${m}`)], trace: ev.trace };
  }
  return { ...base, status: "SCORED", probability: ev.probability, probabilitySource: "DRAFT_TREE_4_10", riskClass: ev.riskClass, reasonCodes: ["DRAFT_MODEL"], trace: ev.trace };
}
