import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { formatBakuDateTime } from "@/server/dates";
import { Badge, Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExceptionActions } from "@/components/exceptions/ExceptionActions";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; selected?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "exception.manage") && !hasPermission(user.role, "audit.read")) redirect("/access-denied");
  const { status = "open", type = "", selected } = await searchParams;
  const where: Prisma.ExceptionCaseWhereInput = status === "open" ? { status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } } : status === "resolved" ? { status: "RESOLVED" } : {};
  if (type) where.type = type as never;
  const rows = await prisma.exceptionCase.findMany({ where, include: { customer: { select: { displayName: true } }, owner: { select: { displayName: true } } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 200 });
  const counts = await prisma.exceptionCase.groupBy({ by: ["type"], where: { status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, _count: { _all: true } });
  const sel = selected ? rows.find((r) => r.id === selected) : null;
  const canManage = hasPermission(user.role, "exception.manage");
  return (
    <>
      <PageHeader kicker="S22 / exception workbench" title="Exception workbench" lead="Claimed already paid, unmatched/reversed payments, stale balances/features, missing model inputs, wrong numbers, duplicate CIFs, disputes, expired policies, source mismatches and handover failures. Blocks only the affected activity; unscored customers stay visible in an owned manual-review queue." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Open" value={counts.reduce((s, c) => s + c._count._all, 0)} note="All open exceptions" href="/exceptions?status=open" />
        <Kpi label="Critical" value={rows.filter((r) => r.severity === "CRITICAL" && r.status !== "RESOLVED").length} note="In current view" />
        <Kpi label="Unowned" value={rows.filter((r) => !r.ownerUserId && r.status !== "RESOLVED").length} note="Assign an owner" />
        <Kpi label="Types" value={counts.length} note="Distinct open types" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => (<Link key={k} href={`/exceptions?status=${k}&type=${type}`} className="tab" aria-current={status === k ? "page" : undefined} style={status === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>{l}</Link>))}
        <span className="mx-1 text-muted">|</span>
        {counts.map((c) => (<Link key={c.type} href={`/exceptions?status=${status}&type=${type === c.type ? "" : c.type}`} className="badge badge-neutral" style={type === c.type ? { background: "var(--color-brand-light)" } : undefined}>{c.type.replace(/_/g, " ").toLowerCase()} ({c._count._all})</Link>))}
      </div>
      <Card className="mt-2" padded={false}>
        <table className="table-dense">
          <thead><tr><th>Severity</th><th>Type</th><th>Title</th><th>Customer</th><th>First / last seen</th><th>Owner</th><th>SLA</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">No exceptions</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} aria-selected={sel?.id === r.id ? true : undefined}>
                <td><Badge tone={r.severity === "CRITICAL" ? "danger" : r.severity === "WARNING" ? "warning" : "info"}>{r.severity.toLowerCase()}</Badge></td>
                <td className="text-xs">{r.type.replace(/_/g, " ").toLowerCase()}</td>
                <td>{r.title}</td>
                <td>{r.customerId ? <Link href={`/customers/${r.customerId}`}>{r.customer?.displayName ?? r.customerId}</Link> : "—"}</td>
                <td className="text-xs">{formatBakuDateTime(r.firstSeenAt)} / {formatBakuDateTime(r.lastSeenAt)} ({r.occurrences}×)</td>
                <td>{r.owner?.displayName ?? "—"}</td>
                <td className="text-xs">{r.slaDueAt ? formatBakuDateTime(r.slaDueAt) : "—"}</td>
                <td><Badge tone={r.status === "RESOLVED" ? "success" : r.status === "ASSIGNED" ? "info" : "warning"}>{r.status.toLowerCase()}</Badge></td>
                <td><Link href={`/exceptions?status=${status}&type=${type}&selected=${r.id}`}>Inspect</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {sel && (
        <Card className="mt-3" title={sel.title} subtitle={`${sel.type} · ${sel.severity} · ${sel.status}${sel.resolution ? ` · resolution: ${sel.resolution}` : ""}`} actions={canManage ? <ExceptionActions id={sel.id} status={sel.status} type={sel.type} supportCaseId={(sel.evidence as { supportCaseId?: string } | null)?.supportCaseId ?? null} canConfirmSpecial={hasPermission(user.role, "special-case.confirm")} /> : null}>
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <div><h3 className="font-bold">Evidence</h3><pre className="mt-1 max-h-60 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(sel.evidence, null, 2)}</pre></div>
            <div><h3 className="font-bold">Affected outreach</h3><pre className="mt-1 max-h-60 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(sel.affectedOutreach ?? { note: "Only affected activity is blocked; see customer eligibility" }, null, 2)}</pre></div>
            <div><h3 className="font-bold">Lineage</h3><ul className="text-xs">{sel.customerId && <li><Link href={`/customers/${sel.customerId}`}>Customer {sel.customerId}</Link></li>}{sel.loanId && <li><Link href={`/loans/${sel.loanId}`}>Loan {sel.loanId}</Link></li>}{sel.paymentId && <li><Link href={`/payments?tab=unmatched&selected=${sel.paymentId}`}>Payment</Link></li>}<li><Link href={`/audit?objectId=${sel.id}`}>Audit trail</Link></li></ul></div>
          </div>
        </Card>
      )}
    </>
  );
}
