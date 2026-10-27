"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Textarea, Input } from "@/components/ui";

export function ModelImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null); setErrors([]);
      try {
        let pkg: unknown;
        try { pkg = JSON.parse(text); } catch { setErrors(["Not valid JSON"]); return; }
        const r = await fetch("/api/models/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: pkg, owner: owner || undefined }) });
        const j = await r.json();
        if (!j.ok) { setErrors([j.error.message, ...((j.error.details as string[] | null) ?? [])]); return; }
        setMsg(`Imported as DRAFT ${j.data.id} · golden ${j.data.golden.passed}/${j.data.golden.total}`);
        setText("");
        router.push(`/models/prometeia?v=${j.data.id}`);
      } finally { setBusy(false); }
    }}>
      <Field label="Rule package JSON" htmlFor="mi-json" hint="modelCode, version, provider, features[], leaves[] with typed comparisons"><Textarea id="mi-json" rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder='{"modelCode":"…","version":"…","provider":"Prometeia","features":[…],"leaves":[…]}' /></Field>
      <Field label="Owner" htmlFor="mi-owner"><Input id="mi-owner" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
      <div className="flex items-center gap-2"><Button type="submit" variant="primary" size="sm" disabled={busy || !text.trim()}>Validate & import as draft</Button><a className="text-xs" href="/api/models/template">Download example package</a></div>
      {msg && <p className="text-xs text-success">{msg}</p>}
      {errors.length > 0 && <ul className="text-xs text-danger">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </form>
  );
}
