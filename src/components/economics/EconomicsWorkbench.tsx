"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Toast } from "@/components/ui";
import { fmtAzn, fmtDateTime } from "@/lib/format";

export interface EconInput { unitCosts: { sms: string; ivr: string; agent: string }; uplift: { sms: string; ivr: string; agent: string }; channels: { sms: boolean; call: boolean; ivr: boolean; email: boolean }; capacity: { seniorAgents: number; regularAgents: number; workingHoursStart: string; workingHoursEnd: string; avgHandleSeconds: number; avgAcwSeconds: number; reserveCapacityPct: number; callbackReservePct: number; expectedRpcRate: string; retryDemandPct: number; successfulContactsPerAgentDay: number } }
interface ChannelRow { channel: string; enabled: boolean; unitCost: string; uplift: string; breakEvenEra: string | null; eligible: number; aboveBreakEven: number; assumedBenefit: string; cost: string; netBenefit: string; eraTotal: string; note: string }
export interface EconResult { computedAt: string; population: { customers: number; scored: number; callItems: number; seniorItems: number; regularItems: number; smsItems: number; eraTotal: string }; channels: ChannelRow[]; capacity: { agents: number; hours: string; attemptsPerAgentDay: number; successfulPerAgentDay: number; attemptsCapacity: number; successfulCapacity: number; seniorSuccessful: number; regularSuccessful: number; retryDemand: number; distinctCustomersPerDay: number; seniorOverflow: number; regularOverflow: number; coverageDays: string; riskPriorityCut: { rank: number | null; era: string | null; bucket: number | null } | null }; observed: { attempts: number; distinctCustomers: number; successfulContacts: number; promises: number; smsQueued: number; since: string }; fallback: { ivrEnabled: boolean; ivrPopulation: number; note: string }; disclaimers: string[] }
type Scenario = { name: string; input: EconInput; result: EconResult | null };

