"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Card, Field, Input } from "@/components/ui";
import { fmtAzn, fmtDateTime } from "@/lib/format";

interface LoanRow { id: string; coreLoanId: string; customerId: string; customerName: string; totalOverdue: string; dpd: number; nextDueAmount: string | null }
interface TxnRow { id: string; transactionId: string; sourceSystem: string; amount: string; loanRef: string | null; eventAt: string; customerName: string | null }
interface Page<T> { total: number; page: number; pageSize: number; rows: T[] }

function usePagedLookup<T>(kind: "loans" | "transactions") {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (query: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo/payments/lookup?kind=${kind}&q=${encodeURIComponent(query)}&page=${p}&pageSize=10`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setError(json.error?.message ?? "Lookup failed");
    } catch {
      setError("Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => {
    const id = setTimeout(() => void load(q, page), 250);
    return () => clearTimeout(id);
  }, [q, page, load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return { q, setQ: (v: string) => { setQ(v); setPage(1); }, page, setPage, pages, data, loading, error, reload: () => load(q, page) };
}

/** Synthetic core-posting simulator: scoped, searchable and paginated pickers (no hidden "top 60" lists); same ingestion as the real feed. */
export function PaymentSimulator({ today }: { today: string }) {
  const router = useRouter();
  const loans = usePagedLookup<LoanRow>("loans");
  const txns = usePagedLookup<TxnRow>("transactions");
  const [loan, setLoan] = useState<LoanRow | null>(null);
  const [txn, setTxn] = useState<TxnRow | null>(null);
  const [amount, setAmount] = useState("");
  const [valueDate, setValueDate] = useState(today);
  const [txnId, setTxnId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(kind: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setResult(null);
    const r = await fetch("/api/demo/payments/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, loanRef: loan?.coreLoanId, amount, valueDate, transactionId: txnId || undefined, ...extra }) });
    const j = await r.json();
    setBusy(false);
    setResult(j.ok ? JSON.stringify(j.data, null, 2) : `${j.error.code}: ${j.error.message}`);
    void loans.reload();
    void txns.reload();
    router.refresh();
  }

  return (
    <div className="mt-2 grid gap-3 lg:grid-cols-[2fr_3fr]">
      <Card title="Inject a synthetic core posting" subtitle="Synthetic environments only · goes through the same idempotent ingestion as the real feed">
        <div className="space-y-3">
          <Field label="Loan (search by loan id, customer, CIF)" htmlFor="sim-loan-q">
            <Input id="sim-loan-q" value={loans.q} onChange={(e) => loans.setQ(e.target.value)} placeholder="e.g. L-DEMO-001 or Demo customer 001" />
          </Field>
          <div className="rounded-md border border-line" role="listbox" aria-label="Loans">
            {loans.error && <p className="p-2 text-xs text-danger">{loans.error}</p>}
            {loans.loading && !loans.data && <p className="p-2 text-xs text-muted">Loading…</p>}
            {loans.data?.rows.length === 0 && <p className="p-2 text-xs text-muted">No loans in your scope match.</p>}
            {loans.data?.rows.map((l) => (
              <button key={l.id} type="button" role="option" aria-selected={loan?.id === l.id} className={`flex w-full items-center justify-between gap-2 border-b border-line px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-brand-light ${loan?.id === l.id ? "bg-brand-light font-medium" : ""}`} onClick={() => { setLoan(l); setAmount(Number(l.totalOverdue) > 0 ? l.totalOverdue : (l.nextDueAmount ?? "0.00")); }}>
                <span>{l.coreLoanId} · {l.customerName}</span>
                <span className="tabular-nums text-muted">DPD {l.dpd} · overdue {fmtAzn(l.totalOverdue)}</span>
              </button>
            ))}
            {loans.data && loans.pages > 1 && (
              <div className="flex items-center justify-between px-2 py-1 text-xs text-muted">
                <span>{loans.data.total} loans · page {loans.page} / {loans.pages}</span>
                <span className="flex gap-1">
                  <Button size="sm" disabled={loans.page <= 1} onClick={() => loans.setPage(loans.page - 1)}>Prev</Button>
                  <Button size="sm" disabled={loans.page >= loans.pages} onClick={() => loans.setPage(loans.page + 1)}>Next</Button>
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Selected: {loan ? `${loan.coreLoanId} (${loan.customerName})` : "none"}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (AZN)" htmlFor="sim-amount"><Input id="sim-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Value date" htmlFor="sim-date"><Input id="sim-date" type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} /></Field>
          </div>
          <Field label="Transaction id (optional, for deterministic replay tests)" htmlFor="sim-txn"><Input id="sim-txn" value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="auto-generated if empty" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !loan || !amount} onClick={() => run("POST")}>Post verified payment</Button>
            <Button disabled={busy || !loan || !amount} onClick={() => run("LATE")}>Late event (value date 3 days ago)</Button>
            <Button disabled={busy || !loan} onClick={() => run("CLAIM_ONLY")}>Claim only (no posting)</Button>
          </div>
          <hr className="border-line" />
          <Field label="Existing posting (search by transaction id, loan or customer)" htmlFor="sim-txn-q">
            <Input id="sim-txn-q" value={txns.q} onChange={(e) => txns.setQ(e.target.value)} placeholder="e.g. CORE-TXN-… or DECK-TXN-…" />
          </Field>
          <div className="rounded-md border border-line" role="listbox" aria-label="Postings">
            {txns.data?.rows.length === 0 && <p className="p-2 text-xs text-muted">No postings in your scope match.</p>}
            {txns.data?.rows.map((t) => (
              <button key={t.id} type="button" role="option" aria-selected={txn?.id === t.id} className={`flex w-full items-center justify-between gap-2 border-b border-line px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-brand-light ${txn?.id === t.id ? "bg-brand-light font-medium" : ""}`} onClick={() => setTxn(t)}>
                <span>{t.transactionId} · {t.customerName ?? "—"}</span>
                <span className="tabular-nums text-muted">{fmtAzn(t.amount)} · {fmtDateTime(t.eventAt)}</span>
              </button>
            ))}
            {txns.data && txns.pages > 1 && (
              <div className="flex items-center justify-between px-2 py-1 text-xs text-muted">
                <span>{txns.data.total} postings · page {txns.page} / {txns.pages}</span>
                <span className="flex gap-1">
                  <Button size="sm" disabled={txns.page <= 1} onClick={() => txns.setPage(txns.page - 1)}>Prev</Button>
                  <Button size="sm" disabled={txns.page >= txns.pages} onClick={() => txns.setPage(txns.page + 1)}>Next</Button>
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !txn} onClick={() => run("REPLAY", { transactionId: txn?.transactionId, loanRef: txn?.loanRef ?? loan?.coreLoanId })}>Replay duplicate event</Button>
            <Button variant="danger" disabled={busy || !txn} onClick={() => run("REVERSE", { transactionId: txn?.transactionId, loanRef: txn?.loanRef ?? loan?.coreLoanId })}>Reverse posting</Button>
          </div>
          <p className="text-xs text-muted">An already-paid claim is recorded from the agent outcome (S06/S28C); it opens reconciliation without changing balances.</p>
        </div>
      </Card>
      <Card title="Result" subtitle="Effects: loan restatement, case sync, promise and agent attribution, work invalidation / provider withdrawal, exceptions">
        {result ? <pre className="max-h-[560px] overflow-auto rounded bg-canvas p-2 text-xs">{result}</pre> : <Callout tone="info">Pick a loan, then run a simulation to see the structured effect summary (same output as the ingestion service).</Callout>}
      </Card>
    </div>
  );
}
