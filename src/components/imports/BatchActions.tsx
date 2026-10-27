"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input } from "@/components/ui";

export function BatchActions({ id, status, issues }: { id: string; status: string; issues: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const call = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/imports/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Failed");
      setOpen(false);
      router.push(`/data/imports?batch=${id}`);
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap gap-1">
      {(status === "VALIDATED") && <Button size="sm" disabled={busy} onClick={() => void call("dry-run")}>Dry run</Button>}
      {(status === "VALIDATED" || status === "DRY_RUN") && <Button size="sm" variant="primary" disabled={busy} onClick={() => void call("commit")}>Commit</Button>}
      {status === "COMMITTED" && <Button size="sm" variant="danger" disabled={busy} onClick={() => setOpen(true)}>Roll back</Button>}
      {issues > 0 && <a className="btn btn-ghost btn-sm" href={`/api/imports/${id}/issues`}>Errors</a>}
      {error && <span className="text-xs text-danger">{error}</span>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Roll back this batch">
        <p className="text-sm">Payments are reversed through reversal events (history retained); non-financial rows are removed by batch; loans/schedules/arrears imports are retained and need a corrective import.</p>
        <Field label="Reason (audited)" htmlFor={`rb-${id}`} required><Input id={`rb-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <p className="field-error">{error}</p>}
        <div className="mt-3 flex gap-2"><Button variant="danger" disabled={reason.trim().length < 3 || busy} onClick={() => void call("rollback", { reason })}>Roll back</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div>
      </Dialog>
    </div>
  );
}
