"use client";
import { useState } from "react";
import { Badge, Button, Callout, Field, Input, Tabs } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import type { JsonOf } from "@/components/agent/types";
import type { getLoanDetail } from "@/server/modules/finance/loanDetailService";

type Data = JsonOf<Awaited<ReturnType<typeof getLoanDetail>>>;
type Sim = Data["localSimulation"];

export function LoanTabs({ data }: { data: Data }) {
  const [tab, setTab] = useState("schedule");
  const [form, setForm] = useState({ principal: data.loan.principalOriginal, nominalAnnualRatePct: (Number(data.loan.nominalAnnualRate) * 100).toFixed(2), months: data.loan.tenorMonths, firstDueDate: data.loan.firstDueDate ?? "", paymentDay: Number((data.loan.firstDueDate ?? "2026-01-01").slice(8, 10)) });
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/loans/${data.loan.id}/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, months: Number(form.months), paymentDay: Number(form.paymentDay) }) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) return setError(json.error.message);
    setSim(json.data);
  }
  const core = data.schedule;
  return (
    <div>
      <Tabs idPrefix="loan" active={tab} onChange={setTab} tabs={[{ key: "schedule", label: "Contractual schedule (core)" }, { key: "payments", label: "Payments / allocations", count: data.payments.length }, { key: "changes", label: "Changes", count: data.versions.length + data.snapshots.length }, { key: "simulation", label: "Simulation" }]} />
      <div className="mt-3" role="tabpanel" id={`loan-panel-${tab}`}>
        {tab === "schedule" && core && (
          <div className="overflow-x-auto">
            <p className="mb-2 text-xs text-muted">
              Source schedule {core.sourceRef} v{core.versionNo} ({humanize(core.source)}) · effective {fmtDate(core.effectiveFrom)} · checksum {core.checksum} · read-only
            </p>
            <table className="table-dense">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Due date</th>
                  <th className="num">Opening</th>
                  <th className="num">Principal</th>
                  <th className="num">Interest</th>
                  <th className="num">Fee/penalty</th>
                  <th className="num">Total due</th>
                  <th className="num">Paid / allocated</th>
                  <th className="num">Remaining</th>
                  <th>Status</th>
                  <th className="num">Closing</th>
                </tr>
              </thead>
              <tbody>
                {core.installments.map((i) => (
                  <tr key={i.seq} className={i.status === "OVERDUE" ? "is-selected" : undefined}>
                    <td>{i.seq}</td>
                    <td>{fmtDate(i.dueDate)}</td>
                    <td className="num">{fmtAzn(i.openingPrincipal, false)}</td>
                    <td className="num">{fmtAzn(i.principalDue, false)}</td>
                    <td className="num">{fmtAzn(i.interestDue, false)}</td>
                    <td className="num">{fmtAzn(i.feeDue, false)}</td>
                    <td className="num">{fmtAzn(i.totalDue, false)}</td>
                    <td className="num">{fmtAzn(i.paid, false)}</td>
                    <td className="num">{fmtAzn(i.remaining, false)}</td>
                    <td>
                      <Badge tone={i.status === "OVERDUE" ? "danger" : i.status === "PAID" ? "success" : i.status === "PARTIALLY_PAID" || i.status === "DUE" ? "warning" : "neutral"}>{humanize(i.status)}</Badge>
                    </td>
                    <td className="num">{fmtAzn(i.closingPrincipal, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "payments" && (
          <div className="space-y-2">
            {data.payments.length === 0 && <p className="text-sm text-muted">No payments.</p>}
            {data.payments.map((p) => (
              <div key={p.id} className="rounded-md border border-line p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.sourceTransactionId}</span>
                  <span>{fmtAzn(p.amount)}</span>
                  <span className="text-muted">value {fmtDate(p.valueDate)} · event {fmtDateTime(p.eventAt)}</span>
                  <Badge tone={p.status === "POSTED" ? "success" : p.status === "REVERSED" ? "danger" : "warning"}>{humanize(p.status)}</Badge>
                  <Badge tone="neutral">{humanize(p.reconciliation)}</Badge>
                </div>
                {p.allocations.length > 0 && (
                  <ul className="mt-1 text-xs text-muted">
                    {p.allocations.map((a, idx) => (
                      <li key={idx}>
                        {a.installmentSeq ? `installment #${a.installmentSeq}:` : "unapplied:"} interest {fmtAzn(a.interest, false)} · principal {fmtAzn(a.principal, false)} · fee {fmtAzn(a.fee, false)} · unapplied {fmtAzn(a.unapplied, false)} · {a.policy}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === "changes" && (
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div>
              <h3 className="font-bold">Schedule versions</h3>
              <ul className="mt-1 space-y-1">
                {data.versions.map((v) => (
                  <li key={v.id}>
                    v{v.versionNo} · {humanize(v.source)} · {v.sourceRef} · effective {fmtDate(v.effectiveFrom)} · {v.installments} installments {v.isCurrent && <Badge tone="success">current</Badge>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-bold">Balance restatements (immutable snapshots)</h3>
              <ul className="mt-1 space-y-1 text-xs">
                {data.snapshots.map((s) => (
                  <li key={s.id}>
                    {fmtDateTime(s.asOf, true)} · v{s.balanceVersion} · DPD {s.dpd} · overdue {fmtAzn(s.totalOverdue, false)} · outstanding {fmtAzn(s.principalOutstanding, false)} · {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {tab === "simulation" && (
          <div>
            <p className="mb-2 text-xs text-muted">Local annuity simulation (demo generator). Basis: {data.localSimulation.basis.formula}. {data.localSimulation.basis.rounding}. {data.localSimulation.basis.calendar}. The imported core schedule is never changed.</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Field label="Principal (AZN)" htmlFor="sim-p"><Input id="sim-p" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></Field>
              <Field label="Nominal annual rate %" htmlFor="sim-r"><Input id="sim-r" value={form.nominalAnnualRatePct} onChange={(e) => setForm({ ...form, nominalAnnualRatePct: e.target.value })} /></Field>
              <Field label="Months" htmlFor="sim-n"><Input id="sim-n" type="number" value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })} /></Field>
              <Field label="First due date" htmlFor="sim-d"><Input id="sim-d" type="date" value={form.firstDueDate} onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} /></Field>
              <Field label="Payment day" htmlFor="sim-day"><Input id="sim-day" type="number" min={1} max={31} value={form.paymentDay} onChange={(e) => setForm({ ...form, paymentDay: Number(e.target.value) })} /></Field>
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={run} disabled={busy}>{busy ? "Calculating…" : "Run simulation"}</Button>
            </div>
            {error && <Callout tone="danger" className="mt-2">{error}</Callout>}
            {(sim ?? data.localSimulation) && (
              <div className="mt-3 overflow-x-auto">
                <p className="text-sm">
                  Regular payment <strong>{fmtAzn((sim ?? data.localSimulation).regularPayment)}</strong> (unrounded {(sim ?? data.localSimulation).regularPaymentUnrounded.slice(0, 14)}) · total interest {fmtAzn((sim ?? data.localSimulation).totalInterest)} · total payable {fmtAzn((sim ?? data.localSimulation).totalPayable)} · final adjustment {fmtAzn((sim ?? data.localSimulation).finalAdjustment)}
                </p>
                {!sim && data.mismatches.length === 0 && <p className="text-xs text-success">Local simulation matches the imported core schedule exactly.</p>}
                {!sim && data.mismatches.length > 0 && <p className="text-xs text-warning">Differences versus core: {data.mismatches.map((m) => `#${m.seq} interest ${m.coreInterest} vs ${m.localInterest}`).join("; ")}</p>}
                <table className="table-dense mt-2">
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>Due</th>
                      <th className="num">Opening</th>
                      <th className="num">Interest</th>
                      <th className="num">Principal</th>
                      <th className="num">Total</th>
                      <th className="num">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sim ?? data.localSimulation).installments.map((i) => (
                      <tr key={i.seq}>
                        <td>{i.seq}</td>
                        <td>{fmtDate(i.dueDate)}</td>
                        <td className="num">{fmtAzn(i.openingPrincipal, false)}</td>
                        <td className="num">{fmtAzn(i.interestDue, false)}</td>
                        <td className="num">{fmtAzn(i.principalDue, false)}</td>
                        <td className="num">{fmtAzn(i.totalDue, false)}</td>
                        <td className="num">{fmtAzn(i.closingPrincipal, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
