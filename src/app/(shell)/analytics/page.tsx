import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { Badge, Callout, Card, LinkButton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtAzn, fmtDateTime } from "@/lib/format";
import { analyticsTab, ANALYTICS_TABS, type AnalyticsTab } from "@/server/modules/analytics/analyticsService";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "analytics.read")) redirect("/access-denied");
  const sp = await searchParams;
  const tab = (ANALYTICS_TABS.some((t) => t.key === sp.tab) ? sp.tab : "dpd") as AnalyticsTab;
  const filters = { from: sp.from, to: sp.to, branch: sp.branch || undefined, segment: sp.segment || undefined, riskClass: sp.riskClass ? Number(sp.riskClass) : undefined, bucket: sp.bucket ? Number(sp.bucket) : undefined, owner: sp.owner || undefined, strategyVersionId: sp.strategyVersionId || undefined, arm: sp.arm || undefined };
  const t = await now();
  const result = await analyticsTab(prisma, tab, filters, t);
  const [branches, owners, strategies] = await Promise.all([
    prisma.customer.findMany({ distinct: ["branch"], select: { branch: true }, orderBy: { branch: "asc" } }),
    prisma.user.findMany({ where: { role: { in: ["AGENT", "SENIOR_AGENT", "TEAM_LEAD"] } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    prisma.strategyVersion.findMany({ select: { id: true, code: true, version: true } }),
  ]);
  const qs = new URLSearchParams(Object.entries({ ...sp, tab }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader kicker="S18 / portfolio and collection analytics" title="Analytics" lead={`As of ${fmtDateTime(result.asOf, true)} (app clock). Counts and exposure are shown separately; every ratio names its numerator, denominator, scope and maturation.`} actions={hasPermission(user.role, "export.scoped") ? <LinkButton size="sm" href={`/api/analytics/export?${qs}`}>Export CSV (as-of + definitions)</LinkButton> : null} />
      <div className="flex flex-wrap gap-1 border-b border-line pb-1" role="tablist">
        {ANALYTICS_TABS.map((x) => <a key={x.key} role="tab" aria-selected={x.key === tab} className={`tab ${x.key === tab ? "tab-active" : ""}`} href={`/analytics?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), tab: x.key }).toString()}`}>{x.label}</a>)}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card title="Filters"><AnalyticsFilters tab={tab} values={sp} branches={branches.map((b) => b.branch)} owners={owners} strategies={strategies} /></Card>
          <Card title="Data freshness">
            <ul className="space-y-1 text-xs">{result.freshness.map((f) => <li key={f.source} className="flex items-center justify-between gap-2"><span>{f.source}</span><span><Badge tone={f.health === "HEALTHY" ? "success" : f.health === "DEGRADED" ? "warning" : f.health === "DOWN" ? "danger" : "neutral"}>{f.health.toLowerCase()}</Badge> {f.asOf ? fmtDateTime(f.asOf) : "—"}</span></li>)}</ul>
          </Card>
          {result.ratios.length > 0 && (
            <Card title="Definitions" subtitle="Metric dictionary (versioned)">
              <ul className="space-y-2 text-xs">{result.ratios.map((r) => <li key={r.code}><strong>{r.name}</strong> <span className="text-muted">v{r.version}</span><br />Numerator: {r.numerator}<br />Denominator: {r.denominator}<br />Scope: {r.scope} · unit {r.unit}</li>)}</ul>
            </Card>
          )}
        </div>
        <Card title={ANALYTICS_TABS.find((x) => x.key === tab)!.label} subtitle={result.notes[0]}>
          {result.rows.length === 0 ? <p className="text-sm text-muted">No data for the selected filters.</p> : (
            <div className="overflow-auto">
              <table className="table-dense">
                <thead><tr>{result.columns.map((c) => <th key={c.key} className={c.kind === "count" || c.kind === "money" || c.kind === "ratio" ? "text-right" : ""}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>{result.columns.map((c) => { const v = r[c.key]; return <td key={c.key} className={c.kind === "count" || c.kind === "money" || c.kind === "ratio" ? "text-right tabular-nums" : ""}>{v === null || v === undefined ? "—" : c.kind === "link" ? <a href={String(v)}>open</a> : c.kind === "money" && /^-?\d+(\.\d+)?$/.test(String(v)) ? fmtAzn(String(v), false) : c.kind === "ratio" && /^\d*\.?\d+$/.test(String(v)) ? `${(Number(v) * 100).toFixed(1)}%` : String(v)}</td>; })}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.notes.slice(1).map((n, i) => <p key={i} className="mt-2 text-xs text-muted">{n}</p>)}
          {result.drill.length > 0 && <p className="mt-2 text-xs">Drill: {result.drill.map((d) => <a key={d.href} className="mr-3" href={d.href}>{d.label}</a>)}</p>}
          <Callout tone="info" className="mt-3">Unadjusted differences between strategies, arms, agents or periods are not treatment uplift. Causal claims need a designed comparison with matured observations (S19).</Callout>
        </Card>
      </div>
    </>
  );
}
