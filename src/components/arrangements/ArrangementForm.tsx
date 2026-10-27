"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn } from "@/lib/format";

export function ArrangementForm({ supportCases }: { supportCases: { id: string; customerId: string; label: string }[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(supportCases[0]?.customerId ?? "C-DEMO-017");
  const [supportCaseId, setSupportCaseId] = useState(supportCases[0]?.id ?? "");
  const [type, setType] = useState<"TEMPORARY_PLAN" | "RESTRUCTURE">("TEMPORARY_PLAN");
  const [monthly, setMonthly] = useState("150.00");
  const [months, setMonths] = useState("3");
  const [tenor, setTenor] = useState("24");
  const [firstDue, setFirstDue] = useState("2026-11-20");
  const [reason, setReason] = useState("Income interruption");
  const [affordable, setAffordable] = useState("150.00");
  const [sim, setSim] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const proposal = type === "TEMPORARY_PLAN" ? { type, monthlyPayment: monthly, months: Number(months) } : { type, newTenorMonths: Number(tenor), firstDueDate: firstDue };
  const call = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!j.ok) throw new Error(j.error?.message ?? "Failed"); return j.data; };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); setBusy(true); setError(null); call("/api/arrangements/simulate", { customerId, proposal }).then(setSim).catch((er) => setError(er.message)).finally(() => setBusy(false)); }}>
        <Field label="Support case" htmlFor="af-sc"><Select id="af-sc" value={supportCaseId} onChange={(e) => { setSupportCaseId(e.target.value); const sc = supportCases.find((s) => s.id === e.target.value); if (sc) setCustomerId(sc.customerId); }}><option value="">— none —</option>{supportCases.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        <Field label="Customer id" htmlFor="af-cust"><Input id="af-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} /></Field>
        <Field label="Type" htmlFor="af-type"><Select id="af-type" value={type} onChange={(e) => setType(e.target.value as "TEMPORARY_PLAN")}><option value="TEMPORARY_PLAN">Temporary reduced plan</option><option value="RESTRUCTURE">Restructure (simulation)</option></Select></Field>
        {type === "TEMPORARY_PLAN" ? <div className="grid grid-cols-2 gap-2"><Field label="Monthly payment (AZN)" htmlFor="af-m"><Input id="af-m" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field><Field label="Months" htmlFor="af-n"><Input id="af-n" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(e.target.value)} /></Field></div> : <div className="grid grid-cols-2 gap-2"><Field label="New tenor (months)" htmlFor="af-t"><Input id="af-t" type="number" min={1} max={120} value={tenor} onChange={(e) => setTenor(e.target.value)} /></Field><Field label="First due date" htmlFor="af-fd"><Input id="af-fd" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field></div>}
        <Field label="Intake reason" htmlFor="af-r"><Input id="af-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Proposed affordable amount (AZN)" htmlFor="af-a" hint="Income/expense details stay restricted"><Input id="af-a" inputMode="decimal" value={affordable} onChange={(e) => setAffordable(e.target.value)} /></Field>
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Simulate</Button><Button size="sm" variant="primary" disabled={busy || !sim} onClick={() => { setBusy(true); setError(null); call("/api/arrangements", { customerId, supportCaseId: supportCaseId || null, intake: { reason, monthlyIncome: "restricted", monthlyExpenses: "restricted", proposedAffordable: affordable }, proposal }).then((d) => { router.push(`/arrangements?id=${d.id}`); router.refresh(); }).catch((er) => setError(er.message)).finally(() => setBusy(false)); }}>Save as draft</Button></div>
        {error && <p className="field-error">{error}</p>}
      </form>
      <div className="text-sm">
        {sim ? (sim.type === "TEMPORARY_PLAN" ? <ul className="text-xs"><li>Current overdue: {fmtAzn(String(sim.currentOverdue))}</li><li>Contractual due in window: {fmtAzn(String(sim.contractualDueInWindow))}</li><li>Plan total: {fmtAzn(String(sim.planTotal))}</li><li>Shortfall at plan end: {fmtAzn(String(sim.shortfallAtPlanEnd))}</li><li>Overdue covered: {sim.overdueCovered ? "yes" : "no"}</li><li className="text-muted">{String(sim.note)}</li></ul> : <Textarea readOnly rows={10} value={JSON.stringify(sim, null, 1)} className="font-mono text-xs" />) : <p className="text-muted">Run a simulation to compare the proposal with the contractual schedule.</p>}
      </div>
    </div>
  );
}
