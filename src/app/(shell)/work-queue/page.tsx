import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { customerScope, scopeIsUnscoped } from "@/server/auth/scope";
import { now } from "@/server/clock";
import { listWorkQueue, queueHeader } from "@/server/modules/work/queueService";
import { Badge, Card, Kpi } from "@/components/ui";
import { Pagination } from "@/components/ui/Table";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn } from "@/server/money";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { ACTION_LABELS, type ActionCode } from "@/server/modules/decisions/treatment";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import { PROBABILITY_SOURCE_LABELS } from "@/server/modules/customers/customerService";
import { ClaimNextButton } from "@/components/customers/ClaimNextButton";
import { QueueFilters } from "@/components/customers/QueueFilters";

export const dynamic = "force-dynamic";

export default async function WorkQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "queue.read")) redirect("/access-denied");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const filters = { queue: (sp.queue as "mine" | "all") ?? "mine", eligibility: (sp.eligibility as "ELIGIBLE" | "") ?? "", band: sp.band ?? "", bucket: sp.bucket ?? "", riskClass: sp.riskClass ?? "", language: sp.language ?? "", branch: sp.branch ?? "", page, pageSize: 25 } as const;
  const t = await now();
  const scope = await customerScope(prisma, user, t);
  const [header, data] = await Promise.all([queueHeader(prisma, user, scope, t), listWorkQueue(prisma, user, filters, scope)]);
  const hrefFor = (p: number) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>, page: String(p) });
    return `/work-queue?${q.toString()}`;
  };
  return (
    <>
      <PageHeader kicker="S03 / my prioritized work queue" title="My prioritized work queue" lead="Common ERA ranking, customer-level contact rules and capacity-aware assignment. Automatic dialer allocation is the normal agent flow; 'Get next customer' is a controlled fallback that atomically claims work." actions={hasPermission(user.role, "queue.claim") ? <ClaimNextButton /> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Assigned / in scope" value={header.assigned} note="Unique customer voice items" />
        <Kpi label="Eligible now" value={header.eligible} note="Re-checked at claim and before dial" href="/work-queue?queue=all&eligibility=ELIGIBLE" />
        <Kpi label="Callbacks due (24h)" value={header.callbacksDue} note="Authorized times only" href="/work-queue?queue=callbacks" />
        <Kpi label="Senior-only" value={header.senior} note="Bucket 10 queue" href="/work-queue?queue=senior" />
        <Kpi label="Blocked / deferred" value={header.blocked} note="Reasons remain visible" href="/work-queue?queue=blocked" />
      </div>
      <p className="mt-2 text-xs text-muted">
        Policy {header.policyVersion} · last decision refresh {formatBakuDateTime(header.lastRefresh)} · agents active {header.agentsActive}
        {!scopeIsUnscoped(scope) && " · Showing only customers in your scope; pooled work appears after the dialer allocates it or you claim it."}
      </p>
      <QueueFilters current={{ ...filters }} />
      <Card padded={false} className="mt-3">
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Customer / CIF</th>
                <th className="num">Loans</th>
                <th className="num">Max DPD</th>
                <th className="num">Overdue AZN</th>
                <th className="num">Exposure AZN</th>
                <th>Probability / source</th>
                <th className="num">ERA AZN</th>
                <th>Bucket</th>
                <th>Recommended → effective</th>
                <th>Next contact</th>
                <th>Last outcome</th>
                <th>PTP</th>
                <th>Owner</th>
                <th>Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-muted">
                    No work items match these filters.
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.rank ?? "—"}</td>
                  <td>
                    <Link href={`/customers/${r.customerId}?from=queue&queue=${filters.queue}`}>{r.customerName}</Link>
                    <div className="text-xs text-muted">
                      {r.cif} · {r.language} · {r.type === "CALLBACK" ? "Callback" : r.type.replace(/_/g, " ").toLowerCase()}
                    </div>
                  </td>
                  <td className="num">{r.loans}</td>
                  <td className="num">{r.maxDpd}</td>
                  <td className="num">{formatAzn(r.overdue, { withCurrency: false })}</td>
                  <td className="num">{r.exposure ? formatAzn(r.exposure, { withCurrency: false }) : "—"}</td>
                  <td className="text-xs">{r.probability ? `${(Number(r.probability) * 100).toFixed(1)}% · ${PROBABILITY_SOURCE_LABELS[r.probabilitySource ?? "NONE"]}${r.riskClass ? ` · class ${r.riskClass}` : ""}` : <span className="text-warning">Unscored</span>}</td>
                  <td className="num">{r.era ? formatAzn(r.era, { withCurrency: false }) : r.segment && ["DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS"].includes(r.segment) ? "Out of scope" : "Unavailable"}</td>
                  <td>{r.bucket ?? (r.segment ? SEGMENT_LABELS[r.segment as keyof typeof SEGMENT_LABELS] : "—")}</td>
                  <td className="text-xs">
                    {r.recommended ? ACTION_LABELS[r.recommended as ActionCode] : "—"}
                    {r.effective && r.effective !== r.recommended ? ` → ${ACTION_LABELS[r.effective as ActionCode]}` : ""}
                  </td>
                  <td className="text-xs">{r.type === "CALLBACK" ? formatBakuDateTime(r.dueAt) : formatBakuDateTime(r.nextEligibleAt)}</td>
                  <td className="text-xs text-muted">{r.lastOutcome ?? "—"}</td>
                  <td className="text-xs">{r.promise ? `${r.promise.status} ${formatAzn(r.promise.amount, { withCurrency: false })} · ${formatDate(r.promise.deadline)}` : "—"}</td>
                  <td className="text-xs">{r.owner ?? (r.requiredSkill === "SENIOR" ? "Senior pool" : "Pool")}</td>
                  <td>
                    {r.status === "ELIGIBLE" ? <Badge tone="success">Eligible now</Badge> : r.status === "CLAIMED" || r.status === "IN_PROGRESS" ? <Badge tone="info">{r.status === "IN_PROGRESS" ? "In call" : "Claimed"}</Badge> : <Badge tone="warning" title={r.deferredReasons.join(", ")}>{r.deferredReasons.map((x) => REASON_LABELS[x] ?? x).join(", ") || r.status}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3">
          <Pagination page={page} pageSize={25} total={data.total} hrefFor={hrefFor} />
        </div>
      </Card>
      <p className="callout callout-info mt-3">ERA ranks the financial roll-risk amount. A high score never bypasses cooldown, payment freshness, ownership, or customer restrictions. Bulk calling or sending is not available from this screen.</p>
    </>
  );
}
