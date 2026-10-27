"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Dialog, Field, Input, Select } from "@/components/ui";
import { fromBakuLocalInput } from "@/lib/format";

export function TaskActions({ id, canReassign, agents, ownerId }: { id: string; canReassign: boolean; agents: { id: string; displayName: string }[]; ownerId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(ownerId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!canReassign) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reassign</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Reassign task (audited)">
        <Field label="New owner" htmlFor={`ra-${id}`}><Select id={`ra-${id}`} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Eligible pool</option>{agents.map((a) => (<option key={a.id} value={a.id}>{a.displayName}</option>))}</Select></Field>
        <Field label="Reason" htmlFor={`rr-${id}`} required><Input id={`rr-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={!reason.trim()} onClick={async () => { const r = await fetch(`/api/work-items/${id}/reassign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerUserId: target || null, reason }) }); const j = await r.json(); if (!j.ok) return setError(j.error.message); setOpen(false); router.refresh(); }}>Reassign</Button>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}

export function CreateCallbackButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string; cif: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [form, setForm] = useState({ local: "", customerRequested: true, ownerMode: "ME", reason: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q.trim()) return;
    const id = setTimeout(async () => { const r = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`); const j = await r.json(); if (j.ok) setHits(j.data.rows); }, 300);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Create callback</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create callback (policy-controlled)">
        <Field label="Customer" htmlFor="cb-q"><Input id="cb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer" /></Field>
        <ul className="mb-2 max-h-32 overflow-auto divide-y divide-line">
          {(q.trim() ? hits : []).map((h) => (<li key={h.id}><button type="button" className={`w-full py-1 text-left text-sm hover:bg-brand-light ${customerId === h.id ? "bg-brand-light" : ""}`} onClick={() => setCustomerId(h.id)}>{h.displayName} · {h.cif}</button></li>))}
        </ul>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Local time (Asia/Baku)" htmlFor="cb-time" required><Input id="cb-time" type="datetime-local" value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} /></Field>
          <Field label="Owner" htmlFor="cb-owner"><Select id="cb-owner" value={form.ownerMode} onChange={(e) => setForm({ ...form, ownerMode: e.target.value })}><option value="ME">Me</option><option value="POOL">Eligible pool</option></Select></Field>
        </div>
        <Field label="Reason" htmlFor="cb-reason" required><Input id="cb-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        <label className="mt-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.customerRequested} onChange={(e) => setForm({ ...form, customerRequested: e.target.checked })} /> Requested by the customer (narrow cooldown exception under policy)</label>
        {error && <Callout tone="danger" className="mt-2">{error}</Callout>}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={!customerId || !form.local || !form.reason.trim()} onClick={async () => { const dueAt = fromBakuLocalInput(form.local); if (!dueAt) return setError("Invalid time"); const r = await fetch("/api/callbacks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, dueAt, customerRequested: form.customerRequested, ownerMode: form.ownerMode, reason: form.reason }) }); const j = await r.json(); if (!j.ok) return setError(j.error.message); setOpen(false); router.refresh(); }}>Create</Button>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}
