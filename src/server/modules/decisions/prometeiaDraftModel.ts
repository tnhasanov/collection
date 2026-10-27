import type { RulePackage } from "@/server/modules/decisions/ruleInterpreter";

/**
 * DRAFT transcription of the Prometeia 4-10 DPD roll-rate model (deck page 10 rule table).
 * Status DRAFT: not an approved executable model. Page 11's Class 7 leaf label conflicts with the
 * incoming split and the page 10 table; page 10 probabilities are used here, not a silent mix.
 * Activation requires provider confirmation or a signed executable rule artifact with golden cases.
 */
export const PROMETEIA_DRAFT_MODEL: RulePackage = {
  modelCode: "PROMETEIA_EARLY_ARREARS_ROLL_4_10",
  version: "DRAFT-2026-06-19-p10",
  provider: "Prometeia",
  status: "DRAFT",
  provenance: "ATB ERM Diagnostic Status Meeting deck (title page 19.06.2026, file name 18.06.2026), PDF page 10 rule table; page 11 tree used for structure only",
  targetEvent: "Deterioration to over 30 DPD within the following month (some slides say '30+'; exact threshold to confirm)",
  horizon: "1 month (monthly customer-level observation)",
  population: "Customers with decision DPD 4-10 and a complete latest monthly feature snapshot",
  unresolvedIssues: [
    "Exact definitions of ADJ/100, ratio denominators, zero balances and month windows are not in the deck",
    "Feature alias DPD_30_ADJ100_CNT_L6M versus DPD30_ADJ100_CNT_L6M requires an explicit mapping",
    "Page 11 Class 7 leaf label conflicts with its incoming count split and the page 10 table",
    "DPD 10 boundary: 4-10 model segment overlaps a [10,17) table; other pages say 11-30",
    "Target event wording '30+' versus 'over 30 DPD' and the monthly observation convention must be confirmed",
    "Exposure definition for ERA (performing loans, accrued interest, customer aggregation) must match the approved dictionary",
    "1-3 DPD probability mapping is absent; 31-45 DPD has no approved probability",
  ],
  features: [
    { name: "DPD_MAX_MAX12", description: "Maximum observed DPD within the last 12 months (exact definition per model dictionary)", type: "number", unit: "days" },
    { name: "DPD_RATIO_ADJ_MAX12", description: "Maximum adjusted delinquent exposure ratio observed within the last 12 months", type: "number", unit: "ratio" },
    { name: "DPD_RATIO_ADJ_V3LM", description: "Difference between the latest month delinquent exposure ratio and the maximum of the previous 3 months", type: "number", unit: "ratio delta" },
    { name: "DPD30_ADJ100_CNT_L6M", description: "Number of months with a 30+ DPD occurrence within the last 6 months", type: "number", unit: "count", aliases: ["DPD_30_ADJ100_CNT_L6M"] },
    { name: "DPD_RATIO_ADJ_VLM", description: "Latest month delinquent exposure ratio", type: "number", unit: "ratio" },
  ],
  leaves: [
    { riskClass: 1, probability: "0.08", label: "Class 1", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: "<=", value: 7 }, { feature: "DPD_RATIO_ADJ_MAX12", cmp: ">", value: 0.025 }] } },
    { riskClass: 2, probability: "0.11", label: "Class 2", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 7 }, { feature: "DPD_MAX_MAX12", cmp: "<=", value: 30 }, { feature: "DPD_RATIO_ADJ_MAX12", cmp: ">", value: 0.03 }] } },
    { riskClass: 3, probability: "0.14", label: "Class 3", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: "<=", value: 30 }, { feature: "DPD_RATIO_ADJ_MAX12", cmp: "<=", value: 0.025 }] } },
    { riskClass: 4, probability: "0.16", label: "Class 4", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 7 }, { feature: "DPD_MAX_MAX12", cmp: "<=", value: 30 }, { feature: "DPD_RATIO_ADJ_MAX12", cmp: ">", value: 0.025 }, { feature: "DPD_RATIO_ADJ_MAX12", cmp: "<=", value: 0.03 }] } },
    { riskClass: 5, probability: "0.22", label: "Class 5", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 30 }, { feature: "DPD_RATIO_ADJ_V3LM", cmp: ">", value: -0.4 }, { feature: "DPD30_ADJ100_CNT_L6M", cmp: "<=", value: 1 }, { feature: "DPD_RATIO_ADJ_VLM", cmp: "<=", value: 0.2 }] } },
    { riskClass: 6, probability: "0.28", label: "Class 6", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 30 }, { feature: "DPD_RATIO_ADJ_V3LM", cmp: ">", value: -0.4 }, { feature: "DPD30_ADJ100_CNT_L6M", cmp: "<=", value: 1 }, { feature: "DPD_RATIO_ADJ_VLM", cmp: ">", value: 0.2 }] } },
    { riskClass: 7, probability: "0.36", label: "Class 7", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 30 }, { feature: "DPD_RATIO_ADJ_V3LM", cmp: ">", value: -0.4 }, { feature: "DPD30_ADJ100_CNT_L6M", cmp: ">", value: 1 }] } },
    { riskClass: 8, probability: "0.42", label: "Class 8", rule: { all: [{ feature: "DPD_MAX_MAX12", cmp: ">", value: 30 }, { feature: "DPD_RATIO_ADJ_V3LM", cmp: "<=", value: -0.4 }] } },
  ],
};

