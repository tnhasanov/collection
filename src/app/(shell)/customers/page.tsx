import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { customerScope, scopeIsUnscoped } from "@/server/auth/scope";
import { now } from "@/server/clock";
import { searchCustomers } from "@/server/modules/customers/customerService";
import { listCustomers, type CustomerFilter, type CustomerSort, type CustomerTab } from "@/server/modules/customers/customerListService";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui";
import { CustomerRowsTable } from "@/components/customers/CustomerRowsTable";
import { ListControls } from "@/components/customers/ListControls";
import { RowsPager } from "@/components/customers/RowsPager";
import { currentLocale } from "@/i18n/locale";
import { at } from "@/i18n/agentText";

export const dynamic = "force-dynamic";

const SORTS: CustomerSort[] = ["overdue", "dpd", "loans", "name"];
const TABS: CustomerTab[] = ["all", "callbacks", "promises"];
const PAGE_SIZE = 25;

/**
 * Customer list: one compact row per customer in the caller's scope (scope, search and tab applied before grouping and
 * paging). Loans, promises and open work are in the detail drawer; the full profile and loan pages are one click further.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string; filter?: string; sort?: string; dir?: string; page?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const sp = await searchParams;
  const locale = await currentLocale();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const q = (sp.q ?? "").trim();
  const tab: CustomerTab = TABS.includes(sp.tab as CustomerTab) ? (sp.tab as CustomerTab) : "all";
  const filter: CustomerFilter = sp.filter === "active" ? "active" : "overdue";
  const sort: CustomerSort = SORTS.includes(sp.sort as CustomerSort) ? (sp.sort as CustomerSort) : "overdue";
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sort === "name" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const t = await now();
  const scope = await customerScope(prisma, user, t);
  const [data, hidden] = await Promise.all([
    listCustomers(prisma, { scope, q, filter, tab, sort, dir, page, pageSize: PAGE_SIZE, now: t }),
    q && !scopeIsUnscoped(scope) ? searchCustomers(prisma, q, { scope, limit: 1 }).then((r) => r.hiddenByScope) : Promise.resolve(0),
  ]);
  const hrefFor = (p: number) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(tab !== "all" ? { tab } : {}), ...(filter !== "overdue" ? { filter } : {}), sort, dir, page: String(p) });
    return `/customers?${params.toString()}`;
  };
  return (
    <>
      <PageHeader compact title={A("cl.title.customers")} meta={A("cl.count", { n: data.total })} />
      <ListControls locale={locale} base="/customers" current={{ q, tab, filter, sort, dir: sp.dir ?? "" }} />
      {hidden > 0 && <p className="callout callout-info mb-3 text-sm">{A("cl.hidden", { n: hidden })}</p>}
      <div className="panel overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-4"><EmptyState title={A("cl.empty")} /></div>
        ) : (
          <CustomerRowsTable rows={JSON.parse(JSON.stringify(data.rows))} locale={locale} variant="customers" caption={A("cl.title.customers")} />
        )}
      </div>
      <RowsPager page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={hrefFor} locale={locale} />
      {!scopeIsUnscoped(scope) && <p className="mt-2 text-xs text-muted">{A("cl.scopedNote")}</p>}
    </>
  );
}
