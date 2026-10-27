"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

interface T { id: string; code: string; version: string; kind: string; language: string; title: string; text: string; channelScope: string[]; status: string }

export function TemplateEditor({ template, allowed, canSubmit }: { template: T; allowed: { name: string; description: string }[]; canSubmit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(template.text);
  const [version, setVersion] = useState(`${template.version}-draft`);
  const [language, setLanguage] = useState(template.language);
  const [title, setTitle] = useState(template.title);
  const [customerId, setCustomerId] = useState("C-DEMO-001");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const call = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!j.ok) throw new Error(`${j.error?.message ?? "Failed"}${Array.isArray(j.error?.details) ? ": " + j.error.details.map((d: { message?: string }) => d.message ?? String(d)).join("; ") : ""}`); return j.data; };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const v = preview?.validation as { ok: boolean; issues: { severity: string; message: string }[] } | undefined;
  const sms = preview?.sms as { length: number; encoding: string; segments: number } | null | undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => { setText(template.text); setPreview(null); setOpen(true); }}>New draft version from this</Button>
        {canSubmit && (template.status === "DRAFT" || template.status === "TESTED") && <Button size="sm" variant="primary" disabled={busy || rationale.trim().length < 5} onClick={() => run(async () => { const d = await call(`/api/templates/${template.id}/submit`, { rationale }); setMsg(`Approval request ${d.approvalId} created`); router.refresh(); })}>Submit for approval</Button>}
      </div>
      {(template.status === "DRAFT" || template.status === "TESTED") && canSubmit && <Field label="Rationale for activation" htmlFor={`tpl-rat-${template.id}`}><Input id={`tpl-rat-${template.id}`} value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>}
      {msg && <p className="text-xs text-success">{msg}</p>}
      {error && <p className="field-error">{error}</p>}
      <Dialog open={open} onClose={() => setOpen(false)} title={`New version of ${template.code}`} wide>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Version" htmlFor="tpl-ver"><Input id="tpl-ver" value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
              <Field label="Language" htmlFor="tpl-lang"><Select id="tpl-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>{["AZ", "EN", "RU"].map((l) => <option key={l}>{l}</option>)}</Select></Field>
            </div>
            <Field label="Title" htmlFor="tpl-title"><Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Text" htmlFor="tpl-text" hint="Use {{variable}} from the allow-list"><Textarea id="tpl-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <p className="text-xs text-muted">Allowed: {allowed.map((a) => <code key={a.name} className="mr-1 rounded bg-canvas px-1" title={a.description}>{`{{${a.name}}}`}</code>)}</p>
            <div className="flex items-end gap-2"><Field label="Preview customer" htmlFor="tpl-cust"><Input id="tpl-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} /></Field><Button size="sm" disabled={busy} onClick={() => run(async () => setPreview(await call("/api/templates/preview", { text, kind: template.kind, customerId: customerId || null })))}>Validate & preview</Button></div>
          </div>
          <div className="space-y-2 text-sm">
            {preview ? (
              <>
                <p>{v?.ok ? <Badge tone="success">valid</Badge> : <Badge tone="danger">invalid</Badge>} {sms && `· ${sms.length} chars · ${sms.encoding} · ${sms.segments} segment(s)`}</p>
                {v && v.issues.length > 0 && <ul className="text-xs">{v.issues.map((i, idx) => <li key={idx} className={i.severity === "ERROR" ? "text-danger" : "text-warning"}>{i.severity}: {i.message}</li>)}</ul>}
                <p className="text-xs font-medium">Rendered for {customerId || "sample"}:</p>
                <pre className="whitespace-pre-wrap rounded bg-canvas p-2 text-xs">{String(preview.rendered)}</pre>
              </>
            ) : <p className="text-muted">Validate to see rendering, encoding and segment count.</p>}
            <div className="flex gap-2"><Button variant="primary" size="sm" disabled={busy || !v?.ok} onClick={() => run(async () => { const d = await call("/api/templates", { fromId: template.id, code: template.code, version, kind: template.kind, language, title, text, channelScope: template.channelScope }); setOpen(false); router.push(`/templates?id=${d.id}`); router.refresh(); })}>Save draft</Button><Button size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
            {error && <p className="field-error">{error}</p>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
