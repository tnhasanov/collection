"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";

export function CampaignActions({ id, status, canRequest }: { id: string; status: string; canRequest: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: string) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await fetch(`/api/campaigns/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      const j = await r.json();
      if (!j.ok) throw new Error(`${j.error?.message ?? "Failed"}${Array.isArray(j.error?.details) ? ": " + j.error.details.join("; ") : ""}`);
      setMsg(JSON.stringify(j.data));
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ok = note.trim().length >= 3 && !busy;
  return (
    <div className="space-y-2">
      <Field label="Note (audited)" htmlFor={`cmp-note-${id}`} required><Input id={`cmp-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("REVIEW")}>Review (snapshot audience)</Button>}
        {status === "REVIEWED" && canRequest && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("REQUEST_RELEASE")}>Request release approval</Button>}
        {(status === "RUNNING" || status === "SCHEDULED") && <Button size="sm" disabled={!ok} onClick={() => void act("PAUSE")}>Pause</Button>}
        {status === "PAUSED" && <Button size="sm" variant="primary" disabled={!ok} onClick={() => void act("RESUME")}>Resume</Button>}
        {["RUNNING", "PAUSED", "SCHEDULED"].includes(status) && <Button size="sm" disabled={!ok} onClick={() => void act("COMPLETE")}>Complete</Button>}
        {["DRAFT", "REVIEWED", "SCHEDULED", "RUNNING", "PAUSED"].includes(status) && <Button size="sm" variant="danger" disabled={!ok} onClick={() => void act("CANCEL")}>Cancel (stops queued)</Button>}
      </div>
      {error && <p className="field-error">{error}</p>}
      {msg && <p className="text-xs text-success">{msg}</p>}
    </div>
  );
}
