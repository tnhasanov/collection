"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Select, Textarea } from "@/components/ui";

interface Dataset { code: string; label: string; critical: boolean; keyColumns: string[]; rollback: string; columns: { name: string; required: boolean; type: string; description: string; synonyms: string[]; enum: string[] | null }[] }
type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEPS = ["Choose file / source", "Map columns", "Validate", "Dry run", "Commit", "Results"];

function parseHeader(csv: string): string[] {
  const line = csv.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch; }
  out.push(cur.trim());
  return out.filter((h) => h !== "");
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function ImportWizard({ datasets }: { datasets: Dataset[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [dataset, setDataset] = useState(datasets[0]?.code ?? "payments");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [validation, setValidation] = useState<Record<string, unknown> | null>(null);
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);
  const [commit, setCommit] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = datasets.find((d) => d.code === dataset)!;
  const headers = useMemo(() => parseHeader(csv), [csv]);
  const proposed = useMemo(() => Object.fromEntries(spec.columns.map((c) => [c.name, headers.find((h) => [c.name, ...c.synonyms].map(norm).includes(norm(h))) ?? null])), [spec, headers]);
  const effectiveMapping = { ...proposed, ...mapping };
  const batchId = validation?.batchId as string | undefined;
  const call = async (url: string, body?: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!j.ok) throw new Error(`${j.error?.message ?? "Request failed"}${Array.isArray(j.error?.details) ? ": " + j.error.details.join("; ") : ""}`);
    return j.data;
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const loadExample = async () => { const r = await fetch(`/api/imports/templates/${dataset}`); setCsv(await r.text()); setFileName(`example-${dataset}.csv`); };
  const reset = () => { setStep(1); setValidation(null); setDryRun(null); setCommit(null); setMapping({}); setError(null); };
  const ct = validation?.controlTotals as Record<string, unknown> | undefined;

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Wizard steps">{STEPS.map((s, i) => <li key={s} className={`rounded px-2 py-0.5 ${i + 1 === step ? "bg-brand text-white" : i + 1 < step ? "bg-brand-light" : "bg-canvas text-muted"}`} aria-current={i + 1 === step ? "step" : undefined}>{i + 1}. {s}</li>)}</ol>
      {error && <p className="field-error" role="alert">{error}</p>}

      {step === 1 && (
        <div className="space-y-2">
          <Field label="Dataset" htmlFor="iw-ds"><Select id="iw-ds" value={dataset} onChange={(e) => { setDataset(e.target.value); setMapping({}); }}>{datasets.map((d) => <option key={d.code} value={d.code}>{d.label}{d.critical ? " (critical financial)" : ""}</option>)}</Select></Field>
          <Field label="CSV file" htmlFor="iw-file"><input id="iw-file" type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); setCsv(await f.text()); }} /></Field>
          <Field label="…or paste CSV text" htmlFor="iw-csv"><Textarea id="iw-csv" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); if (!fileName) setFileName("pasted.csv"); }} className="font-mono text-xs" /></Field>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void loadExample()}>Load synthetic example</Button><Button size="sm" variant="primary" disabled={!csv.trim()} onClick={() => setStep(2)}>Next: map columns</Button></div>
          <p className="text-xs text-muted">Source: file upload or paste (demo). Connector pulls land in the same pipeline through the integration adapters (S21).</p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="text-sm">Detected columns: {headers.length ? headers.map((h) => <code key={h} className="mr-1 rounded bg-canvas px-1 text-xs">{h}</code>) : <span className="text-danger">none</span>}</p>
          <table className="table-dense"><thead><tr><th>Canonical column</th><th>Type</th><th>Source column</th><th>Description</th></tr></thead>
            <tbody>{spec.columns.map((c) => <tr key={c.name}><td className="font-mono text-xs">{c.name}{c.required && <span className="text-danger">*</span>}</td><td className="text-xs">{c.type}{c.enum ? ` (${c.enum.join("/")})` : ""}</td><td><Select aria-label={`Source column for ${c.name}`} value={effectiveMapping[c.name] ?? ""} onChange={(e) => setMapping({ ...mapping, [c.name]: e.target.value || null })}><option value="">— not mapped —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</Select></td><td className="text-xs text-muted">{c.description}</td></tr>)}</tbody></table>
          <div className="flex gap-2"><Button size="sm" onClick={() => setStep(1)}>Back</Button><Button size="sm" variant="primary" disabled={busy || spec.columns.some((c) => c.required && !effectiveMapping[c.name])} onClick={() => run(async () => { const d = await call("/api/imports/validate", { dataset, fileName: fileName || "upload.csv", csv, mapping: effectiveMapping }); setValidation(d); setStep(3); })}>{busy ? "Validating…" : "Validate"}</Button></div>
        </div>
      )}

      {step === 3 && validation && ct && (
        <div className="space-y-2 text-sm">
          <p>Batch <strong>{batchId}</strong> created with status VALIDATED. {spec.critical && <Badge tone="warning">critical dataset: quarantined rows never enter the projection</Badge>}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
            {[["Rows", ct.rows], ["Accepted", ct.accepted], ["Rejected (quarantined)", ct.rejected], ["Duplicates in file", ct.duplicatesInFile], ["Duplicates vs store", ct.duplicatesInStore], ["Missing references", ct.missingReferences], ["Invalid dates", ct.invalidDates], ["Invalid amounts", ct.invalidAmounts], ["Schema mismatch", ct.schemaMismatch]].map(([k, v]) => <div key={String(k)} className="rounded bg-canvas p-2"><div className="text-lg font-bold">{String(v)}</div><div className="text-xs text-muted">{String(k)}</div></div>)}
          </div>
          <p>Amount totals: accepted {ct.acceptedAmountByCurrency ? Object.entries(ct.acceptedAmountByCurrency as Record<string, string>).map(([c, v]) => `${c} ${v}`).join(", ") : "n/a"}; rejected {ct.rejectedAmountByCurrency ? Object.entries(ct.rejectedAmountByCurrency as Record<string, string>).map(([c, v]) => `${c} ${v}`).join(", ") : "n/a"}. Source as-of: {ct.sourceAsOf ? String(ct.sourceAsOf) : "n/a"}.</p>
          {(validation.rejected as { rowNumber: number; code: string; message: string }[]).length > 0 && <details open><summary className="cursor-pointer">Rejected rows</summary><ul className="text-xs">{(validation.rejected as { rowNumber: number; code: string; message: string }[]).map((r) => <li key={r.rowNumber} className="text-danger">row {r.rowNumber} · {r.code}: {r.message}</li>)}</ul></details>}
          {(validation.warnings as { rowNumber: number; code: string; message: string }[]).length > 0 && <details><summary className="cursor-pointer">Warnings</summary><ul className="text-xs">{(validation.warnings as { rowNumber: number; code: string; message: string }[]).map((r, i) => <li key={i}>row {r.rowNumber} · {r.code}: {r.message}</li>)}</ul></details>}
          <div className="flex gap-2"><Button size="sm" variant="primary" disabled={busy} onClick={() => run(async () => { setDryRun(await call(`/api/imports/${batchId}/dry-run`)); setStep(4); })}>{busy ? "Running…" : "Dry run"}</Button><a className="btn btn-secondary btn-sm" href={`/api/imports/${batchId}/issues`}>Download error file</a><Button size="sm" variant="ghost" onClick={reset}>Start over</Button></div>
        </div>
      )}

      {step === 4 && dryRun && (
        <div className="space-y-2 text-sm">
          <p>Dry run of batch <strong>{batchId}</strong> (nothing committed):</p>
          <pre className="max-h-72 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(dryRun, null, 1)}</pre>
          <div className="flex gap-2"><Button size="sm" variant="primary" disabled={busy || Number(ct?.accepted ?? 0) === 0} onClick={() => run(async () => { setCommit(await call(`/api/imports/${batchId}/commit`)); setStep(6); })}>{busy ? "Committing…" : "Commit accepted rows"}</Button><Button size="sm" variant="ghost" onClick={reset}>Abandon (batch stays VALIDATED/DRY_RUN)</Button></div>
        </div>
      )}

      {step === 6 && commit && (
        <div className="space-y-2 text-sm">
          <p><Badge tone="success">committed</Badge> created {String(commit.created)} · updated {String(commit.updated)} · skipped duplicates {String(commit.skipped)} · quarantined {String(commit.quarantined)}</p>
          {Array.isArray(commit.events) && (commit.events as { txn: string; status: string }[]).length > 0 && <ul className="text-xs">{(commit.events as { txn: string; status: string }[]).map((e) => <li key={e.txn}>{e.txn}: {e.status}</li>)}</ul>}
          <div className="flex gap-2"><Button size="sm" onClick={() => { router.push(`/data/imports?batch=${batchId}`); router.refresh(); }}>Open batch</Button><Button size="sm" variant="ghost" onClick={reset}>New import</Button></div>
        </div>
      )}
    </div>
  );
}
