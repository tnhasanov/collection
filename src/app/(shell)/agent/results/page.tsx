import { Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { agentMetrics } from "@/server/modules/agent/agentDesktopService";
import { formatAzn, formatPercent } from "@/server/money";
import { bakuBusinessDate, formatDate, formatDuration } from "@/server/dates";
import { at } from "@/i18n/agentText";

export const dynamic = "force-dynamic";

/** Personal results for today (Asia/Baku business day); same definitions as supervisor reporting (METRIC_DICTIONARY.md). */
export default async function AgentResultsPage() {
  const { user, now, locale } = await loadAgentPage();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const m = await agentMetrics(prisma, user.id, now);
  const pct = (v: number | null) => (v === null ? "—" : formatPercent(v));
  return (
    <>
      <PageHeader kicker={A("dash.title")} title={A("res.title")} lead={A("res.period", { date: formatDate(bakuBusinessDate(now), locale) })} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="results-kpis">
        <Kpi label={A("res.attempts")} value={m.attempts} note={A("res.attemptsNote")} />
        <Kpi label={A("res.unique")} value={m.uniqueCustomers} note={A("res.uniqueNote")} />
        <Kpi label={A("res.rpc")} value={m.rpc} note={A("res.rpcRate", { pct: pct(m.rpcRateAttempt) })} />
        <Kpi label={A("res.promises")} value={m.promises} note={A("res.promised", { amount: formatAzn(m.promisedAmount) })} />
        <Kpi label={A("res.kept")} value={pct(m.keptRate)} note={A("res.keptNote", { n: m.keptNumerator, d: m.keptDenominator })} />
        <Kpi label={A("res.cash")} value={formatAzn(m.attributedCash)} note={A("res.cashNote")} />
        <Kpi label={A("res.talk")} value={`${formatDuration(m.avgTalkSeconds)} / ${formatDuration(m.avgAcwSeconds)}`} note={A("res.talkNote")} />
        <Kpi label={A("res.quality")} value="—" note={A("res.qualityNote")} />
      </div>
      <p className="mt-3 text-sm text-muted">{A("res.scope")}</p>
    </>
  );
}
