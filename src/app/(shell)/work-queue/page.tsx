import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { customerScope, scopeIsUnscoped } from "@/server/auth/scope";
import { now } from "@/server/clock";
import { listWorkQueue, queueHeader, type QueueFilters as Filters } from "@/server/modules/work/queueService";
import { EmptyState, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatBakuDateTime } from "@/server/dates";
import { ClaimNextButton } from "@/components/customers/ClaimNextButton";
import { QueueFilters } from "@/components/customers/QueueFilters";
import { CustomerRowsTable } from "@/components/customers/CustomerRowsTable";
import { RowsPager } from "@/components/customers/RowsPager";
import { currentLocale } from "@/i18n/locale";
import { at } from "@/i18n/agentText";

export const dynamic = "force-dynamic";

const QUEUES: Filters["queue"][] = ["mine", "all", "senior", "callbacks", "blocked", "manual", "later"];
const PAGE_SIZE = 25;

/**
 * Prioritized work queue: one row per customer, placed by its next work item in workflow order (in a call, claimed,
 * due callback, rank, priority). Work items, reservations and promises stay separate; the other open work of a
 * customer is listed in the detail panel. Opening the panel never claims, reserves or dials.
 */
export default async function WorkQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "queue.read")) redirect("/access-denied");
  const sp = await searchParams;
  const locale = await currentLocale();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const queue = QUEUES.includes(sp.queue as Filters["queue"]) ? (sp.queue as Filters["queue"]) : "mine";
  const filters = { queue, eligibility: (sp.eligibility as Filters["eligibility"]) ?? "", band: sp.band ?? "", bucket: sp.bucket ?? "", riskClass: sp.riskClass ?? "", language: sp.language ?? "", branch: sp.branch ?? "", page, pageSize: PAGE_SIZE };
  const t = await now();
  const scope = await customerScope(prisma, user, t);
  const [header, data] = await Promise.all([queueHeader(prisma, user, scope, t), listWorkQueue(prisma, user, filters, scope, t)]);
  const hrefFor = (p: number) => {
    const q = new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), page: String(p) });
    return `/work-queue?${q.toString()}`;
  };
  const note = A("cl.kpi.customersNote");
  return (
    <>
      <PageHeader kicker={A("cl.count", { n: data.total })} title={A("cl.title.queue")} lead={A("cl.lead.queue")} actions={hasPermission(user.role, "queue.claim") ? <ClaimNextButton locale={locale} /> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="queue-kpis">
        <Kpi label={A("cl.kpi.assigned")} value={header.assigned} note={note} href="/work-queue?queue=mine" />
        <Kpi label={A("cl.kpi.eligible")} value={header.eligible} note={note} href="/work-queue?queue=all&eligibility=ELIGIBLE" />
        <Kpi label={A("cl.kpi.callbacks")} value={header.callbacksDue} note={note} href="/work-queue?queue=callbacks" />
        <Kpi label={A("cl.kpi.senior")} value={header.senior} note={note} href="/work-queue?queue=senior" />
        <Kpi label={A("cl.kpi.blocked")} value={header.blocked} note={note} href="/work-queue?queue=blocked" />
      </div>
      <p className="mt-2 mb-3 text-[13px] text-muted">
        {A("cl.policyLine", { policy: header.policyVersion, at: formatBakuDateTime(header.lastRefresh, { locale }), n: header.agentsActive })}
        {!scopeIsUnscoped(scope) ? ` · ${A("cl.scopedNote")}` : ""}
      </p>
      <QueueFilters current={{ ...filters }} locale={locale} />
      <div className="panel mt-3 overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-4"><EmptyState title={A("cl.empty")} /></div>
        ) : (
          <CustomerRowsTable rows={JSON.parse(JSON.stringify(data.rows))} locale={locale} variant="queue" caption={A("cl.title.queue")} />
        )}
        <RowsPager page={page} pageSize={PAGE_SIZE} total={data.total} hrefFor={hrefFor} locale={locale} />
      </div>
      <p className="mt-3 text-[13px] text-muted">{A("cl.claimNote")}</p>
    </>
  );
}
