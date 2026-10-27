import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtAzn, fmtDateTime } from "@/lib/format";
import { campaignAudience, campaignCounters } from "@/server/modules/campaigns/campaignService";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignForm } from "@/components/campaigns/CampaignForm";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { DRAFT: "neutral", REVIEWED: "info", SCHEDULED: "brand", RUNNING: "success", PAUSED: "warning", COMPLETED: "neutral", FAILED: "danger", CANCELLED: "danger" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "campaign.manage")) redirect("/access-denied");
  const sp = await searchParams;
  const t = await now();
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { template: { select: { code: true, version: true, status: true, language: true } }, strategyVersion: { select: { version: true, status: true } }, _count: { select: { messages: true } } } });
  const selected = campaigns.find((c) => c.id === sp.id) ?? campaigns.find((c) => c.kind === "SMS") ?? campaigns[0] ?? null;
  const audience = selected && selected.kind === "SMS" ? await campaignAudience(prisma, selected.id, t, 150) : null;
  const counters = selected ? await campaignCounters(prisma, selected.id) : null;
  const approval = selected ? await prisma.approvalRequest.findFirst({ where: { objectType: "Campaign", objectId: selected.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } }) : null;
  const templates = await prisma.template.findMany({ where: { kind: { in: ["SMS", "PTP_REMINDER"] } }, select: { id: true, code: true, version: true, language: true, status: true }, orderBy: [{ code: "asc" }, { language: "asc" }] });
  const strategies = await prisma.strategyVersion.findMany({ select: { id: true, code: true, version: true, status: true } });
  return (
    <>
      <PageHeader kicker="S15 / campaign manager" title="Campaigns" lead="SMS campaigns built from approved strategy populations. Audience, exclusions, amount freshness, template version, language, deduplication, cost estimate, schedule and approver are inspected before release; dispatch re-checks balance and policy per message." />
      <Callout tone="warning">Demo send writes to the local outbound log only (no gateway). Sent / delivered / failed / unknown are tracked separately; pause or cancel stops remaining messages before dispatch.</Callout>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="space-y-3">
          <Card title="Campaigns" padded={false}>
            <table className="table-dense"><thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Status</th><th>Strategy</th><th>Template</th><th>Languages</th><th>Schedule</th><th className="text-right">Messages</th><th className="text-right">Cost est.</th></tr></thead>
              <tbody>{campaigns.map((c) => <tr key={c.id} className={selected?.id === c.id ? "bg-brand-light" : ""}><td><a href={`/campaigns?id=${c.id}`}>{c.code}</a></td><td className="text-xs">{c.name}</td><td className="text-xs">{c.kind}</td><td><Badge tone={TONE[c.status] ?? "neutral"}>{c.status.toLowerCase()}</Badge></td><td className="text-xs">{c.strategyVersion ? `${c.strategyVersion.version} (${c.strategyVersion.status.toLowerCase()})` : "—"}</td><td className="text-xs">{c.template ? `${c.template.code} ${c.template.version} ${c.template.language} (${c.template.status.toLowerCase()})` : "—"}</td><td className="text-xs">{c.languages.join("/")}</td><td className="text-xs">{c.scheduledAt ? fmtDateTime(c.scheduledAt) : "immediate"}</td><td className="text-right">{c._count.messages}</td><td className="text-right">{c.costEstimate ? fmtAzn(c.costEstimate.toString()) : "—"}</td></tr>)}</tbody></table>
          </Card>
          <Card title="New SMS campaign" subtitle="Draft → reviewed (audience snapshot) → release approval (S11) → scheduled/running"><CampaignForm templates={templates} strategies={strategies} /></Card>
        </div>
        {selected ? (
          <Card title={`${selected.code}`} subtitle={selected.name} actions={<Badge tone={TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase()}</Badge>}>
            <Dl items={[
              { label: "Approver", value: selected.approverUserId ?? "—" },
              { label: "Approval", value: approval ? `${approval.id} · ${approval.status.toLowerCase().replace("_", " ")}` : "—" },
              { label: "Audience rule", value: String((selected.audienceSnapshot as { rule?: string } | null)?.rule ?? "DIGITAL_REMINDER work items of the approved strategy population") },
            ]} />
            {counters && <p className="mt-2 text-sm"><strong>Dispatch log:</strong> queued {counters.counts.QUEUED} · sent {counters.counts.SENT} · delivered {counters.counts.DELIVERED} · failed {counters.counts.FAILED} · unknown {counters.counts.UNKNOWN} · blocked {counters.counts.BLOCKED} · cancelled {counters.counts.CANCELLED}{counters.killSwitch ? " · KILL SWITCH ON" : ""}{counters.paused.includes(selected.code) ? " · paused by outbound controls" : ""}</p>}
            {audience && (
              <div className="mt-2 text-sm">
                <p className="font-medium">Audience preview (live, sample of {audience.sampled} of {audience.population})</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{audience.eligible}</div><div className="text-xs text-muted">eligible now</div></div>
                  <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{audience.excluded.total}</div><div className="text-xs text-muted">excluded</div></div>
                  <div className="rounded bg-canvas p-2"><div className="text-lg font-bold">{fmtAzn(audience.costEstimate, false)}</div><div className="text-xs text-muted">AZN cost est. @ {audience.unitCost}</div></div>
                </div>
                <p className="mt-1 text-xs">Languages: {Object.entries(audience.byLanguage).map(([k, v]) => `${k} ${v}`).join(" · ")} · stale balances {audience.excluded.stale} · deduplicated {audience.excluded.dedup} · policy-blocked {audience.excluded.blocked}</p>
                {Object.keys(audience.excluded.byReason).length > 0 && <p className="text-xs">Exclusion reasons: {Object.entries(audience.excluded.byReason).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
                {audience.releaseBlockers.length > 0 && <p className="text-xs text-danger">Release blockers: {audience.releaseBlockers.join("; ")}</p>}
                {audience.previews.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-xs">Sample messages</summary><ul className="text-xs">{audience.previews.map((p) => <li key={p.customerId} className="mt-1"><span className="text-muted">{p.customerId} ({p.language}):</span> {p.body}</li>)}</ul></details>}
                <p className="text-xs text-muted">{audience.note}</p>
              </div>
            )}
            <div className="mt-3"><CampaignActions id={selected.id} status={selected.status} canRequest={hasPermission(user.role, "approval.request")} /></div>
          </Card>
        ) : <Card><p className="text-sm text-muted">No campaign selected.</p></Card>}
      </div>
    </>
  );
}
