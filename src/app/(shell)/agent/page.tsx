import Link from "next/link";
import { Kpi, LinkButton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { formatAzn, formatPercent } from "@/server/money";
import { agentFollowUps } from "@/server/modules/agent/followUpService";
import { at } from "@/i18n/agentText";
import { t } from "@/i18n/dictionaries";
import { CompactFollowUp } from "@/components/agent/FollowUpParts";
import { modeOf } from "@/components/agent/mode";
import { loadAgentPage } from "./loader";

export const dynamic = "force-dynamic";

const ATTENTION = ["BROKEN", "PENDING_RECONCILIATION", "PARTIALLY_PAID"];

/**
 * The agent's personal dashboard: today's workload, callbacks that are due (with the restriction that applies now),
 * promises that need attention and a few personal results. Calls themselves happen in /agent/call; an active call is
 * shown here as a way back, never by replacing this page.
 */
export default async function AgentDashboardPage() {
  const { user, initial, locale, now } = await loadAgentPage();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const items = await agentFollowUps(prisma, user.id, now);
  const m = initial.metrics!;
  const mode = modeOf(initial);
  const inCall = mode === "live" || mode === "dialing" || mode === "recovery";
  const callbacks = items.filter((i) => i.kind === "CALLBACK" && (i.due === "OVERDUE" || i.due === "TODAY"));
  const promises = items.filter((i) => i.kind === "PROMISE" && (i.due === "OVERDUE" || i.due === "TODAY" || ATTENTION.includes(i.status)));
  const promisesToday = items.filter((i) => i.kind === "PROMISE" && i.due === "TODAY").length;
  const overdue = items.filter((i) => i.due === "OVERDUE").length;
  const state = initial.session?.confirmedState ?? "OFFLINE";

  return (
    <>
      <PageHeader
        kicker={user.displayName}
        title={A("dash.title")}
        lead={A("dash.lead")}
        actions={
          <>
            <span className="text-sm text-muted" data-testid="dash-state">{A("dash.state", { state: t(locale, `agent.states.${state}`) })}</span>
            <LinkButton href="/agent/call" variant="primary" data-testid="dash-open-call">
              {inCall || mode === "acw" ? A("dash.backToCall") : A("dash.ready")}
            </LinkButton>
          </>
        }
      />

      {m.unresolvedWrapUps > 0 && mode !== "acw" && mode !== "wrapup" && <p className="callout callout-warning mb-4 text-sm">{A("dash.unresolved", { n: m.unresolvedWrapUps })}</p>}

      <section aria-label={A("dash.workload")} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dash-workload">
        <Kpi label={A("dash.kpiCallbacks")} value={callbacks.length} href="/agent/follow-ups?tab=callbacks" tone={callbacks.some((c) => c.due === "OVERDUE") ? "warning" : undefined} />
        <Kpi label={A("dash.kpiPromises")} value={promisesToday} href="/agent/follow-ups?tab=promises" />
        <Kpi label={A("dash.kpiOverdue")} value={overdue} href="/agent/follow-ups" tone={overdue > 0 ? "danger" : undefined} />
        <Kpi label={A("dash.kpiAttempts")} value={m.attempts} note={`${A("dash.kpiRpc")}: ${m.rpc}`} />
      </section>

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <section className="panel" aria-labelledby="dash-callbacks">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="dash-callbacks" className="text-base font-semibold">{A("dash.callbacksDue")}</h2>
            <Link href="/agent/follow-ups?tab=callbacks" className="text-sm">{A("dash.allFollowUps")} →</Link>
          </div>
          {callbacks.length === 0 ? <p className="px-4 py-3 text-sm text-muted">{A("dash.none")}</p> : <ul className="divide-y divide-line" data-testid="dash-callbacks">{callbacks.slice(0, 5).map((i) => <CompactFollowUp key={i.key} item={i} locale={locale} />)}</ul>}
        </section>
        <section className="panel" aria-labelledby="dash-promises">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="dash-promises" className="text-base font-semibold">{A("dash.promisesAttention")}</h2>
            <Link href="/agent/follow-ups?tab=promises" className="text-sm">{A("dash.allFollowUps")} →</Link>
          </div>
          {promises.length === 0 ? <p className="px-4 py-3 text-sm text-muted">{A("dash.none")}</p> : <ul className="divide-y divide-line" data-testid="dash-promises">{promises.slice(0, 5).map((i) => <CompactFollowUp key={i.key} item={i} locale={locale} />)}</ul>}
        </section>
      </div>

      <section className="panel" aria-labelledby="dash-results" data-testid="dash-results">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="dash-results" className="text-base font-semibold">{A("dash.performance")}</h2>
          <Link href="/agent/results" className="text-sm">{A("dash.allResults")} →</Link>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 text-sm lg:grid-cols-4">
          <div><dt className="text-[13px] text-muted">{A("dash.kpiRpc")}</dt><dd className="text-lg font-semibold tabular-nums">{m.rpc}</dd></div>
          <div><dt className="text-[13px] text-muted">{A("dash.kpiPromisesMade")}</dt><dd className="text-lg font-semibold tabular-nums">{m.promises} <span className="text-sm font-normal text-muted">· {formatAzn(m.promisedAmount)}</span></dd></div>
          <div><dt className="text-[13px] text-muted">{A("dash.kpiKept")}</dt><dd className="text-lg font-semibold tabular-nums">{m.keptRate === null ? "—" : formatPercent(m.keptRate)}</dd></div>
          <div><dt className="text-[13px] text-muted">{A("dash.kpiCash")}</dt><dd className="text-lg font-semibold tabular-nums">{formatAzn(m.attributedCash)}</dd></div>
        </dl>
      </section>
    </>
  );
}