/** Readable tree for the S13 screen (structure from page 11, probabilities from page 10). */
export const PROMETEIA_DRAFT_TREE = {
  node: "DPD_MAX_MAX12 ≤ 30",
  yes: {
    node: "DPD_RATIO_ADJ_MAX12 ≤ 0.025",
    yes: { leaf: 3 },
    no: {
      node: "DPD_MAX_MAX12 ≤ 7",
      yes: { leaf: 1 },
      no: { node: "DPD_RATIO_ADJ_MAX12 ≤ 0.03", yes: { leaf: 4 }, no: { leaf: 2 } },
    },
  },
  no: {
    node: "DPD_RATIO_ADJ_V3LM ≤ -0.4",
    yes: { leaf: 8 },
    no: {
      node: "DPD30_ADJ100_CNT_L6M ≤ 1",
      yes: { node: "DPD_RATIO_ADJ_VLM ≤ 0.2", yes: { leaf: 5 }, no: { leaf: 6 } },
      no: { leaf: 7, note: "Page 11 leaf label conflicts with the incoming split; page 10 probability 0.36 used" },
    },
  },
};

/** Draft empirical roll rates for the later early-arrears bands (deck 10+ DPD table). */
export const DRAFT_ROLL_RATES: Record<"DPD_11_16" | "DPD_17_23" | "DPD_24_30", string> = {
  DPD_11_16: "0.198",
  DPD_17_23: "0.269",
  DPD_24_30: "0.337",
};

/** Golden cases: one per leaf plus boundary checks; a candidate package must reproduce them before activation. */
export const GOLDEN_CASES: { name: string; features: Record<string, number | null>; expectedClass: number | null; expectedReason?: string }[] = (() => {
  const base: Record<string, number | null> = { DPD_MAX_MAX12: 5, DPD_RATIO_ADJ_MAX12: 0.05, DPD_RATIO_ADJ_V3LM: 0, DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: 0.1 };
  const cases: { name: string; features: Record<string, number | null>; expectedClass: number | null; expectedReason?: string }[] = [
    { name: "Class 1 (max DPD ≤ 7, ratio > 0.025)", features: { ...base, DPD_MAX_MAX12: 5, DPD_RATIO_ADJ_MAX12: 0.05 }, expectedClass: 1 },
    { name: "Class 2 (7 < max DPD ≤ 30, ratio > 0.03)", features: { ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.05 }, expectedClass: 2 },
    { name: "Class 3 (max DPD ≤ 30, ratio ≤ 0.025)", features: { ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.01 }, expectedClass: 3 },
    { name: "Class 4 (7 < max DPD ≤ 30, 0.025 < ratio ≤ 0.03)", features: { ...base, DPD_MAX_MAX12: 20, DPD_RATIO_ADJ_MAX12: 0.028 }, expectedClass: 4 },
    { name: "Class 5 (max DPD > 30, V3LM > -0.4, cnt ≤ 1, VLM ≤ 0.2)", features: { ...base, DPD_MAX_MAX12: 45, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.1 }, expectedClass: 5 },
    { name: "Class 6 (… VLM > 0.2)", features: { ...base, DPD_MAX_MAX12: 45, DPD30_ADJ100_CNT_L6M: 1, DPD_RATIO_ADJ_VLM: 0.3 }, expectedClass: 6 },
    { name: "Class 7 (max DPD > 30, V3LM > -0.4, cnt > 1)", features: { ...base, DPD_MAX_MAX12: 45, DPD30_ADJ100_CNT_L6M: 2 }, expectedClass: 7 },
    { name: "Class 8 (max DPD > 30, V3LM ≤ -0.4)", features: { ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: -0.5 }, expectedClass: 8 },
    { name: "Boundary: max DPD exactly 7 → class 1", features: { ...base, DPD_MAX_MAX12: 7, DPD_RATIO_ADJ_MAX12: 0.05 }, expectedClass: 1 },
    { name: "Boundary: max DPD exactly 30 with ratio 0.03 → class 4", features: { ...base, DPD_MAX_MAX12: 30, DPD_RATIO_ADJ_MAX12: 0.03 }, expectedClass: 4 },
    { name: "Boundary: V3LM exactly -0.4 → class 8", features: { ...base, DPD_MAX_MAX12: 31, DPD_RATIO_ADJ_V3LM: -0.4 }, expectedClass: 8 },
    { name: "Missing feature on the path → Unscored", features: { ...base, DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_V3LM: null }, expectedClass: null, expectedReason: "MISSING_PATH_INPUT" },
    { name: "Alias DPD_30_ADJ100_CNT_L6M accepted", features: { DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_MAX12: 0.05, DPD_RATIO_ADJ_V3LM: 0, DPD_30_ADJ100_CNT_L6M: 2, DPD_RATIO_ADJ_VLM: 0.1 }, expectedClass: 7 },
  ];
  return cases;
})();
