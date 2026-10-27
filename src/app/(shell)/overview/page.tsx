import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { overviewMetrics } from "@/server/modules/analytics/overviewService";
import { Badge, Card, Kpi, LinkButton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn } from "@/server/money";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { ACTION_LABELS, type ActionCode } from "@/server/modules/decisions/treatment";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { redirect } from "next/navigation";
import { hasPermission } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "analytics.read")) redirect("/access-denied");
  const m = await overviewMetrics(prisma, await now());
  const maxCustomers = Math.max(1, ...m.distribution.map((d) => d.customers));
  return (
    <>
      <PageHeader kicker="S02 / collections overview" title="Collections overview" lead={`Business date ${formatDate(m.businessDate)} · live operational metrics are separate from fixed-cohort performance (see Analytics).`} actions={<LinkButton href="/work-queue" variant="primary">View work queue</LinkButton>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Overdue customers" value={m.kpis.overdueCustomers} note={`Across ${m.kpis.overdueLoanAccounts} loan accounts`} href="/work-queue?queue=all" />
        <Kpi label="Overdue now" value={formatAzn(m.kpis.overdueAmount, { withCurrency: false })} note="AZN - verified source balances" href="/work-queue?queue=all" />
        <Kpi label="Outstanding principal (overdue customers)" value={formatAzn(m.kpis.overduePrincipal, { withCurrency: false })} note="AZN - counted once per customer" href="/analytics?tab=dpd" />
        <Kpi label="Eligible to call now" value={m.kpis.callableNow} note="Restrictions already applied" href="/work-queue?eligibility=ELIGIBLE" />
        <Kpi label="Received today" value={formatAzn(m.kpis.receivedToday, { withCurrency: false })} note="AZN - net of posted reversals" href="/payments" />
        <Kpi label="PTPs due today" value={m.kpis.ptpDueToday} note="Commitments reaching their deadline" href="/promises?view=due-today" />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title="Delinquency distribution" subtitle="Customer count and principal exposure by operational DPD band (one customer counted once, by max DPD)">
          <ul className="space-y-1.5">
            {m.distribution.map((d) => (
              <li key={d.segment} className="grid grid-cols-[90px_1fr_60px_110px] items-center gap-2 text-sm">
                <span className="text-muted">{d.label}</span>
                <div className="h-3 rounded bg-canvas" role="img" aria-label={`${d.label}: ${d.customers} customers`}>
                  <div className="h-3 rounded bg-brand" style={{ width: `${Math.round((d.customers / maxCustomers) * 100)}%` }} />
                </div>
                <span className="num font-bold">{d.customers}</span>
                <span className="num text-xs text-muted">{formatAzn(d.exposure, { withCurrency: false })}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Daily execution" subtitle="Distinguish attempts, unique customers and verified conversations">
          <dl className="dl-grid">
            <dt>Attempts today</dt>
            <dd>{m.execution.attemptsToday}</dd>
            <dt>Verified RPC today</dt>
            <dd>{m.execution.rpcToday}</dd>
            <dt>Agents signed in</dt>
            <dd>{m.execution.agentsOnline}</dd>
            <dt>Planning reference</dt>
            <dd>{m.execution.planningReference} successful contacts/day (source assumption, not attempts)</dd>
            <dt>Critical exceptions</dt>
            <dd>
              <Link href="/exceptions">{m.execution.criticalExceptions}</Link>
            </dd>
            <dt>Unresolved wrap-ups</dt>
            <dd>{m.execution.unresolvedWrapUps}</dd>
            <dt>Stale feeds</dt>
            <dd>{m.execution.staleFeeds.length ? m.execution.staleFeeds.join(", ") : "None"}</dd>
            <dt>Decision snapshot</dt>
            <dd>{m.execution.decisionRun ? `${formatDate(m.execution.decisionRun.businessDate)} · ${m.execution.decisionRun.population} customers · ${m.execution.decisionRun.scored} scored · ${formatBakuDateTime(m.execution.decisionRun.finishedAt)}` : "None"}</dd>
          </dl>
        </Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title="Priority customers - common ERA ranking" subtitle="Highest-priority customers; eligibility is shown, never bypassed" padded={false}>
          <table className="table-dense">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Customer</th>
                <th className="num">DPD</th>
                <th className="num">Overdue AZN</th>
                <th className="num">ERA AZN</th>
                <th>Bucket</th>
                <th>Next action</th>
                <th>Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {m.topPriority.map((t) => (
                <tr key={t.customerId}>
                  <td>{t.rank}</td>
                  <td>
                    <Link href={`/customers/${t.customerId}`}>{t.name}</Link>
                    <div className="text-xs text-muted">{t.customerId}</div>
                  </td>
                  <td className="num">{t.dpd}</td>
                  <td className="num">{formatAzn(t.overdue, { withCurrency: false })}</td>
                  <td className="num">{formatAzn(t.era, { withCurrency: false })}</td>
                  <td>{t.bucket ?? "—"}</td>
                  <td>{ACTION_LABELS[t.action as ActionCode] ?? t.action}</td>
                  <td>{t.status === "ELIGIBLE" ? <Badge tone="success">Eligible now</Badge> : t.status ? <Badge tone="warning">{t.reasons.map((r) => REASON_LABELS[r] ?? r).join(", ") || t.status}</Badge> : <Badge tone="neutral">No voice item</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Broken promises" subtitle="Follow-up subject to restrictions">
          {m.brokenPromises.length === 0 ? (
            <p className="text-sm text-muted">None</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {m.brokenPromises.map((p) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <Link href={`/customers/${p.customerId}`}>{p.name}</Link>
                  <span className="text-muted">
                    {formatAzn(p.amount)} · {formatDate(p.deadline)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