export function EconomicsWorkbench({ presets, initial, canEdit, provenance }: { presets: Record<"conservative" | "base" | "upside", EconInput>; initial: EconResult; canEdit: boolean; provenance: { key: string; provenance: string; effectiveFrom: string | null; version: number; owner: string }[] }) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([{ name: "Base", input: presets.base, result: initial }]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cur = scenarios[active];
  const setInput = (fn: (i: EconInput) => EconInput) => setScenarios((s) => s.map((sc, i) => (i === active ? { ...sc, input: fn(structuredClone(sc.input)), result: null } : sc)));
  const compute = async (idx = active) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/economics/compute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scenarios[idx].input) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Compute failed");
      setScenarios((s) => s.map((sc, i) => (i === idx ? { ...sc, result: j.data } : sc)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const addScenario = (preset: "conservative" | "base" | "upside") => { setScenarios((s) => [...s, { name: preset[0].toUpperCase() + preset.slice(1), input: presets[preset], result: null }]); setActive(scenarios.length); };
  const saveAsSettings = async () => {
    setBusy(true); setError(null);
    try {
      const i = cur.input;
      const puts = [
        ["economics.unitCosts", { sms: { cost: i.unitCosts.sms, unit: "per SMS" }, ivr: { cost: i.unitCosts.ivr, unit: "per IVR attempt" }, agent: { cost: i.unitCosts.agent, unit: "per customer-day" } }],
        ["capacity.operational", { workingHoursStart: i.capacity.workingHoursStart, workingHoursEnd: i.capacity.workingHoursEnd, avgHandleSeconds: i.capacity.avgHandleSeconds, avgAcwSeconds: i.capacity.avgAcwSeconds, reserveCapacityPct: i.capacity.reserveCapacityPct, callbackReservePct: i.capacity.callbackReservePct }],
      ] as const;
      for (const [key, value] of puts) {
        const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value, reason: `Updated from the economics workbench (${cur.name} scenario)` }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error?.message ?? "Save failed");
      }
      setMsg("Unit costs and operational capacity saved as dated settings (audited). Uplift scenarios stay assumptions in settings.");
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const num = (v: string) => Number(v);
  return (
    <div className="space-y-3">
      <Toast message={msg} tone="success" />
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map((s, i) => <Button key={i} size="sm" variant={i === active ? "primary" : "secondary"} onClick={() => setActive(i)} aria-pressed={i === active}>{s.name}{s.result ? "" : " *"}</Button>)}
        <span className="text-xs text-muted">Add preset:</span>
        {(["conservative", "base", "upside"] as const).map((p) => <Button key={p} size="sm" variant="ghost" onClick={() => addScenario(p)}>{p}</Button>)}
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void compute()}>{busy ? "Computing…" : "Compute scenario"}</Button>
        {canEdit && <Button size="sm" disabled={busy} onClick={() => void saveAsSettings()}>Save costs & capacity as settings</Button>}
      </div>
      {error && <p className="field-error">{error}</p>}

      <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card title={`Inputs · ${cur.name}`} subtitle="Dated costs and scenario uplift (relative ERA reduction)">
          <div className="grid grid-cols-2 gap-2">
            {(["sms", "ivr", "agent"] as const).map((ch) => (
              <div key={ch} className="contents">
                <Field label={`${ch.toUpperCase()} cost (${ch === "sms" ? "per SMS" : ch === "ivr" ? "per IVR attempt" : "per customer-day"})`} htmlFor={`ec-c-${ch}`}><Input id={`ec-c-${ch}`} inputMode="decimal" value={cur.input.unitCosts[ch]} onChange={(e) => setInput((i) => ({ ...i, unitCosts: { ...i.unitCosts, [ch]: e.target.value } }))} /></Field>
                <Field label={`${ch.toUpperCase()} uplift (assumed)`} htmlFor={`ec-u-${ch}`}><Input id={`ec-u-${ch}`} inputMode="decimal" value={cur.input.uplift[ch]} onChange={(e) => setInput((i) => ({ ...i, uplift: { ...i.uplift, [ch]: e.target.value } }))} /></Field>
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm font-medium">Channels</p>
          <div className="flex flex-wrap gap-3 text-sm">{(["sms", "call", "ivr", "email"] as const).map((ch) => <label key={ch} className="flex items-center gap-1"><input type="checkbox" checked={cur.input.channels[ch]} onChange={(e) => setInput((i) => ({ ...i, channels: { ...i.channels, [ch]: e.target.checked } }))} />{ch.toUpperCase()}</label>)}</div>
          <p className="mt-2 text-sm font-medium">Capacity</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Senior agents" htmlFor="ec-sen"><Input id="ec-sen" type="number" min={0} value={cur.input.capacity.seniorAgents} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, seniorAgents: num(e.target.value) } }))} /></Field>
            <Field label="Regular agents" htmlFor="ec-reg"><Input id="ec-reg" type="number" min={0} value={cur.input.capacity.regularAgents} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, regularAgents: num(e.target.value) } }))} /></Field>
            <Field label="Shift start" htmlFor="ec-ws"><Input id="ec-ws" value={cur.input.capacity.workingHoursStart} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, workingHoursStart: e.target.value } }))} /></Field>
            <Field label="Shift end" htmlFor="ec-we"><Input id="ec-we" value={cur.input.capacity.workingHoursEnd} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, workingHoursEnd: e.target.value } }))} /></Field>
            <Field label="Handle time (s)" htmlFor="ec-ht"><Input id="ec-ht" type="number" value={cur.input.capacity.avgHandleSeconds} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, avgHandleSeconds: num(e.target.value) } }))} /></Field>
            <Field label="ACW (s)" htmlFor="ec-acw"><Input id="ec-acw" type="number" value={cur.input.capacity.avgAcwSeconds} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, avgAcwSeconds: num(e.target.value) } }))} /></Field>
            <Field label="Reserve capacity %" htmlFor="ec-res"><Input id="ec-res" type="number" value={cur.input.capacity.reserveCapacityPct} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, reserveCapacityPct: num(e.target.value) } }))} /></Field>
            <Field label="Callback reserve %" htmlFor="ec-cb"><Input id="ec-cb" type="number" value={cur.input.capacity.callbackReservePct} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, callbackReservePct: num(e.target.value) } }))} /></Field>
            <Field label="Expected RPC rate" htmlFor="ec-rpc"><Input id="ec-rpc" inputMode="decimal" value={cur.input.capacity.expectedRpcRate} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, expectedRpcRate: e.target.value } }))} /></Field>
            <Field label="Retry demand %" htmlFor="ec-retry"><Input id="ec-retry" type="number" value={cur.input.capacity.retryDemandPct} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, retryDemandPct: num(e.target.value) } }))} /></Field>
            <Field label="Successful contacts / agent-day cap" htmlFor="ec-cap"><Input id="ec-cap" type="number" value={cur.input.capacity.successfulContactsPerAgentDay} onChange={(e) => setInput((i) => ({ ...i, capacity: { ...i.capacity, successfulContactsPerAgentDay: num(e.target.value) } }))} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Provenance: {provenance.map((p) => `${p.key} ${p.provenance.toLowerCase().replace("_", " ")} v${p.version}${p.effectiveFrom ? ` from ${fmtDateTime(p.effectiveFrom)}` : ""}`).join(" · ")}</p>
        </Card>

        <div className="space-y-3">
          {cur.result ? <ResultView r={cur.result} /> : <Card><p className="text-sm text-muted">Inputs changed. Compute the scenario to refresh the results.</p></Card>}
          {scenarios.filter((s) => s.result).length > 1 && (
            <Card title="Scenario comparison" subtitle="Side by side; none of these is activated">
              <table className="table-dense"><thead><tr><th>Scenario</th><th>Agent break-even ERA</th><th>Agent net benefit</th><th>SMS break-even ERA</th><th>SMS net benefit</th><th>Successful-contact capacity/day</th><th>Coverage days</th></tr></thead>
                <tbody>{scenarios.filter((s) => s.result).map((s, i) => { const a = s.result!.channels.find((c) => c.channel === "agent")!; const sm = s.result!.channels.find((c) => c.channel === "sms")!; return <tr key={i}><td className="font-medium">{s.name}</td><td>{a.breakEvenEra ? fmtAzn(a.breakEvenEra) : "—"}</td><td>{fmtAzn(a.netBenefit)}</td><td>{sm.breakEvenEra ? fmtAzn(sm.breakEvenEra) : "—"}</td><td>{fmtAzn(sm.netBenefit)}</td><td>{s.result!.capacity.successfulCapacity}</td><td>{s.result!.capacity.coverageDays}</td></tr>; })}</tbody></table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView({ r }: { r: EconResult }) {
  return (
    <>
      <Card title="Break-even and assumed benefit" subtitle={`Computed ${fmtDateTime(r.computedAt)} · ${r.population.customers} customers in the daily snapshot (${r.population.scored} scored) · ERA total ${fmtAzn(r.population.eraTotal)}`}>
        <table className="table-dense"><thead><tr><th>Channel</th><th>Unit cost</th><th>Assumed uplift</th><th>Break-even ERA</th><th className="text-right">Targeted</th><th className="text-right">≥ break-even</th><th className="text-right">Assumed benefit</th><th className="text-right">Cost</th><th className="text-right">Net (assumed)</th></tr></thead>
          <tbody>{r.channels.map((c) => <tr key={c.channel} className={c.enabled ? "" : "opacity-60"}><td>{c.channel.toUpperCase()} {c.enabled ? <Badge tone="success">enabled</Badge> : <Badge tone="neutral">disabled</Badge>}</td><td>{fmtAzn(c.unitCost)}</td><td>{c.uplift}</td><td>{c.breakEvenEra ? fmtAzn(c.breakEvenEra) : "—"}</td><td className="text-right">{c.eligible}</td><td className="text-right">{c.aboveBreakEven}</td><td className="text-right">{fmtAzn(c.assumedBenefit)}</td><td className="text-right">{fmtAzn(c.cost)}</td><td className="text-right font-medium">{fmtAzn(c.netBenefit)}</td></tr>)}</tbody></table>
        <ul className="mt-2 text-xs text-muted">{r.channels.map((c) => <li key={c.channel}>{c.channel.toUpperCase()}: {c.note}</li>)}</ul>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Capacity" subtitle="Successful contacts are the real limiter, not attempts">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Agents / shift hours</dt><dd>{r.capacity.agents} / {r.capacity.hours}</dd>
            <dt className="text-muted">Attempts per agent-day</dt><dd>{r.capacity.attemptsPerAgentDay}</dd>
            <dt className="text-muted">Successful contacts per agent-day</dt><dd>{r.capacity.successfulPerAgentDay}</dd>
            <dt className="text-muted">Attempt capacity / day</dt><dd>{r.capacity.attemptsCapacity}</dd>
            <dt className="text-muted">Successful-contact capacity / day</dt><dd>{r.capacity.successfulCapacity} (senior {r.capacity.seniorSuccessful}, regular {r.capacity.regularSuccessful})</dd>
            <dt className="text-muted">Distinct customers reachable / day</dt><dd>{r.capacity.distinctCustomersPerDay}</dd>
            <dt className="text-muted">Call items (senior / regular)</dt><dd>{r.population.callItems} ({r.population.seniorItems} / {r.population.regularItems}) + retry demand {r.capacity.retryDemand}</dd>
            <dt className="text-muted">Overflow (senior / regular)</dt><dd>{r.capacity.seniorOverflow} / {r.capacity.regularOverflow}</dd>
            <dt className="text-muted">Coverage days</dt><dd>{r.capacity.coverageDays}</dd>
            <dt className="text-muted">Risk priority cut</dt><dd>{r.capacity.riskPriorityCut ? `rank ${r.capacity.riskPriorityCut.rank} · ERA ${fmtAzn(r.capacity.riskPriorityCut.era)} · bucket ${r.capacity.riskPriorityCut.bucket}` : "all call items fit today"}</dd>
          </dl>
        </Card>
        <Card title="Observed today" subtitle={`Since ${r.observed.since} · attempts vs distinct customers vs successful contacts`}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Attempts</dt><dd>{r.observed.attempts}</dd>
            <dt className="text-muted">Distinct customers attempted</dt><dd>{r.observed.distinctCustomers}</dd>
            <dt className="text-muted">Successful contacts (verified RPC)</dt><dd>{r.observed.successfulContacts}</dd>
            <dt className="text-muted">Promises</dt><dd>{r.observed.promises}</dd>
            <dt className="text-muted">SMS queued (local log)</dt><dd>{r.observed.smsQueued}</dd>
          </dl>
          <p className="mt-2 text-sm"><strong>Fallback:</strong> {r.fallback.note}</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted">{r.disclaimers.map((d) => <li key={d}>{d}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
