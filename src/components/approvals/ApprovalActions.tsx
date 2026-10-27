"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Field, Textarea } from "@/components/ui";

export function ApprovalActions({ id, status, isMaker, canDecide }: { id: string; status: string; isMaker: boolean; canDecide: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const open = status === "PENDING" || status === "INFO_REQUESTED";
  const act = async (path: string, body: unknown) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/approvals/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "Failed");
      setResult(j.data?.effect ? `Applied: ${JSON.stringify(j.data.effect)}` : `Recorded: ${j.data?.status ?? "ok"}`);
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!open) return <p className="text-xs text-muted">This request is closed.</p>;
  return (
    <div className="space-y-2">
      {isMaker && <Callout tone="warning">You are the maker of this request: you cannot approve or reject it (four-eyes rule).</Callout>}
      <Field label="Decision note (audited)" htmlFor={`ap-note-${id}`} required><Textarea id={`ap-note-${id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        {canDecide && !isMaker && <>
          <Button variant="primary" size="sm" disabled={busy || note.trim().length < 3} onClick={() => void act("decide", { decision: "APPROVE", note })}>Approve & apply</Button>
          <Button variant="danger" size="sm" disabled={busy || note.trim().length < 3} onClick={() => void act("decide", { decision: "REJECT", note })}>Reject</Button>
          <Button size="sm" disabled={busy || note.trim().length < 3} onClick={() => void act("decide", { decision: "REQUEST_INFO", note })}>Request information</Button>
        </>}
        {isMaker && <Button size="sm" variant="ghost" disabled={busy || note.trim().length < 3} onClick={() => void act("cancel", { reason: note })}>Cancel my request</Button>}
      </div>
      {error && <p className="field-error">{error}</p>}
      {result && <p className="text-xs text-success">{result}</p>}
    </div>
  );
}
