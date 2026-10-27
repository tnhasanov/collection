import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { Badge, Callout, Card, Dl } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { modelMonitoring } from "@/server/modules/monitoring/monitoringService";

export const dynamic = "force-dynamic";

export default async function ModelMonitoringPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "model.read")) redirect("/access-denied");
  const m = await modelMonitoring(prisma, await now());
  const unavailable = (label: string, reason: string) => <Card title={label}><p className="text-sm"><Badge tone="neutral">unavailable</Badge> <span className="text-muted">{reason}</span></p></Card>;
  return (
    <>
      <PageHeader kicker="S19 / model monitoring and validation" title="Model monitoring" lead={`As of ${fmtDateTime(m.asOf, true)}. Live panels show only what the data supports; insufficient samples are shown as unavailable, never as fabricated statistics.`} />
      <Callout tone="info">Versions with every result: model {m.versions.model} · features {m.versions.features} · strategy {m.versions.strategy} · contact policy {m.versions.policy} · run {m.versions.run}.</Callout>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Population coverage (DPD 4–10)" subtitle="Monthly feature snapshots feeding the draft tree">
          <Dl items={[
            { label: "Population", value: m.coverage.population4to10 },
            { label: "With features / missing / stale (>45d)", value: `${m.coverage.withFeatures} / ${m.coverage.missingFeatures} / ${m.coverage.staleFeatures}` },
            { label: "Scored / unscored", value: `${m.coverage.scored} / ${m.coverage.unscored} (unscored rate ${m.coverage.unscoredRate ? `${(Number(m.coverage.unscoredRate) * 100).toFixed(1)}%` : "n/a"})` },
            { label: "Unscored reasons", value: Object.entries(m.coverage.unscoredReasons).map(([k, v]) => `${k} ${v}`).join(" · ") || "—" },
            { label: "Feature months loaded", value: m.featureMonths.map((f) => `${f.month} (${f.snapshots})`).join(" · ") || "none" },
          ]} />
        </Card>
        <Card title="Class distribution (live snapshot)" subtitle="Assigned probabilities from the draft rule table; no development reference distribution was supplied">
          <table className="table-dense"><thead><tr><th>Class</th><th className="text-right">p(roll)</th><th className="text-right">Customers</th><th className="text-right">Share</th></tr></thead>
            <tbody>{m.classDistribution.map((c) => <tr key={c.riskClass}><td>{c.riskClass}</td><td className="text-right">{c.probability}</td><td className="text-right">{c.customers}</td><td className="text-right">{c.share ? `${(Number(c.share) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody></table>
        </Card>
        {unavailable("Observed roll rates vs assigned probabilities", m.observedVsAssigned.reason)}
        {unavailable("Ranking performance (GINI / AUC) and calibration", m.rankingPerformance.reason)}
        {m.drift.available ? <Card title="Drift (PSI)"><p className="text-sm text-muted">{m.drift.reason}</p></Card> : unavailable("Drift (population stability)", m.drift.reason)}
        <Card title="Overrides and external inputs">
          <Dl items={[{ label: "Outcome corrections", value: m.overrides.outcomeCorrections }, { label: "Work reassignments", value: m.overrides.reassignments }, { label: "Externally supplied scores (retained, not routed)", value: m.overrides.externalScores }]} />
        </Card>
        <Card title="Model documentation (historical, not live)" subtitle="From the provider deck; belongs to the model card">
          <Dl items={[{ label: "Development GINI", value: m.documentation.developmentGini }, { label: "Out-of-time GINI", value: m.documentation.outOfTimeGini }]} />
          <p className="mt-2 text-xs text-muted">{m.documentation.note}</p>
        </Card>
      </div>
      <Callout tone="warning" className="mt-3">Monthly target construction (deterioration to over 30 DPD within the following month) and matured observation windows are preserved; no future data leaks into a live period. Development, out-of-time and live periods stay separate once labels exist.</Callout>
    </>
  );
}
