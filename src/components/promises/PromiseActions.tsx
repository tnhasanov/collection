"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Dialog, Field, Input, Select } from "@/components/ui";
import { fmtAzn } from "@/lib/format";

interface CustomerHit { id: string; displayName: string; cif: string; maxDpd: number; totalOverdue: string }
interface Loan { id: string; coreLoanId: string; totalOverdue: string }

export function CreatePromiseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [form, setForm] = useState({ amount: "", deadlineDate: "", coveredLoanIds: [] as string[], customerConfirmed: false, supersedeReason: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const id = setTimeout(async () => {
      const r = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (j.ok) setHits(j.data.rows);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  async function pick(c: CustomerHit) {
    setCustomer(c);
    const r = await fetch(`/api/customers/${c.id}`);
    const j = await r.json();
    if (j.ok) {
      const ls = (j.data.loans as Loan[]).filter((l) => Number(l.totalOverdue) > 0);
      setLoans(j.data.loans);
      setForm({ ...form, coveredLoanIds: ls.map((l) => l.id), amount: ls.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2) });
    }
  }
  async function submit() {
    if (!customer) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/promises", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: customer.id, amount: form.amount, deadlineDate: form.deadlineDate, coveredLoanIds: form.coveredLoanIds, customerConfirmed: form.customerConfirmed, supersedeReason: form.supersedeReason || null }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setError(`${j.error.message}${j.error.details?.promiseIds ? " (supply a supersede reason to replace it)" : ""}`);
    setOpen(false);
    router.push(`/promises?view=active&selected=${j.data.promiseId}`);
    router.refresh();
  }
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Create promise</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create promise to pay">
        {!customer ? (
          <div>
            <Field label="Find customer" htmlFor="pp-q"><Input id="pp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, id, CIF or loan" /></Field>
            <ul className="mt-2 divide-y divide-line">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="w-full py-1.5 text-left text-sm hover:bg-brand-light" onClick={() => pick(h)}>
                    {h.displayName} · {h.cif} · DPD {h.maxDpd} · overdue {fmtAzn(h.totalOverdue)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{customer.displayName}</strong> · {customer.cif} · one active promise per covered obligation set; replacing an active promise needs a reason.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Agreed amount (AZN)" htmlFor="pp-amount" required><Input id="pp-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Agreed date (Baku, end of day)" htmlFor="pp-date" required><Input id="pp-date" type="date" value={form.deadlineDate} onChange={(e) => setForm({ ...form, deadlineDate: e.target.value })} /></Field>
            </div>
            <div className="text-sm">
              <p className="label">Covered obligations</p>
              {loans.map((l) => (
                <label key={l.id} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" checked={form.coveredLoanIds.includes(l.id)} onChange={(e) => setForm({ ...form, coveredLoanIds: e.target.checked ? [...form.coveredLoanIds, l.id] : form.coveredLoanIds.filter((x) => x !== l.id) })} /> {l.coreLoanId} ({fmtAzn(l.totalOverdue)} overdue)
                </label>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.customerConfirmed} onChange={(e) => setForm({ ...form, customerConfirmed: e.target.checked })} /> Customer confirmed</label>
            <Field label="Supersede reason (only if an active promise already covers these loans)" htmlFor="pp-sup"><Input id="pp-sup" value={form.supersedeReason} onChange={(e) => setForm({ ...form, supersedeReason: e.target.value })} /></Field>
            <Field label="Reminder plan" htmlFor="pp-rem"><Select id="pp-rem" defaultValue="1d"><option value="1d">PTP reminder SMS one day before deadline (approved template)</option></Select></Field>
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy || !form.amount || !form.deadlineDate || form.coveredLoanIds.length === 0} onClick={submit}>{busy ? "Saving…" : "Create promise"}</Button>
              <Button onClick={() => setCustomer(null)}>Back</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function CancelPromiseButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="danger"
      onClick={async () => {
        const reason = window.prompt("Reason for cancelling this promise (recorded; history is preserved):");
        if (!reason) return;
        const r = await fetch(`/api/promises/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
        const j = await r.json();
        if (!j.ok) window.alert(j.error.message);
        router.refresh();
      }}
    >
      Cancel with reason
    </Button>
  );
}
