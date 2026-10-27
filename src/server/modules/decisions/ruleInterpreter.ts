/**
 * Safe typed rule interpreter for decision-tree style rule packages.
 * No imported code is ever evaluated: rules are data (comparisons combined with AND/OR).
 * Three-valued logic: a comparison on a missing/invalid feature is UNKNOWN; null is never zero.
 */
export type Comparator = "<=" | "<" | ">" | ">=" | "==" | "!=";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { feature: string; cmp: Comparator; value: number };

export interface RuleLeaf {
  riskClass: number;
  probability: string;
  label: string;
  rule: Condition;
}

export interface FeatureDefinition {
  name: string;
  description: string;
  type: "number";
  aliases?: string[];
  unit?: string;
  transformNote?: string;
}

export interface RulePackage {
  modelCode: string;
  version: string;
  provider: string;
  features: FeatureDefinition[];
  leaves: RuleLeaf[];
  provenance: string;
  status: "DRAFT" | "APPROVED";
  targetEvent: string;
  horizon: string;
  population: string;
  unresolvedIssues: string[];
}

export type FeatureValues = Record<string, number | null | undefined>;

type Tri = true | false | "UNKNOWN";

export interface EvaluationTrace {
  leafChecks: { riskClass: number; result: Tri; missing: string[] }[];
  path: string[];
}

export type Evaluation =
  | { status: "SCORED"; riskClass: number; probability: string; label: string; trace: EvaluationTrace; reasonCodes: string[] }
  | { status: "UNSCORED"; reasonCodes: string[]; trace: EvaluationTrace; missingFeatures: string[] };

export class RulePackageError extends Error {}

/** Resolve alias names to canonical names; unknown names stay as-is so validation can flag them. */
export function canonicalizeFeatures(pkg: RulePackage, raw: FeatureValues): { values: FeatureValues; unmapped: string[] } {
  const canonical: FeatureValues = {};
  const aliasMap = new Map<string, string>();
  for (const f of pkg.features) {
    aliasMap.set(f.name, f.name);
    for (const a of f.aliases ?? []) aliasMap.set(a, f.name);
  }
  const unmapped: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const name = aliasMap.get(k);
    if (!name) {
      unmapped.push(k);
      continue;
    }
    if (canonical[name] === undefined || canonical[name] === null) canonical[name] = v;
  }
  return { values: canonical, unmapped };
}

function evalCondition(cond: Condition, values: FeatureValues, missing: Set<string>, path: string[]): Tri {
  if ("all" in cond) {
    let unknown = false;
    for (const c of cond.all) {
      const r = evalCondition(c, values, missing, path);
      if (r === false) return false;
      if (r === "UNKNOWN") unknown = true;
    }
    return unknown ? "UNKNOWN" : true;
  }
  if ("any" in cond) {
    let unknown = false;
    for (const c of cond.any) {
      const r = evalCondition(c, values, missing, path);
      if (r === true) return true;
      if (r === "UNKNOWN") unknown = true;
    }
    return unknown ? "UNKNOWN" : false;
  }
  const v = values[cond.feature];
  if (v === null || v === undefined || typeof v !== "number" || !Number.isFinite(v)) {
    missing.add(cond.feature);
    return "UNKNOWN";
  }
  let r: boolean;
  switch (cond.cmp) {
    case "<=": r = v <= cond.value; break;
    case "<": r = v < cond.value; break;
    case ">": r = v > cond.value; break;
    case ">=": r = v >= cond.value; break;
    case "==": r = v === cond.value; break;
    case "!=": r = v !== cond.value; break;
  }
  path.push(`${cond.feature} ${cond.cmp} ${cond.value} → ${r ? "true" : "false"} (${v})`);
  return r;
}

export function evaluateRulePackage(pkg: RulePackage, rawValues: FeatureValues): Evaluation {
  const { values } = canonicalizeFeatures(pkg, rawValues);
  const trace: EvaluationTrace = { leafChecks: [], path: [] };
  const matched: RuleLeaf[] = [];
  const unknownLeaves: RuleLeaf[] = [];
  const allMissing = new Set<string>();
  for (const leaf of pkg.leaves) {
    const missing = new Set<string>();
    const path: string[] = [];
    const r = evalCondition(leaf.rule, values, missing, path);
    trace.leafChecks.push({ riskClass: leaf.riskClass, result: r, missing: [...missing] });
    if (r === true) {
      matched.push(leaf);
      trace.path = path;
    } else if (r === "UNKNOWN") {
      unknownLeaves.push(leaf);
      for (const m of missing) allMissing.add(m);
    }
  }
  if (matched.length === 1) {
    return { status: "SCORED", riskClass: matched[0].riskClass, probability: matched[0].probability, label: matched[0].label, trace, reasonCodes: [] };
  }
  if (matched.length > 1) {
    return { status: "UNSCORED", reasonCodes: ["AMBIGUOUS_RULES"], trace, missingFeatures: [] };
  }
  if (unknownLeaves.length > 0) {
    return { status: "UNSCORED", reasonCodes: ["MISSING_PATH_INPUT"], trace, missingFeatures: [...allMissing] };
  }
  return { status: "UNSCORED", reasonCodes: ["NO_MATCHING_LEAF"], trace, missingFeatures: [] };
}

/** Structural validation of an imported rule package (never executes code). */
export function validateRulePackage(pkg: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pkg || typeof pkg !== "object") return { ok: false, errors: ["Package must be an object"] };
  const p = pkg as Partial<RulePackage>;
  if (!p.modelCode || !p.version) errors.push("modelCode and version are required");
  if (!Array.isArray(p.features) || p.features.length === 0) errors.push("features must be a non-empty array");
  if (!Array.isArray(p.leaves) || p.leaves.length === 0) errors.push("leaves must be a non-empty array");
  const names = new Set((p.features ?? []).map((f) => f.name));
  const classes = new Set<number>();
  const check = (c: unknown, where: string) => {
    if (!c || typeof c !== "object") {
      errors.push(`${where}: condition must be an object`);
      return;
    }
    const cond = c as Record<string, unknown>;
    if (Array.isArray(cond.all)) cond.all.forEach((x, i) => check(x, `${where}.all[${i}]`));
    else if (Array.isArray(cond.any)) cond.any.forEach((x, i) => check(x, `${where}.any[${i}]`));
    else {
      if (typeof cond.feature !== "string" || !names.has(cond.feature)) errors.push(`${where}: unknown feature ${String(cond.feature)}`);
      if (!["<=", "<", ">", ">=", "==", "!="].includes(String(cond.cmp))) errors.push(`${where}: invalid comparator`);
      if (typeof cond.value !== "number" || !Number.isFinite(cond.value)) errors.push(`${where}: value must be a finite number`);
    }
  };
  for (const leaf of p.leaves ?? []) {
    if (classes.has(leaf.riskClass)) errors.push(`duplicate riskClass ${leaf.riskClass}`);
    classes.add(leaf.riskClass);
    const prob = Number(leaf.probability);
    if (!(prob > 0 && prob < 1)) errors.push(`class ${leaf.riskClass}: probability must be in (0,1)`);
    check(leaf.rule, `class ${leaf.riskClass}`);
  }
  return { ok: errors.length === 0, errors };
}
