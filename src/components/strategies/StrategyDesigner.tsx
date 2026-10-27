"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Card, Dialog, Field, Input, Select, Textarea, Toast, type Tone } from "@/components/ui";
import { fmtAzn, fmtDateTime, humanize } from "@/lib/format";

type Status = "DRAFT" | "TESTED" | "APPROVED" | "ACTIVE" | "RETIRED" | "REJECTED";
interface TreatmentRow { recommended: string; effective: string; effectiveAction?: string; assignment?: string; reason?: string }
interface Config {
  population: { portfolio: string; dpdBands: string[]; laterStage: string };
  probability: Record<string, string>;
  exposure: { definition: string; currency: string };
  actionBucket: { method: string; tieHandling: string };
  treatment: Record<string, TreatmentRow>;
  channels: { sms: boolean; call: boolean; ivr: boolean; email: boolean };
  contactPolicyVersion: string;
  capacity: { seniorAgents: number; regularAgents: number; successfulContactsPerAgentDay: number };
  fallback: { unscored: string; laterStage: string; ivrUnavailable: string };
  dispatch: Record<string, unknown>;
}
interface Issue { severity: "ERROR" | "WARNING"; code: string; message: string }
interface Simulation {
  simulatedAt: string; businessDate: string | null; population: number; scored: number; unscored: number; bySegment: Record<string, number>;
  byTreatment: { action: string; label: string; candidate: number; active: number; delta: number; exposure: string }[];
  changedCustomers: { customerId: string; bucket: number | null; from: string; to: string; era: string | null }[];
  blockedContacts: { total: number; byReason: Record<string, number> };
  workload: { callItems: number; seniorItems: number; regularItems: number; smsItems: number; capacityCallsPerDay: number; seniorCapacityPerDay: number; regularCapacityPerDay: number; coverageDays: string; seniorOverflow: number; regularOverflow: number };
  channelCosts: { sms: string; agentCustomerDays: string; total: string; activeTotal: string };
  scoreChanges: { note: string; count: number }; note: string;
}
export interface VersionItem { id: string; code: string; version: string; status: Status; config: unknown; createdBy: string; approvedBy: string | null; activatedAt: string | null; retiredAt: string | null; notes: string | null; simulation: unknown; simulatedAt: string | null; createdAt: string; validation: { ok: boolean; issues: Issue[] }; openApproval: { id: string; status: string } | null }

const STATUS_TONE: Record<Status, Tone> = { DRAFT: "neutral", TESTED: "info", APPROVED: "brand", ACTIVE: "success", RETIRED: "neutral", REJECTED: "danger" };
const ACTIONS = ["DIGITAL_SELF_CURE", "SMS_REMINDER", "SMS_FALLBACK_IVR_UNAVAILABLE", "SELECTIVE_AGENT_CALL", "AGENT_CALL", "AGENT_CALL_PRIORITY", "SENIOR_AGENT_CALL", "MANUAL_REVIEW"];
const SECTIONS = ["Eligibility", "Probability", "Exposure / ERA", "Action bucket", "Treatment", "Contact controls", "Capacity", "Dispatch"];

