import type { DecisionSegment, Seniority } from "@/generated/prisma/enums";

export type ActionCode =
  | "DIGITAL_SELF_CURE"
  | "SMS_REMINDER"
  | "SMS_FALLBACK_IVR_UNAVAILABLE"
  | "SELECTIVE_AGENT_CALL"
  | "AGENT_CALL"
  | "AGENT_CALL_PRIORITY"
  | "SENIOR_AGENT_CALL"
  | "MANUAL_REVIEW"
  | "LATER_STAGE_REVIEW"
  | "NO_ACTION_CURRENT";

export interface TreatmentDecision {
  recommendedAction: ActionCode;
  effectiveAction: ActionCode;
  requiredSkill: Seniority | null;
  routineCallAllowed: boolean;
  capacityGated: boolean;
  reasonCodes: string[];
}

export const ACTION_LABELS: Record<ActionCode, string> = {
  DIGITAL_SELF_CURE: "Self-cure monitoring / approved SMS",
  SMS_REMINDER: "Approved SMS reminder",
  SMS_FALLBACK_IVR_UNAVAILABLE: "SMS fallback (IVR unavailable)",
  SELECTIVE_AGENT_CALL: "Selective agent call (spare capacity)",
  AGENT_CALL: "Regular agent call",
  AGENT_CALL_PRIORITY: "Regular agent call (priority)",
  SENIOR_AGENT_CALL: "Senior agent call",
  MANUAL_REVIEW: "Manual review (unscored)",
  LATER_STAGE_REVIEW: "Later-stage review / handover",
  NO_ACTION_CURRENT: "No action (current)",
};

/** Source design per action bucket (deck) and Phase 1 effective behaviour (IVR/email unavailable). */
export function bucketTreatment(bucket: number): { recommended: ActionCode; effective: ActionCode; skill: Seniority | null; routine: boolean; capacityGated: boolean; reasons: string[] } {
  if (bucket <= 4) return { recommended: "SMS_REMINDER", effective: "SMS_REMINDER", skill: null, routine: false, capacityGated: false, reasons: ["BUCKET_1_4_NO_ROUTINE_CALL"] };
  if (bucket <= 6) return { recommended: "SMS_FALLBACK_IVR_UNAVAILABLE", effective: "SMS_FALLBACK_IVR_UNAVAILABLE", skill: null, routine: false, capacityGated: false, reasons: ["BUCKET_5_6_IVR_UNAVAILABLE_SMS_FALLBACK"] };
  if (bucket === 7) return { recommended: "SELECTIVE_AGENT_CALL", effective: "SELECTIVE_AGENT_CALL", skill: "REGULAR", routine: true, capacityGated: true, reasons: ["BUCKET_7_CAPACITY_GATED"] };
  if (bucket === 8) return { recommended: "AGENT_CALL", effective: "AGENT_CALL", skill: "REGULAR", routine: true, capacityGated: false, reasons: ["BUCKET_8_REGULAR_CALL"] };
  if (bucket === 9) return { recommended: "AGENT_CALL_PRIORITY", effective: "AGENT_CALL_PRIORITY", skill: "REGULAR", routine: true, capacityGated: false, reasons: ["BUCKET_9_REGULAR_PRIORITY"] };
  return { recommended: "SENIOR_AGENT_CALL", effective: "SENIOR_AGENT_CALL", skill: "SENIOR", routine: true, capacityGated: false, reasons: ["BUCKET_10_SENIOR"] };
}

export function decideTreatment(params: { segment: DecisionSegment; scored: boolean; bucket: number | null; selfCurePreference13: boolean }): TreatmentDecision {
  const { segment, scored, bucket } = params;
  if (segment === "DPD_0") {
    return { recommendedAction: "NO_ACTION_CURRENT", effectiveAction: "NO_ACTION_CURRENT", requiredSkill: null, routineCallAllowed: false, capacityGated: false, reasonCodes: ["NOT_IN_ARREARS"] };
  }
  if (segment === "DPD_31_45" || segment === "DPD_46_60" || segment === "DPD_61_90" || segment === "DPD_91_PLUS") {
    return { recommendedAction: "LATER_STAGE_REVIEW", effectiveAction: "LATER_STAGE_REVIEW", requiredSkill: "SENIOR", routineCallAllowed: false, capacityGated: false, reasonCodes: ["LATER_STAGE_SEPARATE_POLICY", "NO_EARLY_MODEL_SCORE"] };
  }
  if (!scored || bucket === null) {
    return { recommendedAction: "MANUAL_REVIEW", effectiveAction: "MANUAL_REVIEW", requiredSkill: null, routineCallAllowed: false, capacityGated: false, reasonCodes: ["UNSCORED_MANUAL_REVIEW"] };
  }
  const t = bucketTreatment(bucket);
  if (segment === "DPD_1_3" && params.selfCurePreference13) {
    return { recommendedAction: t.recommended, effectiveAction: "DIGITAL_SELF_CURE", requiredSkill: null, routineCallAllowed: false, capacityGated: false, reasonCodes: [...t.reasons, "SELF_CURE_PREFERENCE_1_3"] };
  }
  return { recommendedAction: t.recommended, effectiveAction: t.effective, requiredSkill: t.skill, routineCallAllowed: t.routine, capacityGated: t.capacityGated, reasonCodes: t.reasons };
}
