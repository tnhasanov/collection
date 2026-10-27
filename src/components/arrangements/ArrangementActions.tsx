"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";

export function ArrangementActions({ id, status, isProposer, canReview, canRequest, canWrite }: { id: string; status: string; isProposer: boolean; canReview: boolean; canRequest: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: string) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await fetch(`/api/arrangements/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Failed");
      setMsg(JSON.stringify(j.data));
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ok = note.trim().length >= 3 && !busy;
  return (
    <div className="space-y-2">
      <Field label="Note (audited)" htmlFor={`arr-note-${id}`} required><Input id={`arr-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && canWrite && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("SUBMIT")}>Submit for review</Button>}
        {status === "SUBMITTED" && canReview && !isProposer && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("REVIEW")}>Mark reviewed</Button>}
        {status === "SUBMITTED" && isProposer && <span className="text-xs text-muted">Waiting for a different reviewer.</span>}
        {status === "REVIEWED" && canRequest && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("REQUEST_APPROVAL")}>Request independent approval</Button>}
        {status === "APPROVED" && canReview && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("SEND_TO_CORE")}>Send to core (mock)</Button>}
        {["DRAFT", "SUBMITTED", "REVIEWED"].includes(status) && canReview && <Button size="sm" variant="danger" disabled={!ok} onClick={() => void act("REJECT")}>Reject</Button>}
      </div>
      {error && <p className="field-error">{error}</p>}
      {msg && <p className="text-xs text-success">{msg}</p>}
    </div>
  );
}
