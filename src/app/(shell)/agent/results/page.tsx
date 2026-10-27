import { Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { agentMetrics } from "@/server/modules/agent/agentDesktopService";
import { formatAzn, formatPercent } from "@/server/money";
import { formatDuration } from "@/server/dates";

export const dynamic = "force-dynamic";

export default async function AgentResultsPage() {
  const { user, now } = await loadAgentPage();
  const m = await agentMetrics(prisma, user.id, now);
  return (
    <>
      <PageHeader kicker="S18 / my results" title="My results" lead={`${m.period}. Definitions follow the metric dictionary; attributed cash is not incremental impact.`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Attempts" value={m.attempts} note="Recorded dial attempts" />
        <Kpi label="Unique customers" value={m.uniqueCustomers} note="Distinct customers attempted" />
        <Kpi label="Verified RPC" value={m.rpc} note={`Attempt-based RPC rate ${formatPercent(m.rpcRateAttempt)}`} />
        <Kpi label="Promises" value={m.promises} note={`${formatAzn(m.promisedAmount)} promised`} />
        <Kpi label="Kept PTP rate (30d matured)" value={m.keptRate === null ? "n/a" : formatPercent(m.keptRate)} note={`${m.keptNumerator}/${m.keptDenominator}; not-yet-due excluded`} />
        <Kpi label="Attributed verified cash" value={formatAzn(m.attributedCash)} note="Demo attribution rule" />
        <Kpi label="Avg talk / ACW" value={`${formatDuration(m.avgTalkSeconds)} / ${formatDuration(m.avgAcwSeconds)}`} note="System-derived" />
        <Kpi label="Quality" value="n/a" note="No QA feed" />
      </div>
      <Card title="Scope" className="mt-3">
        <p className="text-sm text-muted">Only your own interactions, promises and attributed payments are included. Supervisor reporting uses the same definitions (see METRIC_DICTIONARY.md).</p>
      </Card>
    </>
  );
}
