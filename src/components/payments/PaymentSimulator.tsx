"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Card, Field, Input, Select } from "@/components/ui";
import { fmtAzn } from "@/lib/format";

export function PaymentSimulator({ loans, recent, today }: { loans: { id: string; coreLoanId: string; customerId: string; customerName: string; totalOverdue: string }[]; recent: { id: string; amount: string; loanRef: string | null }[]; today: string }) {
  const router = useRouter();
  const [loanRef, setLoanRef] = useState(loans[0]?.coreLoanId ?? "");
  const [amount, setAmount] = useState(loans[0]?.totalOverdue ?? "0.00");
  const [valueDate, setValueDate] = useState(today);
  const [txn, setTxn] = useState("");
  const [replayId, setReplayId] = useState(recent[0]?.id ?? "");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(kind: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setResult(null);
    const r = await fetch("/api/demo/payments/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, loanRef, amount, valueDate, transactionId: txn || undefined, ...extra }) });
    const j = await r.json();
    setBusy(false);
    setResult(j.ok ? JSON.stringify(j.data, null, 2) : `${j.error.code}: ${j.error.message}`);
    router.refresh();
  }
  return (
    <div className="mt-2 grid gap-3 lg:grid-cols-[2fr_3fr]">
      <Card title="Inject a synthetic core posting" subtitle="DEMO only · goes through the same idempotent ingestion as the real feed">
        <div className="space-y-3">
          <Field label="Loan" htmlFor="sim-loan">
            <Select id="sim-loan" value={loanRef} onChange={(e) => { setLoanRef(e.target.value); const l = loans.find((x) => x.coreLoanId === e.target.value); if (l) setAmount(l.totalOverdue); }}>
              {loans.map((l) => (<option key={l.id} value={l.coreLoanId}>{l.coreLoanId} · {l.customerName} · overdue {fmtAzn(l.totalOverdue)}</option>))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (AZN)" htmlFor="sim-amount"><Input id="sim-amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Value date" htmlFor="sim-date"><Input id="sim-date" type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} /></Field>
          </div>
          <Field label="Transaction id (optional, for deterministic replay tests)" htmlFor="sim-txn"><Input id="sim-txn" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="auto-generated if empty" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => run("POST")}>Post verified payment</Button>
            <Button disabled={busy} onClick={() => run("LATE")}>Late event (value date 3 days ago)</Button>
          </div>
          <hr className="border-line" />
          <Field label="Replay / reverse an existing posting" htmlFor="sim-replay">
            <Select id="sim-replay" value={replayId} onChange={(e) => setReplayId(e.target.value)}>
              {recent.map((r) => (<option key={r.id} value={r.id}>{r.id} · {fmtAzn(r.amount)} · {r.loanRef}</option>))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !replayId} onClick={() => run("REPLAY", { transactionId: replayId })}>Replay duplicate event</Button>
            <Button variant="danger" disabled={busy || !replayId} onClick={() => run("REVERSE", { transactionId: replayId })}>Reverse posting</Button>
          </div>
          <p className="text-xs text-muted">An already-paid claim is recorded from the agent outcome (S06/S28C); it opens reconciliation without changing balances.</p>
        </div>
      </Card>
      <Card title="Result" subtitle="Effects: loan restatement, case sync, promise attribution, work invalidation / provider withdrawal, exceptions">
        {result ? <pre className="max-h-[480px] overflow-auto rounded bg-canvas p-2 text-xs">{result}</pre> : <Callout tone="info">Run a simulation to see the structured effect summary (same output as the ingestion service).</Callout>}
      </Card>
    </div>
  );
}
