import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission, ROLE_LABELS } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { homeSummary } from "@/server/modules/home/homeService";
import { Badge, Callout, Card, Kpi, LinkButton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn } from "@/server/money";
import { formatBakuDateTime } from "@/server/dates";
import { currentLocale } from "@/i18n/locale";
import { t } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

/** Role home for leads and heads: decisions waiting, the team now, today's results and portfolio pointers. */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (user.role === "AGENT" || user.role === "SENIOR_AGENT") redirect("/agent");
  if (!hasPermission(user.role, "operations.read")) redirect("/overview");
  const locale = await currentLocale();
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const data = await homeSummary(prisma, user, await now());
  const title = user.role === "TEAM_LEAD" ? tt("home.leadTitle") : user.role === "COLLECTIONS_HEAD" ? tt("home.headTitle") : tt("home.genericTitle");
  const decisions = data.decisions.ptpExceptions.length + data.decisions.deceased.length + data.decisions.stuckCalls.length + data.decisions.failedWrapUps;
  const head = user.role === "COLLECTIONS_HEAD";
  return (
    <>
      <PageHeader kicker={`S01 / ${ROLE_LABELS[user.role]}`} title={title} lead={`${user.displayName} · ${user.teamName ?? "—"}`} actions={<LinkButton href="/operations" variant="primary">{tt("nav.operations")}</LinkButton>} />
      {(data.controls.killSwitch || data.controls.pausedChannels.length > 0) && <Callout tone="danger" className="mb-3">{tt("home.controls")}: {data.controls.killSwitch ? "KILL SWITCH ON · " : ""}{data.controls.pausedChannels.join(", ")}</Callout>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label={tt("home.decisions")} value={decisions} tone={decisions ? "warning" : undefined} />
        <Kpi label={`${tt("home.teamNow")}: ${tt("agent.states.READY")} / ${tt("agent.states.TALKING")}`} value={`${data.team.ready} / ${data.team.talking}`} note={`${data.team.signedIn} signed in · ${data.team.acw} ACW · ${data.team.notReady} ${tt("agent.states.NOT_READY").toLowerCase()}`} href="/operations" />
        <Kpi label="Pending wrap-up" value={data.team.pendingWrapUp} tone={data.team.pendingWrapUp ? "warning" : undefined} href="/operations" />
        <Kpi label="Overdue callbacks" value={data.team.overdueCallbacks} tone={data.team.overdueCallbacks ? "warning" : undefined} href="/tasks?type=CALLBACK" />
        <Kpi label="Eligible backlog" value={data.team.eligibleBacklog} href="/work-queue?queue=all&eligibility=ELIGIBLE" />
        <Kpi label={`${tt("home.today")}: RPC / PTP`} value={`${data.today.rpc} / ${data.today.promises}`} note={`${data.today.attempts} attempts`} href="/analytics?tab=agents" />
        <Kpi label={`${tt("home.today")}: attributed cash`} value={formatAzn(data.today.attributedCash, { withCurrency: false })} note={`AZN · ${data.today.attributionRule}`} href="/operations" />
        <Kpi label="Critical exceptions" value={data.team.criticalExceptions} tone={data.team.criticalExceptions ? "danger" : undefined} href="/exceptions" />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[3fr_2fr]">
        <Card title={tt("home.decisions")} subtitle="Promise-date exceptions, deceased verifications, calls the provider did not end, failed wrap-ups">
          {decisions === 0 ? (
            <p className="text-sm text-muted">{tt("home.nothing")}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.decisions.ptpExceptions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="warning">PTP exception</Badge>
                  <span className="flex-1">{a.title}</span>
                  <span className="text-xs text-muted">{a.maker} · {formatBakuDateTime(a.createdAt)}</span>
                  <Link className="btn btn-secondary btn-sm" href={`/approvals?status=pending&type=PTP_EXCEPTION&selected=${a.id}`}>{a.canDecide ? "Decide" : tt("common.open")}</Link>
                </li>
              ))}
              {data.decisions.deceased.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="danger">Vəfat barədə məlumat</Badge>
                  <span className="flex-1"><Link href={`/customers/${e.customerId}`}>{e.customerName}</Link> · {e.title}</span>
                  <span className="text-xs text-muted">SLA {e.slaDueAt ? formatBakuDateTime(e.slaDueAt) : "—"}</span>
                  <Link className="btn btn-secondary btn-sm" href={`/exceptions?status=open&type=DECEASED_VERIFICATION&selected=${e.id}`}>Verify</Link>
                </li>
              ))}
              {data.decisions.stuckCalls.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="danger">{e.type.replace(/_/g, " ").toLowerCase()}</Badge>
                  <span className="flex-1">{e.customerName} · {e.title}</span>
                  <span className="text-xs text-muted">{formatBakuDateTime(e.lastSeenAt)}</span>
                  <Link className="btn btn-secondary btn-sm" href="/operations">Operations</Link>
                </li>
              ))}
              {data.decisions.failedWrapUps > 0 && (
                <li className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="warning">Wrap-up failed</Badge>
                  <span className="flex-1">{data.decisions.failedWrapUps} interaction(s) wait for a provider acknowledgment</span>
                  <Link className="btn btn-secondary btn-sm" href="/operations">Assist</Link>
                </li>
              )}
            </ul>
          )}
        </Card>
        <div className="space-y-3">
          {head && (
            <Card title={tt("home.portfolio")} subtitle="Live operational totals; cohort performance lives in Analytics">
              <div className="grid grid-cols-2 gap-3">
                <Kpi label="Open cases" value={data.portfolio.overdueCustomers} href="/work-queue?queue=all" />
                <Kpi label="Overdue now" value={formatAzn(data.portfolio.overdueAmount, { withCurrency: false })} note="AZN" href="/overview" />
                <Kpi label="Received today" value={formatAzn(data.portfolio.receivedToday, { withCurrency: false })} note="AZN · posted" href="/payments" />
                <Kpi label="PTPs due today" value={data.portfolio.ptpDueToday} href="/promises?view=due-today" />
              </div>
            </Card>
          )}
          <Card title={tt("home.approvals")}>
            {data.approvals.length === 0 ? (
              <p className="text-sm text-muted">{tt("common.none")}</p>
            ) : (
              <ul className="text-sm">
                {data.approvals.map((a) => (
                  <li key={a.type} className="flex justify-between py-1">
                    <Link href={`/approvals?status=pending&type=${a.type}`}>{a.label}</Link>
                    <span className="num font-medium">{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={tt("home.links")}>
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-secondary btn-sm" href="/operations">{tt("nav.operations")}</Link>
              <Link className="btn btn-secondary btn-sm" href="/work-queue?queue=all">{tt("nav.workQueue")}</Link>
              <Link className="btn btn-secondary btn-sm" href="/promises">{tt("nav.promises")}</Link>
              <Link className="btn btn-secondary btn-sm" href="/tasks">{tt("nav.tasks")}</Link>
              <Link className="btn btn-secondary btn-sm" href="/exceptions">{tt("nav.exceptions")}</Link>
              <Link className="btn btn-secondary btn-sm" href="/analytics">{tt("nav.analytics")}</Link>
              {head && <Link className="btn btn-secondary btn-sm" href="/approvals">{tt("nav.approvals")}</Link>}
              {head && <Link className="btn btn-secondary btn-sm" href="/settings">{tt("nav.settings")}</Link>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
