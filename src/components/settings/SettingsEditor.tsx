"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, Field, Textarea, Input, Toast } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

interface Item { key: string; value: unknown; provenance: string; owner: string; version: number; effectiveFrom: string | null; description: string; editable: boolean; updatedAt: string; updatedBy: string | null }

export function SettingsEditor({ items }: { items: Item[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Toast message={msg} tone="info" />
      <table className="table-dense">
        <thead><tr><th>Parameter</th><th>Value</th><th>Provenance</th><th>Owner / version / effective</th><th></th></tr></thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.key}>
              <td><div className="font-medium">{s.key}</div><div className="text-xs text-muted">{s.description}</div></td>
              <td><pre className="max-h-28 max-w-md overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(s.value, null, 1)}</pre></td>
              <td><Badge tone={s.provenance === "SOURCE_BASED" ? "info" : s.provenance === "BANK_APPROVED" ? "success" : "warning"}>{s.provenance.replace(/_/g, " ").toLowerCase()}</Badge></td>
              <td className="text-xs text-muted">{s.owner} · v{s.version} · {s.effectiveFrom ? fmtDateTime(s.effectiveFrom) : "—"}<br />updated {fmtDateTime(s.updatedAt)} {s.updatedBy ? `by ${s.updatedBy}` : ""}</td>
              <td>{s.editable ? <Button size="sm" onClick={() => { setEditing(s); setText(JSON.stringify(s.value, null, 2)); setReason(""); setError(null); }}>Edit</Button> : <span className="text-xs text-muted">read-only</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.key ?? ""}`}>
        <Field label="Value (JSON)" htmlFor="set-value"><Textarea id="set-value" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono" /></Field>
        <Field label="Reason (audited)" htmlFor="set-reason" required><Input id="set-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <p className="field-error">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={!reason.trim()} onClick={async () => {
            let value: unknown;
            try { value = JSON.parse(text); } catch { return setError("Value must be valid JSON"); }
            const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: editing!.key, value, reason }) });
            const j = await r.json();
            if (!j.ok) return setError(j.error.message);
            setMsg(j.data.pendingApproval ? `Change recorded as approval request ${j.data.pendingApproval} (independent approval required)` : `Saved ${editing!.key} v${j.data.version}`);
            setEditing(null);
            router.refresh();
          }}>Save</Button>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}
