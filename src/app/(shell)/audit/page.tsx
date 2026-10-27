import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { formatBakuDateTime } from "@/server/dates";
import { Badge, Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { appendAudit } from "@/server/modules/audit/audit";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
const VIEWS: [string, string][] = [["all", "All events"], ["blocked", "Blocked actions"], ["overrides", "Attempted overrides / denied"], ["contact", "Contact frequency"], ["complaints", "Complaints / disputes"], ["exports", "Data exports / views"], ["config", "Configuration / model promotions"], ["access", "Access changes"]];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ view?: string; customerId?: string; objectId?: string; actor?: string; page?: string; explain?: string; asOf?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "audit.read")) redirect("/access-denied");
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: Prisma.AuditEventWhereInput = {};
  if (sp.customerId) where.customerId = sp.customerId;
  if (sp.objectId) where.objectId = sp.objectId;
  if (sp.actor) where.actorUserId = sp.actor;
  switch (view) {
    case "blocked": where.blocked = true; break;
    case "overrides": where.OR = [{ action: { startsWith: "access." } }, { action: { contains: "override" } }, { action: { startsWith: "sms.blocked" } }]; break;
    case "contact": where.action = { in: ["interaction.outcome.saved", "interaction.connected", "attempt.failed", "sms.requested", "reservation.created", "work.claimed", "work.claimed.manual"] }; break;
    case "complaints": where.OR = [{ action: { contains: "dispute" } }, { action: { contains: "support" } }, { objectType: "SupportCase" }]; break;
    case "exports": where.action = { in: ["customer.viewed", "export.requested", "audit.export"] }; break;
    case "config": where.OR = [{ objectType: { in: ["Setting", "ModelVersion", "StrategyVersion", "ContactPolicyVersion", "ApprovalRequest", "Template", "Campaign"] } }, { action: { startsWith: "outbound." } }]; break;
    case "access": where.OR = [{ action: { startsWith: "auth." } }, { objectType: "User" }]; break;
  }
  const [rows, total, blockedCount, deniedCount] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.count({ where: { blocked: true } }),
    prisma.auditEvent.count({ where: { action: "access.denied" } }),
  ]);
  const users = await prisma.user.findMany({ select: { id: true, displayName: true } });
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? id ?? "—";
  let explain: { customerId: string; asOf: Date; eligible: boolean; reasons: string[]; nextAllowedAt: Date | null; checks: { label: string; passed: boolean; detail: string | null }[]; policyVersion: string } | null = null;
  if (sp.explain) {
    const asOf = sp.asOf ? new Date(sp.asOf) : await now();
    const r = await evaluateCustomerEligibility(prisma, sp.explain, { channel: "VOICE", now: asOf });
    explain = { customerId: sp.explain, asOf, eligible: r.decision.eligible, reasons: r.decision.reasonCodes.map((c) => REASON_LABELS[c] ?? c), nextAllowedAt: r.decision.nextAllowedAt, checks: r.decision.checks.map((c) => ({ label: REASON_LABELS[c.code] ?? c.code, passed: c.passed, detail: c.detail ?? null })), policyVersion: r.decision.policyVersion };
    await appendAudit(prisma, { actorUserId: user.id, action: "audit.explain_contact", objectType: "Customer", objectId: sp.explain, customerId: sp.explain, changes: { asOf } });
  }
  const link = (p: Record<string, string>) => `/audit?${new URLSearchParams({ view, ...(sp.customerId ? { customerId: sp.customerId } : {}), ...(sp.objectId ? { objectId: sp.objectId } : {}), ...(sp.actor ? { actor: sp.actor } : {}), ...p }).toString()}`;
  return (
    <>
      <PageHeader kicker="S23 / audit & contact-control review" title="Audit & contact-control review" lead="Immutable, append-only events (database trigger blocks updates and deletes). Corrections add new events; normal administrators cannot edit audit history or approve themselves." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Events in view" value={total} />
        <Kpi label="Blocked actions" value={blockedCount} href="/audit?view=blocked" />
        <Kpi label="Access denials" value={deniedCount} href="/audit?view=overrides" />
        <Kpi label="Sensitive views" value={await prisma.auditEvent.count({ where: { action: "customer.viewed" } })} note="Customer record views are audited" />
      </div>
      <form className="mt-3 flex flex-wrap items-end gap-2" action="/audit">
        <input type="hidden" name="view" value={view} />
        <label className="text-xs"><span className="label">Customer id</span><input name="customerId" className="input" defaultValue={sp.customerId ?? ""} placeholder="C-DEMO-001" /></label>
        <label className="text-xs"><span className="label">Object id</span><input name="objectId" className="input" defaultValue={sp.objectId ?? ""} /></label>
        <label className="text-xs"><span className="label">Actor</span><select name="actor" className="select" defaultValue={sp.actor ?? ""}><option value="">Any</option>{users.map((u) => (<option key={u.id} value={u.id}>{u.displayName}</option>))}</select></label>
        <button className="btn btn-secondary" type="submit">Filter</button>
        <span className="mx-2 text-muted">|</span>
        <label className="text-xs"><span className="label">Explain why contacted / not contacted</span><input name="explain" className="input" defaultValue={sp.explain ?? ""} placeholder="Customer id" /></label>
        <label className="text-xs"><span className="label">As of (ISO instant, optional)</span><input name="asOf" className="input" defaultValue={sp.asOf ?? ""} placeholder="2026-10-27T06:00:00Z" /></label>
        <button className="btn btn-primary" type="submit">Explain</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => (<Link key={k} href={link({ view: k })} className="tab" aria-current={view === k ? "page" : undefined} style={view === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>{l}</Link>))}
      </div>
      {explain && (
        <Card className="mt-2" title={`Contact decision for ${explain.customerId} as of ${formatBakuDateTime(explain.asOf, { seconds: true })}`} subtitle={`Policy ${explain.policyVersion} evaluated on current facts and history before the as-of instant`}>
          {explain.eligible ? <Badge tone="success">Would be contactable</Badge> : <Badge tone="warning">Not contactable: {explain.reasons.join(", ")}{explain.nextAllowedAt ? ` · next allowed ${formatBakuDateTime(explain.nextAllowedAt)}` : ""}</Badge>}
          <ul className="mt-2 grid gap-x-4 text-xs md:grid-cols-2">{explain.checks.map((c) => (<li key={c.label} className={c.passed ? "text-muted" : "text-danger"}>{c.passed ? "✓" : "✕"} {c.label}{c.detail ? ` — ${c.detail}` : ""}</li>))}</ul>
        </Card>
      )}
      <Card className="mt-2" padded={false}>
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Time (Baku)</th><th>Actor / service</th><th>Action</th><th>Object</th><th>Customer / case</th><th>Reason</th><th>Changed fields</th><th>Versions / correlation</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.blocked ? "is-selected" : undefined}>
                  <td className="text-xs tabular-nums">{formatBakuDateTime(r.at, { seconds: true })}</td>
                  <td className="text-xs">{r.actorUserId ? nameOf(r.actorUserId) : r.actorService ?? "system"}</td>
                  <td className="text-xs">{r.blocked && <Badge tone="danger">blocked</Badge>} {r.action}</td>
                  <td className="text-xs">{r.objectType} {r.objectId ? <span className="text-muted">{r.objectId.slice(0, 24)}</span> : ""}</td>
                  <td className="text-xs">{r.customerId ? <Link href={`/customers/${r.customerId}`}>{r.customerId}</Link> : "—"}</td>
                  <td className="text-xs">{r.reason ?? "—"}</td>
                  <td className="text-xs text-muted">{r.changes ? JSON.stringify(r.changes).slice(0, 140) : "—"}</td>
                  <td className="text-xs text-muted">{r.versionIds ? JSON.stringify(r.versionIds).slice(0, 80) : ""} {r.correlationId ?? r.sourceEventId ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>Page {page} of {Math.max(1, Math.ceil(total / 50))} · export is scoped and recorded (not enabled in this demo)</span>
          <span className="flex gap-1">{page > 1 && <Link className="btn btn-secondary btn-sm" href={link({ page: String(page - 1) })}>Previous</Link>}{page * 50 < total && <Link className="btn btn-secondary btn-sm" href={link({ page: String(page + 1) })}>Next</Link>}</span>
        </div>
      </Card>
    </>
  );
}