export function StrategyDesigner({ versions, selectedId, canDraft, canSubmit }: { versions: VersionItem[]; selectedId: string | null; canDraft: boolean; canSubmit: boolean }) {
  const router = useRouter();
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const [config, setConfig] = useState<Config | null>(selected ? (selected.config as Config) : null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>(selected?.validation.issues ?? []);
  const [sim, setSim] = useState<Simulation | null>(selected ? (selected.simulation as Simulation | null) : null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneVersion, setCloneVersion] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [customerId, setCustomerId] = useState("C-DEMO-001");
  const [explain, setExplain] = useState<Record<string, unknown> | null>(null);
  const editable = !!selected && canDraft && (selected.status === "DRAFT" || selected.status === "TESTED");
  const api = async (url: string, body?: unknown, method = "POST") => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message ?? "Request failed");
    return j.data;
  };
  const update = (fn: (c: Config) => Config) => { if (!config) return; setConfig(fn(structuredClone(config))); setDirty(true); };
  const rows = useMemo(() => (config ? Object.entries(config.treatment).sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0])) : []), [config]);
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } };

  return (
    <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
      <Toast message={msg} tone="success" />
      {/* Left: versions */}
      <Card title="Versions" subtitle="Draft → Tested → Approved → Active → Retired" actions={canDraft && selected ? <Button size="sm" onClick={() => { setCloneVersion(`${new Date().toISOString().slice(0, 7)}-draft-${versions.length + 1}`); setCloneOpen(true); }}>New draft</Button> : null}>
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id}>
              <a href={`/strategies?v=${v.id}`} className={`block rounded border px-2 py-1.5 text-sm hover:bg-canvas ${v.id === selectedId ? "border-brand bg-brand-light" : "border-line"}`} aria-current={v.id === selectedId ? "page" : undefined}>
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{v.version}</span><Badge tone={STATUS_TONE[v.status]}>{v.status.toLowerCase()}</Badge></div>
                <div className="text-xs text-muted">{v.code} · {v.activatedAt ? `active since ${fmtDateTime(v.activatedAt)}` : `created ${fmtDateTime(v.createdAt)}`}</div>
                {!v.validation.ok && <div className="text-xs text-danger">validation errors</div>}
                {v.openApproval && <div className="text-xs text-info">approval {v.openApproval.status.toLowerCase().replace("_", " ")}</div>}
              </a>
            </li>
          ))}
        </ul>
      </Card>

      {/* Center: decision tables */}
      <div className="space-y-3">
        {selected && config ? (
          <>
            <Card title={`${selected.code} · ${selected.version}`} subtitle={selected.notes ?? undefined} actions={
              <div className="flex flex-wrap gap-2">
                {editable && <Button variant="primary" size="sm" disabled={!dirty || !!busy} onClick={() => run("save", async () => { const d = await api(`/api/strategies/${selected.id}`, { config }, "PUT"); setIssues(d.validation.issues); setDirty(false); setMsg(d.validation.ok ? "Draft saved and validated" : "Draft saved with validation errors"); router.refresh(); })}>Save draft</Button>}
                {(selected.status === "DRAFT" || selected.status === "TESTED" || selected.status === "ACTIVE") && <Button size="sm" disabled={dirty || !!busy || !selected.validation.ok} title={dirty ? "Save first" : undefined} onClick={() => run("sim", async () => { const d = await api(`/api/strategies/${selected.id}/simulate`); setSim(d.result); setMsg(`Dry simulation finished (${d.status.toLowerCase()})`); router.refresh(); })}>{busy === "sim" ? "Simulating…" : "Run dry simulation"}</Button>}
                {canSubmit && selected.status === "TESTED" && !selected.openApproval && <Button size="sm" variant="primary" disabled={!!busy || dirty} onClick={() => setSubmitOpen(true)}>Submit for approval (S11)</Button>}
              </div>
            }>
              <div className="flex flex-wrap gap-1 text-xs">{SECTIONS.map((s, i) => <span key={s} className="rounded bg-canvas px-2 py-0.5">{i + 1}. {s}</span>)}</div>
              {issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {issues.map((i, idx) => <li key={idx} className={i.severity === "ERROR" ? "text-danger" : "text-warning"}><strong>{i.severity}</strong> {i.code}: {i.message}</li>)}
                </ul>
              )}
              {error && <p className="field-error mt-2">{error}</p>}
            </Card>

            <Card title="1–4 · Eligibility, probability, exposure and action bucket">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Population portfolio" htmlFor="st-portfolio"><Input id="st-portfolio" value={config.population.portfolio} disabled={!editable} onChange={(e) => update((c) => ({ ...c, population: { ...c.population, portfolio: e.target.value } }))} /></Field>
                <Field label="DPD bands (comma separated, DPD_a_b)" htmlFor="st-bands"><Input id="st-bands" value={config.population.dpdBands.join(", ")} disabled={!editable} onChange={(e) => update((c) => ({ ...c, population: { ...c.population, dpdBands: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } }))} /></Field>
                {Object.entries(config.probability).map(([band, src]) => (
                  <Field key={band} label={`Probability source · ${band.replace(/_/g, " ")}`} htmlFor={`st-p-${band}`}>
                    <Select id={`st-p-${band}`} value={src} disabled={!editable} onChange={(e) => update((c) => ({ ...c, probability: { ...c.probability, [band]: e.target.value } }))}>
                      {["DEMO_ONLY_1_3_RULE", "DRAFT_TREE_4_10", "DRAFT_ROLL_RATE_11_30", "NONE"].map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </Field>
                ))}
                <Field label="Exposure definition" htmlFor="st-exp"><Input id="st-exp" value={config.exposure.definition} disabled={!editable} onChange={(e) => update((c) => ({ ...c, exposure: { ...c.exposure, definition: e.target.value } }))} /></Field>
                <Field label="Action bucket method / tie handling" htmlFor="st-bucket"><Input id="st-bucket" value={`${config.actionBucket.method} · ${config.actionBucket.tieHandling}`} disabled readOnly /></Field>
              </div>
            </Card>

            <Card title="5 · Treatment decision table" subtitle="Effective action per action bucket (1 = lowest ERA decile, 10 = highest). Unscored → manual review; 31+ DPD → later-stage review; 1–3 DPD self-cure preference applies on top.">
              <table className="table-dense">
                <thead><tr><th>Buckets</th><th>Recommended (source design)</th><th>Effective action (Phase 1)</th><th>Assignment</th><th>Reason</th>{editable && <th></th>}</tr></thead>
                <tbody>
                  {rows.map(([key, row]) => (
                    <tr key={key}>
                      <td className="font-medium">{key}</td>
                      <td><Input aria-label={`Recommended action buckets ${key}`} value={row.recommended} disabled={!editable} onChange={(e) => update((c) => ({ ...c, treatment: { ...c.treatment, [key]: { ...c.treatment[key], recommended: e.target.value } } }))} /></td>
                      <td>
                        <Select aria-label={`Effective action buckets ${key}`} value={row.effectiveAction ?? ""} disabled={!editable} onChange={(e) => update((c) => ({ ...c, treatment: { ...c.treatment, [key]: { ...c.treatment[key], effectiveAction: e.target.value || undefined, effective: e.target.value ? humanize(e.target.value) : c.treatment[key].effective } } }))}>
                          <option value="">{row.effective} (text)</option>
                          {ACTIONS.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
                        </Select>
                      </td>
                      <td><Input aria-label={`Assignment buckets ${key}`} value={row.assignment ?? ""} disabled={!editable} onChange={(e) => update((c) => ({ ...c, treatment: { ...c.treatment, [key]: { ...c.treatment[key], assignment: e.target.value } } }))} /></td>
                      <td className="text-xs text-muted">{row.reason ?? "—"}</td>
                      {editable && <td><Button size="sm" variant="ghost" onClick={() => update((c) => { const t = { ...c.treatment }; delete t[key]; return { ...c, treatment: t }; })} aria-label={`Remove row ${key}`}>Remove</Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && <div className="mt-2 flex items-end gap-2"><Field label="Add bucket range (e.g. 7 or 8-9)" htmlFor="st-newrange"><Input id="st-newrange" placeholder="7" onKeyDown={(e) => { if (e.key === "Enter") { const k = (e.target as HTMLInputElement).value.trim(); if (/^(10|[1-9])(-(10|[1-9]))?$/.test(k)) update((c) => ({ ...c, treatment: { ...c.treatment, [k]: { recommended: "", effective: "Regular agent call", effectiveAction: "AGENT_CALL", assignment: "" } } })); } }} /></Field><span className="pb-2 text-xs text-muted">Press Enter to add</span></div>}
            </Card>

            <Card title="6–8 · Contact controls, capacity and dispatch">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-sm font-medium">Channels</p>
                  {(["sms", "call", "ivr", "email"] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.channels[ch]} disabled={!editable} onChange={(e) => update((c) => ({ ...c, channels: { ...c.channels, [ch]: e.target.checked } }))} />{ch.toUpperCase()}{(ch === "ivr" || ch === "email") && <span className="text-xs text-muted">(no Phase 1 connector)</span>}</label>
                  ))}
                  <p className="mt-2 text-xs text-muted">Contact policy version: <strong>{config.contactPolicyVersion}</strong> (cooldown, PTP protection, permitted hours, caps, retry rules; enforced server-side).</p>
                </div>
                <div className="space-y-2">
                  <Field label="Senior agents" htmlFor="st-sen"><Input id="st-sen" type="number" min={0} value={config.capacity.seniorAgents} disabled={!editable} onChange={(e) => update((c) => ({ ...c, capacity: { ...c.capacity, seniorAgents: Number(e.target.value) } }))} /></Field>
                  <Field label="Regular agents" htmlFor="st-reg"><Input id="st-reg" type="number" min={0} value={config.capacity.regularAgents} disabled={!editable} onChange={(e) => update((c) => ({ ...c, capacity: { ...c.capacity, regularAgents: Number(e.target.value) } }))} /></Field>
                  <Field label="Successful contacts per agent-day (planning)" htmlFor="st-spd"><Input id="st-spd" type="number" min={1} value={config.capacity.successfulContactsPerAgentDay} disabled={!editable} onChange={(e) => update((c) => ({ ...c, capacity: { ...c.capacity, successfulContactsPerAgentDay: Number(e.target.value) } }))} /></Field>
                </div>
                <div className="space-y-2">
                  <Field label="Unscored fallback" htmlFor="st-fu"><Input id="st-fu" value={config.fallback.unscored} disabled={!editable} onChange={(e) => update((c) => ({ ...c, fallback: { ...c.fallback, unscored: e.target.value } }))} /></Field>
                  <Field label="Later-stage route" htmlFor="st-fl"><Input id="st-fl" value={config.fallback.laterStage} disabled={!editable} onChange={(e) => update((c) => ({ ...c, fallback: { ...c.fallback, laterStage: e.target.value } }))} /></Field>
                  <Field label="IVR unavailable" htmlFor="st-fi"><Input id="st-fi" value={config.fallback.ivrUnavailable} disabled={!editable} onChange={(e) => update((c) => ({ ...c, fallback: { ...c.fallback, ivrUnavailable: e.target.value } }))} /></Field>
                  <p className="text-xs text-muted">Dispatch: {String(config.dispatch.mode)} · one reservation per customer · one voice interaction per agent (not editable).</p>
                </div>
              </div>
            </Card>
          </>
        ) : <Card><p className="text-sm text-muted">No strategy version selected.</p></Card>}
      </div>

      {/* Right: simulation + explanation */}
      <div className="space-y-3">
        <Card title="Dry simulation" subtitle={sim ? `As of ${fmtDateTime(sim.simulatedAt)} · snapshot ${sim.businessDate ?? "n/a"}` : "Not simulated yet"}>
          {sim ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{sim.population}</div><div className="text-xs text-muted">customers</div></div>
                <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{sim.unscored}</div><div className="text-xs text-muted">unscored</div></div>
                <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{sim.blockedContacts.total}</div><div className="text-xs text-muted">blocked today</div></div>
              </div>
              <table className="table-dense"><thead><tr><th>Treatment</th><th className="text-right">Candidate</th><th className="text-right">Active</th><th className="text-right">Δ</th></tr></thead>
                <tbody>{sim.byTreatment.map((t) => <tr key={t.action}><td>{t.label}</td><td className="text-right">{t.candidate}</td><td className="text-right">{t.active}</td><td className={`text-right ${t.delta > 0 ? "text-success" : t.delta < 0 ? "text-danger" : ""}`}>{t.delta > 0 ? "+" : ""}{t.delta}</td></tr>)}</tbody></table>
              <p><strong>Workload:</strong> {sim.workload.callItems} call items ({sim.workload.seniorItems} senior / {sim.workload.regularItems} regular) vs capacity {sim.workload.capacityCallsPerDay}/day → {sim.workload.coverageDays} days; overflow senior {sim.workload.seniorOverflow}, regular {sim.workload.regularOverflow}. {sim.workload.smsItems} SMS items.</p>
              <p><strong>Channel cost (assumed units):</strong> SMS {fmtAzn(sim.channelCosts.sms)} + agent customer-days {fmtAzn(sim.channelCosts.agentCustomerDays)} = {fmtAzn(sim.channelCosts.total)} (active policy {fmtAzn(sim.channelCosts.activeTotal)}).</p>
              {Object.keys(sim.blockedContacts.byReason).length > 0 && <p><strong>Blocked reasons:</strong> {Object.entries(sim.blockedContacts.byReason).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ")}</p>}
              <p className="text-xs text-muted">{sim.scoreChanges.note}</p>
              {sim.changedCustomers.length > 0 && <details><summary className="cursor-pointer">Changed customers ({sim.changedCustomers.length})</summary><ul className="mt-1 max-h-48 overflow-auto text-xs">{sim.changedCustomers.map((c) => <li key={c.customerId}><a className="link" href={`/customers/${c.customerId}`}>{c.customerId}</a> b{c.bucket}: {humanize(c.from)} → {humanize(c.to)}</li>)}</ul></details>}
              <p className="text-xs text-muted">{sim.note}</p>
            </div>
          ) : <p className="text-sm text-muted">Run a dry simulation to see counts by treatment, unscored cases, blocked contacts, workload, channel costs and distribution differences versus the active policy.</p>}
        </Card>
        <Card title="Customer-level explanation" subtitle="How this version decides for one customer">
          <div className="flex items-end gap-2">
            <Field label="Customer id" htmlFor="st-cust"><Input id="st-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} /></Field>
            <Button size="sm" disabled={!selected || !!busy} onClick={() => run("explain", async () => { setExplain(await api(`/api/strategies/explain?customerId=${encodeURIComponent(customerId)}&strategyId=${selected!.id}`, undefined, "GET")); })}>Explain</Button>
          </div>
          {explain && <ExplainView data={explain} />}
        </Card>
      </div>

      <Dialog open={cloneOpen} onClose={() => setCloneOpen(false)} title="Create a new draft version">
        <Field label="Version label" htmlFor="st-clone" hint="Letters, digits, dots, dashes"><Input id="st-clone" value={cloneVersion} onChange={(e) => setCloneVersion(e.target.value)} /></Field>
        <div className="mt-3 flex gap-2"><Button variant="primary" onClick={() => run("clone", async () => { const d = await api("/api/strategies", { fromId: selected!.id, version: cloneVersion }); setCloneOpen(false); router.push(`/strategies?v=${d.id}`); })}>Create</Button><Button onClick={() => setCloneOpen(false)}>Cancel</Button></div>
        {error && <p className="field-error mt-2">{error}</p>}
      </Dialog>
      <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} title="Submit for independent approval">
        <Callout tone="info">The approver must be a different user (no self-approval). The dry simulation is attached as the impact statement.</Callout>
        <Field label="Rationale" htmlFor="st-rat" required><Textarea id="st-rat" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
        <div className="mt-3 flex gap-2"><Button variant="primary" disabled={rationale.trim().length < 5} onClick={() => run("submit", async () => { const d = await api(`/api/strategies/${selected!.id}/submit`, { rationale }); setSubmitOpen(false); setMsg(`Approval request ${d.approvalId} created`); router.refresh(); })}>Submit</Button><Button onClick={() => setSubmitOpen(false)}>Cancel</Button></div>
        {error && <p className="field-error mt-2">{error}</p>}
      </Dialog>
    </div>
  );
}

