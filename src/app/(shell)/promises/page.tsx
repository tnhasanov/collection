import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { BAKU_ZONE, formatBakuDateTime, formatDate } from "@/server/dates";
import { formatAzn, dec } from "@/server/money";
import { Badge, Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { CreatePromiseButton, CancelPromiseButton } from "@/components/promises/PromiseActions";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { ACTIVE: "info", KEPT: "success", PARTIALLY_PAID: "warning", PENDING_RECONCILIATION: "warning", BROKEN: "danger", CANCELLED: "neutral" };

export default async function PromisesPage({ searchParams }: { searchParams: Promise<{ view?: string; selected?: string; owner?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const { view = "active", selected, owner = "all" } = await searchParams;
  const t = await now();
  const start = DateTime.fromJSDate(t, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const end = DateTime.fromJSDate(t, { zone: BAKU_ZONE }).endOf("day").toJSDate();
  const monthStart = DateTime.fromJSDate(t, { zone: BAKU_ZONE }).startOf("month").toJSDate();
  const scoped = hasPermission(user.role, "customer.read.unscoped") ? {} : { OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }] };
  const where: Prisma.PromiseWhereInput = { ...scoped, ...(owner === "me" ? { ownerUserId: user.id } : {}) };
  switch (view) {
    case "due-today": Object.assign(where, { deadline: { gte: start, lte: end }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } }); break;
    case "upcoming": Object.assign(where, { deadline: { gt: end }, status: { in: ["ACTIVE", "PARTIALLY_PAID"] } }); break;
    case "kept": where.status = "KEPT"; break;
    case "partial": where.status = "PARTIALLY_PAID"; break;
    case "broken": where.status = "BROKEN"; break;
    case "pending": where.status = "PENDING_RECONCILIATION"; break;
    case "cancelled": where.status = "CANCELLED"; break;
    case "all": break;
    default: where.status = { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] };
  }
  const [rows, dueToday, upcoming, keptMonth, maturedMonth, pending] = await Promise.all([
    prisma.promise.findMany({ where, include: { customer: true, createdBy: { select: { displayName: true } }, paymentLinks: { include: { payment: true } }, events: { orderBy: { at: "asc" } } }, orderBy: { deadline: "asc" }, take: 200 }),
    prisma.promise.count({ where: { ...scoped, deadline: { gte: start, lte: end }, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } }),
    prisma.promise.count({ where: { ...scoped, deadline: { gt: end }, status: { in: ["ACTIVE", "PARTIALLY_PAID"] } } }),
    prisma.promise.count({ where: { ...scoped, status: "KEPT", maturedAt: { gte: monthStart } } }),
    prisma.promise.count({ where: { ...scoped, status: { in: ["KEPT", "BROKEN", "PARTIALLY_PAID"] }, maturedAt: { gte: monthStart } } }),
    prisma.promise.count({ where: { ...scoped, status: "PENDING_RECONCILIATION" } }),
  ]);
  const sel = selected ? rows.find((r) => r.id === selected) ?? (await prisma.promise.findUnique({ where: { id: selected }, include: { customer: true, createdBy: { select: { displayName: true } }, paymentLinks: { include: { payment: true } }, events: { orderBy: { at: "asc" } } } })) : null;
  const previous = sel ? await prisma.promise.findMany({ where: { customerId: sel.customerId, id: { not: sel.id } }, orderBy: { createdAt: "desc" }, take: 5 }) : [];
  const views = [["active", "Active"], ["due-today", "Due today"], ["upcoming", "Upcoming"], ["kept", "Kept"], ["partial", "Partially paid"], ["broken", "Broken"], ["pending", "Awaiting reconciliation"], ["cancelled", "Cancelled"], ["all", "All"]];
  return (
    <>
      <PageHeader kicker="S07 / promises to pay" title="Promises to pay" lead="Track customer commitments separately from actual received and allocated cash. A late feed gives Pending reconciliation, never a premature Broken." actions={hasPermission(user.role, "promise.write") ? <CreatePromiseButton /> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Due today" value={dueToday} note="Matured / pending shown separately" href="/promises?view=due-today" />
        <Kpi label="Upcoming" value={upcoming} note="Not in the kept-rate denominator" href="/promises?view=upcoming" />
        <Kpi label="Kept this month" value={maturedMonth ? `${((keptMonth / maturedMonth) * 100).toFixed(1)}%` : "n/a"} note={`${keptMonth} / ${maturedMonth} matured promises (fixed cohort)`} href="/promises?view=kept" />
        <Kpi label="Pending reconciliation" value={pending} note="Do not mark broken prematurely" href="/promises?view=pending" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {views.map(([k, l]) => (
          <Link key={k} href={`/promises?view=${k}&owner=${owner}`} className="tab" aria-current={view === k ? "page" : undefined} style={view === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>
            {l}
          </Link>
        ))}
        <Link href={`/promises?view=${view}&owner=${owner === "me" ? "all" : "me"}`} className="tab ml-auto">
          Owner: {owner === "me" ? "me" : "all"}
        </Link>
      </div>
      <Card padded={false} className="mt-2">
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Promised AZN</th>
                <th>Covered loans</th>
                <th>Created</th>
                <th>Deadline</th>
                <th className="num">Verified qualifying payments</th>
                <th className="num">Remaining</th>
                <th>Owner</th>
                <th>State</th>
                <th>Suppression end</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No promises in this view.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} aria-selected={sel?.id === p.id ? true : undefined}>
                  <td>
                    <Link href={`/promises?view=${view}&owner=${owner}&selected=${p.id}`}>{p.customer.displayName}</Link>
                    <div className="text-xs text-muted">{p.customerId}</div>
                  </td>
                  <td className="num">{formatAzn(p.amount, { withCurrency: false })}</td>
                  <td className="text-xs">{p.coveredLoanIds.join(", ")}</td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{formatBakuDateTime(p.deadline)}</td>
                  <td className="num">{formatAzn(p.paidAmount, { withCurrency: false })}</td>
                  <td className="num">{formatAzn(p.remainingAmount, { withCurrency: false })}</td>
                  <td>{p.createdBy?.displayName ?? "—"}</td>
                  <td>
                    <Badge tone={TONE[p.status]}>{p.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </td>
                  <td className="text-xs">{p.suppressionUntil ? formatBakuDateTime(p.suppressionUntil) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && (
        <Card className="mt-3" title={`Selected promise / ${sel.customer.displayName}`} subtitle={`Scope: ${sel.scopeDescription ?? sel.coveredLoanIds.join(", ")} · policy ${sel.policyVersionId ?? "—"} · customer confirmed: ${sel.customerConfirmed ? "yes" : "no"}`} actions={<>{["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"].includes(sel.status) && hasPermission(user.role, "promise.write") && <CancelPromiseButton id={sel.id} />}<Link className="btn btn-secondary btn-sm" href={`/customers/${sel.customerId}?tab=promises`}>Open customer</Link></>}>
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <div>
              <h3 className="font-bold">Payment attribution</h3>
              {sel.paymentLinks.length === 0 ? <p className="text-muted">No qualifying payment yet. Qualifying window {formatBakuDateTime(sel.qualifyingWindowStart)} → {formatBakuDateTime(sel.qualifyingWindowEnd)} (deadline + {sel.settlementAllowanceDays} days).</p> : (
                <ul>
                  {sel.paymentLinks.map((l) => (
                    <li key={l.id}>
                      {l.payment.sourceTransactionId} · {formatAzn(l.amount)} {l.reversed && <Badge tone="danger">reversed</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted">Each verified allocation is credited once; one payment never counts toward two promises.</p>
            </div>
            <div>
              <h3 className="font-bold">Status events</h3>
              <ul className="text-xs">
                {sel.events.map((e) => (
                  <li key={e.id}>
                    {formatBakuDateTime(e.at)} · {e.type} {e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : ""} {e.reason ? `· ${e.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-bold">Future contact eligibility</h3>
              <p className="text-xs">Routine calls resume only after all applicable restrictions expire: {sel.suppressionUntil ? <Badge tone="warning">Protected until {formatBakuDateTime(sel.suppressionUntil)}</Badge> : "no promise protection active"}.</p>
              <h4 className="mt-2 font-bold">Previous promises</h4>
              <ul className="text-xs">
                {previous.length === 0 && <li className="text-muted">None</li>}
                {previous.map((p) => (
                  <li key={p.id}>
                    {formatDate(p.createdAt)} · {formatAzn(p.amount)} by {formatDate(p.deadlineDate)} · {p.status}
                    {dec(p.paidAmount).greaterThan(0) ? ` · paid ${formatAzn(p.paidAmount)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
