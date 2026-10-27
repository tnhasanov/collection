import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { ALLOWED_VARIABLES, smsInfo, templateText, validateTemplateText } from "@/server/modules/templates/templateService";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { DRAFT: "neutral", TESTED: "info", APPROVED: "brand", ACTIVE: "success", RETIRED: "neutral", REJECTED: "danger" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ id?: string; kind?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "template.manage") && !hasPermission(user.role, "strategy.read")) redirect("/access-denied");
  const sp = await searchParams;
  const templates = await prisma.template.findMany({ where: sp.kind ? { kind: sp.kind as "SMS" } : {}, orderBy: [{ kind: "asc" }, { code: "asc" }, { language: "asc" }, { createdAt: "desc" }] });
  const selected = templates.find((t) => t.id === sp.id) ?? templates[0] ?? null;
  const approvals = await prisma.approvalRequest.findMany({ where: { objectType: "Template", status: { in: ["PENDING", "INFO_REQUESTED"] } }, select: { objectId: true, id: true, status: true } });
  const text = selected ? templateText(selected.body) : "";
  const validation = selected ? validateTemplateText(text, selected.kind) : null;
  const sms = selected && (selected.kind === "SMS" || selected.kind === "PTP_REMINDER") ? smsInfo(text) : null;
  const canManage = hasPermission(user.role, "template.manage");
  return (
    <>
      <PageHeader kicker="S16 / templates and scripts" title="Templates & scripts" lead="Versioned AZ/EN/RU SMS templates, agent scripts, PTP reminders and support scripts. Variables are allow-listed; previews use synthetic customers; activation is four-eyes via S11. No real message leaves the demo." />
      <div className="flex flex-wrap gap-1 text-sm">{["", "SMS", "PTP_REMINDER", "AGENT_SCRIPT", "SUPPORT_SCRIPT", "THIRD_PARTY_SCRIPT"].map((k) => <a key={k} className={`tab ${(sp.kind ?? "") === k ? "tab-active" : ""}`} href={`/templates${k ? `?kind=${k}` : ""}`}>{k ? k.replace(/_/g, " ").toLowerCase() : "all"}</a>)}</div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_560px]">
        <Card title="Versions" padded={false}>
          <table className="table-dense"><thead><tr><th>Code</th><th>Version</th><th>Kind</th><th>Lang</th><th>Status</th><th>Title</th><th>Effective</th><th>Approved by</th></tr></thead>
            <tbody>{templates.map((t) => <tr key={t.id} className={selected?.id === t.id ? "bg-brand-light" : ""}><td><a href={`/templates?id=${t.id}${sp.kind ? `&kind=${sp.kind}` : ""}`}>{t.code}</a></td><td>{t.version}</td><td className="text-xs">{t.kind.replace(/_/g, " ").toLowerCase()}</td><td>{t.language}</td><td><Badge tone={TONE[t.status] ?? "neutral"}>{t.status.toLowerCase()}</Badge>{approvals.find((a) => a.objectId === t.id) && <span className="ml-1 text-xs text-info">approval open</span>}</td><td className="text-xs">{t.title}</td><td className="text-xs">{t.effectiveFrom ? fmtDateTime(t.effectiveFrom) : "—"}</td><td className="text-xs">{t.approvedBy ?? "—"}</td></tr>)}</tbody></table>
        </Card>
        {selected ? (
          <Card title={`${selected.code} ${selected.version} · ${selected.language}`} subtitle={selected.title} actions={<Badge tone={TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase()}</Badge>}>
            <Dl items={[
              { label: "Kind / channels", value: `${selected.kind.replace(/_/g, " ").toLowerCase()} · ${selected.channelScope.join(", ")}` },
              { label: "Variables", value: selected.variables.length ? selected.variables.map((v) => `{{${v}}}`).join(" ") : "—" },
              { label: "Fallback language", value: String((selected.body as { fallbackLanguage?: string | null }).fallbackLanguage ?? "AZ (policy default)") },
              { label: "Validation", value: validation ? (validation.ok ? <Badge tone="success">passes</Badge> : <Badge tone="danger">errors</Badge>) : "—" },
              ...(sms ? [{ label: "SMS", value: `${sms.length} chars · ${sms.encoding} · ${sms.segments} segment(s) (${sms.singleLimit}/${sms.multipartLimit}) · ${sms.note}` }] : []),
            ]} />
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 text-xs">{text}</pre>
            {validation && validation.issues.length > 0 && <ul className="mt-1 text-xs">{validation.issues.map((i, idx) => <li key={idx} className={i.severity === "ERROR" ? "text-danger" : "text-warning"}>{i.severity}: {i.message}</li>)}</ul>}
            {canManage && <div className="mt-3"><TemplateEditor template={{ id: selected.id, code: selected.code, version: selected.version, kind: selected.kind, language: selected.language, title: selected.title, text, channelScope: selected.channelScope, status: selected.status }} allowed={Object.entries(ALLOWED_VARIABLES).map(([k, v]) => ({ name: k, description: v.description }))} canSubmit={hasPermission(user.role, "approval.request")} /></div>}
          </Card>
        ) : <Card><p className="text-sm text-muted">No template selected.</p></Card>}
      </div>
      <Callout tone="info" className="mt-3">Restricted content (threats, legal/police wording) is rejected by validation. Azerbaijani and Cyrillic characters switch SMS to UCS-2 (70 characters per segment); the segment estimate follows the configured provider rules and is an estimate until a gateway contract is supplied.</Callout>
    </>
  );
}
