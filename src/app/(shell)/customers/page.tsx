import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { customerScope, scopeIsUnscoped } from "@/server/auth/scope";
import { now } from "@/server/clock";
import { searchCustomers } from "@/server/modules/customers/customerService";
import { listCustomers, type CustomerFilter, type CustomerSort } from "@/server/modules/customers/customerListService";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui";
import { CustomerRowsTable } from "@/components/customers/CustomerRowsTable";
import { RowsPager } from "@/components/customers/RowsPager";
import { currentLocale } from "@/i18n/locale";
import { at } from "@/i18n/agentText";

export const dynamic = "force-dynamic";

const SORTS: CustomerSort[] = ["overdue", "dpd", "loans", "name"];
const PAGE_SIZE = 25;

/**
 * Customer list: one row per customer in the caller's scope (scope and search applied before grouping and paging).
 * Loans, promises and open work are in the detail panel; the full profile and loan pages are one click further.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; sort?: string; dir?: string; page?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const sp = await searchParams;
  const locale = await currentLocale();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const q = (sp.q ?? "").trim();
  const filter: CustomerFilter = sp.filter === "active" ? "active" : "overdue";
  const sort: CustomerSort = SORTS.includes(sp.sort as CustomerSort) ? (sp.sort as CustomerSort) : "overdue";
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sort === "name" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const t = await now();
  const scope = await customerScope(prisma, user, t);
  const [data, hidden] = await Promise.all([
    listCustomers(prisma, { scope, q, filter, sort, dir, page, pageSize: PAGE_SIZE, now: t }),
    q && !scopeIsUnscoped(scope) ? searchCustomers(prisma, q, { scope, limit: 1 }).then((r) => r.hiddenByScope) : Promise.resolve(0),
  ]);
  const hrefFor = (p: number) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), filter, sort, dir, page: String(p) });
    return `/customers?${params.toString()}`;
  };
  return (
    <>
      <PageHeader kicker={A("cl.count", { n: data.total })} title={A("cl.title.customers")} lead={A("cl.lead.customers")} />
      <form className="mb-3 flex flex-wrap items-end gap-2" action="/customers" role="search">
        <label className="min-w-[220px] flex-1 text-[13px] text-muted lg:max-w-sm">
          <span className="mb-1 block">{A("cl.searchBtn")}</span>
          <input name="q" className="input" defaultValue={q} placeholder={A("cl.search")} data-testid="cl-q" />
        </label>
        <label className="text-[13px] text-muted">
          <span className="mb-1 block">{A("cl.f.status")}</span>
          <select name="filter" className="select" defaultValue={filter} data-testid="cl-filter">
            <option value="overdue">{A("cl.filter.overdue")}</option>
            <option value="active">{A("cl.filter.active")}</option>
          </select>
        </label>
        <label className="text-[13px] text-muted">
          <span className="mb-1 block">{A("cl.sort")}</span>
          <select name="sort" className="select" defaultValue={sort} data-testid="cl-sort">
            {SORTS.map((s) => <option key={s} value={s}>{A(`cl.sort.${s}`)}</option>)}
          </select>
        </label>
        <label className="text-[13px] text-muted">
          <span className="sr-only">{A("cl.sort")}</span>
          <select name="dir" className="select" defaultValue={dir} aria-label={A("cl.sort")}>
            <option value="desc">{A("cl.dir.desc")}</option>
            <option value="asc">{A("cl.dir.asc")}</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary" data-testid="cl-apply">{A("cl.apply")}</button>
      </form>
      {hidden > 0 && <p className="callout callout-info mb-3 text-sm">{A("cl.hidden", { n: hidden })}</p>}
      <div className="panel overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-4"><EmptyState title={A("cl.empty")} /></div>
        ) : (
          <CustomerRowsTable rows={JSON.parse(JSON.stringify(data.rows))} locale={locale} variant="customers" caption={A("cl.title.customers")} />
        )}
        <RowsPager page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={hrefFor} locale={locale} />
      </div>
      {!scopeIsUnscoped(scope) && <p className="mt-2 text-[13px] text-muted">{A("cl.scopedNote")}</p>}
    </>
  );
}
