"use client";
import { useState } from "react";
import { Badge, Button, Field, Input } from "@/components/ui";
import { fmtAzn, humanize } from "@/lib/format";

const DEFAULTS: Record<string, string> = { DPD_MAX_MAX12: "45", DPD_RATIO_ADJ_MAX12: "0.05", DPD_RATIO_ADJ_V3LM: "-0.5", DPD30_ADJ100_CNT_L6M: "0", DPD_RATIO_ADJ_VLM: "0.1" };

export function TestScorePanel({ modelVersionId, featureNames }: { modelVersionId: string; featureNames: string[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(featureNames.map((f) => [f, DEFAULTS[f] ?? ""])));
  const [dpd, setDpd] = useState("6");
  const [exposure, setExposure] = useState("10000.00");
  const [asOf, setAsOf] = useState("2026-09-30");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const features = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));
      const r = await fetch("/api/models/test-score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features, dpd: Number(dpd), exposure, featuresAsOf: asOf || null, modelVersionId }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Request failed");
      setResult(j.data);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {featureNames.map((f) => (
          <Field key={f} label={f} htmlFor={`ts-${f}`} hint="blank = missing"><Input id={`ts-${f}`} inputMode="decimal" value={values[f] ?? ""} onChange={(e) => setValues({ ...values, [f]: e.target.value })} /></Field>
        ))}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Decision DPD" htmlFor="ts-dpd"><Input id="ts-dpd" inputMode="numeric" value={dpd} onChange={(e) => setDpd(e.target.value)} /></Field>
          <Field label="Exposure (AZN)" htmlFor="ts-exp"><Input id="ts-exp" inputMode="decimal" value={exposure} onChange={(e) => setExposure(e.target.value)} /></Field>
          <Field label="Features as of" htmlFor="ts-asof"><Input id="ts-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Scoring…" : "Score test case"}</Button>
        {error && <p className="field-error">{error}</p>}
      </form>
      <div className="text-sm">
        {result ? (
          <div className="space-y-2">
            <p>{String(result.segmentLabel)} · {result.status === "SCORED" ? <Badge tone="success">scored</Badge> : <Badge tone="danger">unscored</Badge>} {result.riskClass ? `· Class ${String(result.riskClass)}` : ""} · p={result.probability ? String(result.probability) : "—"} ({humanize(String(result.probabilitySource))})</p>
            <p>ERA {result.era ? fmtAzn(String(result.era)) : "—"} · bucket {result.bucket ? String(result.bucket) : "—"} <span className="text-xs text-muted">({String(result.bucketBasis)})</span></p>
            <p>Action: <strong>{String(result.actionLabel)}</strong>{result.requiredSkill ? ` · skill ${String(result.requiredSkill).toLowerCase()}` : ""}</p>
            <p className="text-xs text-muted">Reason codes: {(result.reasonCodes as string[]).join(", ") || "—"}{(result.unmappedFeatures as string[]).length ? ` · unmapped inputs: ${(result.unmappedFeatures as string[]).join(", ")}` : ""} · feature age {result.featureAgeDays === null ? "unknown" : `${String(result.featureAgeDays)}d (max ${String(result.featureMaxAgeDays)}d)`}</p>
            <div>
              <p className="font-medium">Decision path</p>
              {(result.decisionPath as string[]).length ? <ol className="list-decimal pl-5 font-mono text-xs">{(result.decisionPath as string[]).map((p, i) => <li key={i}>{p}</li>)}</ol> : <p className="text-xs text-muted">No single matching leaf (see leaf checks).</p>}
            </div>
            <details><summary className="cursor-pointer text-xs">Leaf checks</summary><ul className="text-xs">{(result.leafChecks as { riskClass: number; result: boolean | string; missing: string[] }[]).map((l) => <li key={l.riskClass}>Class {l.riskClass}: {String(l.result)}{l.missing.length ? ` (missing ${l.missing.join(", ")})` : ""}</li>)}</ul></details>
            <p className="text-xs text-muted">{String(result.note)}</p>
          </div>
        ) : <p className="text-muted">Enter features and score. Clear a field to see how a missing input yields Unscored instead of a low probability.</p>}
      </div>
    </div>
  );
}
