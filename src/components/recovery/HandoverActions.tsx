"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";

export function HandoverCreate({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const r = await fetch("/api/recovery/handovers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, receivingTeam: "Late collections / recovery" }) }); const j = await r.json(); if (!j.ok) throw new Error(j.error?.message ?? "Failed"); router.push(`/recovery?id=${j.data.id}`); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Prepare packet</Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

export function HandoverActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: string) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await fetch(`/api/recovery/handovers/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Failed");
      setMsg(JSON.stringify(j.data)); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ok = note.trim().length >= 3 && !busy;
  return (
    <div className="space-y-2">
      <Field label="Note (audited)" htmlFor={`ho-note-${id}`} required><Input id={`ho-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        {(status === "DRAFT" || status === "RETURNED") && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("REQUEST_REVIEW")}>Request review (S11)</Button>}
        {status === "APPROVED" && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("EXPORT")}>Export to receiving team</Button>}
        {["APPROVED", "EXPORTED", "ACCEPTED"].includes(status) && <a className="btn btn-secondary btn-sm" href={`/api/recovery/handovers/${id}/export`}>Download packet (JSON)</a>}
        {status === "EXPORTED" && <Button size="sm" disabled={!ok} onClick={() => void act("ACCEPT")}>Acknowledge receipt</Button>}
        {["REVIEW_REQUESTED", "APPROVED", "EXPORTED", "ACCEPTED"].includes(status) && <Button size="sm" variant="danger" disabled={!ok} onClick={() => void act("RETURN")}>Return to early collections</Button>}
      </div>
      {error && <p className="field-error">{error}</p>}
      {msg && <p className="text-xs text-success">{msg}</p>}
    </div>
  );
}
