"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Textarea } from "@/components/ui";

/** Verify or reject a reported special case (deceased / legal). Both decisions need a note and are audited. */
export function SpecialCaseActions({ supportCaseId, type, size = "sm" }: { supportCaseId: string; type: string; size?: "sm" }) {
  const router = useRouter();
  const [open, setOpen] = useState<"CONFIRM" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!open) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/support-cases/${supportCaseId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: open, note }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setError(j.error.message);
    setOpen(null);
    setNote("");
    router.refresh();
  }
  const label = type === "DECEASED_LEGAL" ? "death report" : "special case";
  return (
    <>
      <Button size={size} variant="danger" onClick={() => setOpen("CONFIRM")} data-testid="special-confirm">Confirm {label}</Button>
      <Button size={size} onClick={() => setOpen("REJECT")} data-testid="special-reject">Not confirmed</Button>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open === "CONFIRM" ? `Confirm ${label}` : `Report not confirmed`}>
        <p className="text-sm text-muted">{open === "CONFIRM" ? "Confirming cancels active promises, withdraws routine work and stops reminders for this customer; the customer moves to confirmed special handling. Record the evidence you verified." : "Rejecting returns the customer to the normal process and re-evaluates open work. Record why the report was not confirmed."}</p>
        <Field label="Verification note (audited)" htmlFor="special-note" required>
          <Textarea id="special-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
        {error && <p className="callout callout-danger mt-2">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button variant={open === "CONFIRM" ? "danger" : "primary"} disabled={busy || note.trim().length < 3} onClick={submit}>{busy ? "…" : open === "CONFIRM" ? "Confirm" : "Reject report"}</Button>
          <Button onClick={() => setOpen(null)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}
