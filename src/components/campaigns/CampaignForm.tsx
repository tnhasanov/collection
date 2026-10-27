"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";

export function CampaignForm({ templates, strategies }: { templates: { id: string; code: string; version: string; language: string; status: string }[]; strategies: { id: string; code: string; version: string; status: string }[] }) {
  const router = useRouter();
  const [code, setCode] = useState("SMS_REMINDER_TEST");
  const [name, setName] = useState("Test reminder wave");
  const [templateId, setTemplateId] = useState(templates.find((t) => t.status === "ACTIVE")?.id ?? "");
  const [strategyId, setStrategyId] = useState(strategies.find((s) => s.status === "ACTIVE")?.id ?? "");
  const [languages, setLanguages] = useState<string[]>(["AZ", "EN", "RU"]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="grid gap-2 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try {
        const r = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name, templateId: templateId || null, strategyVersionId: strategyId || null, languages, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error?.message ?? "Failed");
        router.push(`/campaigns?id=${j.data.id}`); router.refresh();
      } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
    }}>
      <Field label="Code" htmlFor="cf-code"><Input id="cf-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
      <Field label="Name" htmlFor="cf-name"><Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Template" htmlFor="cf-tpl"><Select id="cf-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">— none —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.code} {t.version} {t.language} ({t.status.toLowerCase()})</option>)}</Select></Field>
      <Field label="Strategy version" htmlFor="cf-st"><Select id="cf-st" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}><option value="">— none —</option>{strategies.map((s) => <option key={s.id} value={s.id}>{s.code} {s.version} ({s.status.toLowerCase()})</option>)}</Select></Field>
      <Field label="Languages" htmlFor="cf-lang"><div id="cf-lang" className="flex gap-3 text-sm">{["AZ", "EN", "RU"].map((l) => <label key={l} className="flex items-center gap-1"><input type="checkbox" checked={languages.includes(l)} onChange={(e) => setLanguages(e.target.checked ? [...languages, l] : languages.filter((x) => x !== l))} />{l}</label>)}</div></Field>
      <Field label="Schedule (optional, Baku local)" htmlFor="cf-sched"><Input id="cf-sched" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
      <div className="md:col-span-3 flex items-center gap-2"><Button type="submit" size="sm" variant="primary" disabled={busy || languages.length === 0}>Create draft</Button>{error && <span className="text-xs text-danger">{error}</span>}</div>
    </form>
  );
}