function ExplainView({ data }: { data: Record<string, unknown> }) {
  const s = data.snapshot as Record<string, unknown> | null;
  const c = data.candidate as { action: string; label: string; rangeKey: string | null };
  const e = data.eligibility as { eligible: boolean; reasons: string[]; nextAllowedAt: string | null; checks: { code: string; label: string; passed: boolean; detail: string | null }[] } | null;
  const cust = data.customer as { id: string; displayName: string };
  return (
    <div className="mt-2 space-y-1 text-sm">
      <p><a className="link" href={`/customers/${cust.id}`}>{cust.displayName}</a> ({cust.id})</p>
      {s ? (
        <>
          <p>{String(s.segmentLabel)} · DPD {String(s.dpd)} · p={s.probability ? String(s.probability) : "Unscored"} ({humanize(String(s.probabilitySource))}){s.riskClass ? ` · class ${String(s.riskClass)}` : ""}</p>
          <p>Exposure {fmtAzn(String(s.exposure))} → ERA {s.era ? fmtAzn(String(s.era)) : "—"} · bucket {s.bucket ? String(s.bucket) : "—"} · rank {s.rank ? String(s.rank) : "—"}</p>
          <p>Active: <strong>{String(s.activeLabel)}</strong> → this version: <strong>{c.label}</strong> {c.rangeKey ? `(row ${c.rangeKey})` : ""} {data.changed ? <Badge tone="warning">changes</Badge> : <Badge tone="neutral">same</Badge>}</p>
          <p className="text-xs text-muted">Reason codes: {(s.reasonCodes as string[]).join(", ")}</p>
        </>
      ) : <p className="text-muted">No current decision snapshot (customer not in an open case).</p>}
      {e && (
        <details open={!e.eligible}>
          <summary className="cursor-pointer">Contact eligibility now: {e.eligible ? <Badge tone="success">eligible</Badge> : <Badge tone="danger">blocked</Badge>} {e.nextAllowedAt ? `· next ${fmtDateTime(e.nextAllowedAt)}` : ""}</summary>
          <ul className="mt-1 text-xs">{e.checks.map((ch) => <li key={ch.code} className={ch.passed ? "" : "text-danger"}>{ch.passed ? "✓" : "✗"} {ch.label}{ch.detail ? ` — ${ch.detail}` : ""}</li>)}</ul>
        </details>
      )}
      <p className="text-xs text-muted">{String(data.note)}</p>
    </div>
  );
}
