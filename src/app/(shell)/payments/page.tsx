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
import { PaymentSimulator } from "@/components/payments/PaymentSimulator";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
const TABS = [["posted", "Verified posted"], ["unmatched", "Unallocated / unmatched"], ["pending", "Pending settlement"], ["reversals", "Reversals"], ["discrepancies", "Source discrepancies"], ["simulator", "Demo simulator"]];
const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { POSTED: "success", REVERSED: "danger", QUARANTINED: "warning", PENDING: "warning", UNMATCHED: "warning" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; selected?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "payment.read")) redirect("/access-denied");
  const { tab = "posted", selected } = await searchParams;
  const t = await now();
  const start = DateTime.fromJSDate(t, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const where: Prisma.PaymentWhereInput = tab === "posted" ? { status: "POSTED" } : tab === "unmatched" ? { status: { in: ["QUARANTINED", "UNMATCHED"] } } : tab === "pending" ? { status: "PENDING" } : tab === "reversals" ? { OR: [{ status: "REVERSED" }, { reversalOfId: { not: null } }] } : { id: "none" };
  const [rows, verifiedToday, unmatched, feed, dupes, discrepancies] = await Promise.all([
    tab === "discrepancies" || tab === "simulator" ? Promise.resolve([]) : prisma.payment.findMany({ where, include: { customer: { select: { displayName: true } }, allocations: { include: { installment: { select: { seq: true } } } }, promiseLinks: true, reversalOf: true }, orderBy: { eventAt: "desc" }, take: 150 }),
    prisma.payment.findMany({ where: { eventAt: { gte: start }, status: { in: ["POSTED", "REVERSED"] } }, select: { amount: true, status: true, reversalOfId: true } }),
    prisma.payment.count({ where: { status: { in: ["QUARANTINED", "UNMATCHED"] } } }),
    prisma.sourceWatermark.findUnique({ where: { sourceSystem: "PAYMENT_FEED" } }),
    prisma.integrationEvent.count({ where: { status: "DUPLICATE" } }),
    prisma.exceptionCase.findMany({ where: { type: { in: ["SOURCE_MISMATCH", "SCHEDULE_MISMATCH", "REVERSED_PAYMENT", "UNMATCHED_PAYMENT", "CLAIMED_ALREADY_PAID"] }, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, include: { customer: { select: { displayName: true } } }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
  ]);
  const net = verifiedToday.reduce((s, p) => (p.status === "POSTED" ? s.plus(p.amount) : p.reversalOfId ? s.plus(p.amount) : s), dec(0));
  const lagMin = feed?.sourceAsOf ? Math.round((t.getTime() - feed.sourceAsOf.getTime()) / 60000) : null;
  const dupAudit = await prisma.auditEvent.count({ where: { action: "integration.event.duplicate" } });
  const sel = selected ? rows.find((r) => r.id === selected) : null;
  const loans = tab === "simulator" ? await prisma.loan.findMany({ where: { status: "ACTIVE", totalOverdue: { gt: 0 } }, select: { id: true, coreLoanId: true, customerId: true, totalOverdue: true, customer: { select: { displayName: true } } }, orderBy: { dpd: "desc" }, take: 60 }) : [];
  const recentTxns = tab === "simulator" ? await prisma.payment.findMany({ where: { status: "POSTED", sourceSystem: "CORE_DEMO" }, orderBy: { eventAt: "desc" }, take: 15, select: { sourceTransactionId: true, amount: true, loanRef: true } }) : [];
  return (
    <>
      <PageHeader kicker="S09 / payments & reconciliation" title="Payments & reconciliation" lead="Verified core events drive balances, promises and task cancellation. A payment claim is not a posting. Manual correction creates a reviewed reconciliation decision, never a fabricated core posting." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Verified today" value={formatAzn(net, { withCurrency: false })} note="AZN - net posted amount (value date today)" />
        <Kpi label="Unmatched events" value={unmatched} note="Review required" href="/payments?tab=unmatched" tone={unmatched > 0 ? "warning" : undefined} />
        <Kpi label="Source lag" value={lagMin === null ? "n/a" : `${lagMin} min`} note={feed ? `${feed.health.toLowerCase()} · threshold ${Math.round(feed.freshnessThresholdSeconds / 60)} min` : "no watermark"} tone={lagMin !== null && feed && lagMin > feed.freshnessThresholdSeconds / 60 ? "danger" : undefined} />
        <Kpi label="Idempotency checks" value={dupAudit + dupes > 0 ? "Passed" : "Ready"} note={`${dupAudit + dupes} replayed events ignored without duplicate effect`} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/payments?tab=${k}`} className="tab" aria-current={tab === k ? "page" : undefined} style={tab === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>
            {l}
          </Link>
        ))}
      </div>
      {tab === "simulator" ? (
        hasPermission(user.role, "payment.simulate") && process.env.APP_MODE === "DEMO" ? (
          <PaymentSimulator loans={loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, customerId: l.customerId, customerName: l.customer.displayName, totalOverdue: l.totalOverdue.toString() }))} recent={recentTxns.map((r) => ({ id: r.sourceTransactionId, amount: r.amount.toString(), loanRef: r.loanRef }))} today={DateTime.fromJSDate(t, { zone: BAKU_ZONE }).toISODate()!} />
        ) : (
          <Card className="mt-2"><p className="text-sm text-muted">The payment simulator is available only in DEMO mode to roles with the payment.simulate permission (integration operator, admin).</p></Card>
        )
      ) : tab === "discrepancies" ? (
        <Card className="mt-2" padded={false}>
          <table className="table-dense">
            <thead><tr><th>Type</th><th>Customer</th><th>Title</th><th>First seen</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {discrepancies.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">No open discrepancies</td></tr>}
              {discrepancies.map((d) => (
                <tr key={d.id}><td>{d.type.replace(/_/g, " ").toLowerCase()}</td><td>{d.customer ? <Link href={`/customers/${d.customerId}`}>{d.customer.displayName}</Link> : "—"}</td><td>{d.title}</td><td>{formatBakuDateTime(d.firstSeenAt)}</td><td><Badge tone="warning">{d.status.toLowerCase()}</Badge></td><td><Link href={`/exceptions?selected=${d.id}`}>Open</Link></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <>
          <Card className="mt-2" padded={false}>
            <div className="overflow-x-auto">
              <table className="table-dense">
                <thead>
                  <tr><th>Source transaction</th><th>Customer / loan</th><th>Event</th><th>Value date</th><th>Posting date</th><th className="num">Amount AZN</th><th>Status</th><th>Allocation</th><th>Batch / event</th><th>Reconciliation</th><th>Promise</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-muted">Nothing in this tab</td></tr>}
                  {rows.map((p) => (
                    <tr key={p.id} aria-selected={sel?.id === p.id ? true : undefined}>
                      <td><Link href={`/payments?tab=${tab}&selected=${p.id}`}>{p.sourceTransactionId}</Link><div className="text-xs text-muted">{p.sourceSystem}</div></td>
                      <td>{p.customerId ? <Link href={`/customers/${p.customerId}`}>{p.customer?.displayName}</Link> : <span className="text-warning">Reference missing</span>}<div className="text-xs text-muted">{p.loanId ?? p.loanRef}</div></td>
                      <td>{formatBakuDateTime(p.eventAt)}</td>
                      <td>{formatDate(p.valueDate)}</td>
                      <td>{formatDate(p.postingDate)}</td>
                      <td className="num">{formatAzn(p.amount, { withCurrency: false })}</td>
                      <td><Badge tone={TONE[p.status] ?? "neutral"}>{p.status.toLowerCase()}</Badge></td>
                      <td className="text-xs">{p.allocations.length ? p.allocations.map((a) => (a.installment ? `#${a.installment.seq} i${a.interestAmount}/p${a.principalAmount}` : `unapplied ${a.unappliedAmount}`)).join("; ") : "—"}</td>
                      <td className="text-xs text-muted">{p.importBatchId ?? p.integrationEventId?.slice(0, 10) ?? "—"}</td>
                      <td className="text-xs">{p.reconciliation.toLowerCase()}{p.reconciliationNote ? ` · ${p.reconciliationNote}` : ""}{p.reversalOf ? ` · reverses ${p.reversalOf.sourceTransactionId}` : ""}</td>
                      <td className="text-xs">{p.promiseLinks.length ? `credited ${p.promiseLinks.map((l) => formatAzn(l.amount)).join(", ")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {sel && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Card title="Selected payment allocation" subtitle={`${sel.sourceTransactionId} · policy ${sel.allocationPolicy ?? "core import"}`}>
                {sel.allocations.length === 0 ? <p className="text-sm text-muted">No allocation (quarantined or reversed).</p> : (
                  <ul className="text-sm">
                    {sel.allocations.map((a) => (
                      <li key={a.id}>{a.installment ? `Installment #${a.installment.seq}` : "Unapplied"}: interest {formatAzn(a.interestAmount)} / principal {formatAzn(a.principalAmount)} / fee {formatAzn(a.feeAmount)} {a.unappliedAmount.toString() !== "0" ? `/ unapplied ${formatAzn(a.unappliedAmount)}` : ""}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted">Allocations are restated from facts (oldest due first, interest then principal) in DEMO; production imports core allocations.</p>
              </Card>
              <Card title="Claim versus verified status">
                <p className="text-sm">&quot;Already paid&quot; opens a reconciliation task. Only refreshed authoritative payment and balance data can clear arrears. Promise credit: {sel.promiseLinks.length ? sel.promiseLinks.map((l) => `${formatAzn(l.amount)}${l.reversed ? " (reversed)" : ""}`).join(", ") : "none"}.</p>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
