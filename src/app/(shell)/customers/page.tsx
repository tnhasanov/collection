import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { canAccessCustomer } from "@/server/auth/access";
import { searchCustomers } from "@/server/modules/customers/customerService";
import { Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn } from "@/server/money";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const { q = "" } = await searchParams;
  const rows = q ? await searchCustomers(prisma, q, 50) : [];
  const visible = [];
  for (const r of rows) if (await canAccessCustomer(prisma, user, r.id)) visible.push(r);
  return (
    <>
      <PageHeader kicker="S04 / customer search" title="Customers" lead="Search by synthetic name, customer id, CIF or loan id. Results are limited to your authorized scope." />
      <form className="mb-3 flex gap-2" action="/customers">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input id="q" name="q" className="input max-w-md" defaultValue={q} placeholder="Customer, CIF, loan or case" />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>
      <Card padded={false}>
        {!q ? (
          <div className="p-4">
            <EmptyState title="Enter a search term" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No customers found in your scope">{rows.length > visible.length ? `${rows.length - visible.length} matching record(s) are outside your assigned scope.` : null}</EmptyState>
          </div>
        ) : (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Customer</th>
                <th>CIF</th>
                <th>Branch</th>
                <th className="num">Loans</th>
                <th className="num">Max DPD</th>
                <th className="num">Overdue AZN</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/customers/${r.id}`}>{r.displayName}</Link>
                    <div className="text-xs text-muted">{r.id}</div>
                  </td>
                  <td>{r.cif}</td>
                  <td>{r.branch}</td>
                  <td className="num">{r.loans}</td>
                  <td className="num">{r.maxDpd}</td>
                  <td className="num">{formatAzn(r.totalOverdue, { withCurrency: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
