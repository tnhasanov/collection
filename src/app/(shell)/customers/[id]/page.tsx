import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { canAccessCustomer } from "@/server/auth/access";
import { now } from "@/server/clock";
import { getCustomer360 } from "@/server/modules/customers/customerService";
import { Badge, Callout, Card, Dl, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn, formatPercent } from "@/server/money";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { CustomerActions } from "@/components/customers/CustomerActions";
import { CustomerTabs } from "@/components/customers/CustomerTabs";
import { appendAudit } from "@/server/modules/audit/audit";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; queue?: string; tab?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const { id } = await params;
  const sp = await searchParams;
  const allowed = await canAccessCustomer(prisma, user, id);
  if (!allowed) {
    await appendAudit(prisma, { actorUserId: user.id, action: "access.denied", objectType: "Customer", objectId: id, customerId: id, blocked: true, reason: "Out-of-scope customer page" });
    redirect("/access-denied");
  }
  const t = await now();
  let data;
  try {
    data = await getCustomer360(prisma, id, { now: t, maskContacts: !hasPermission(user.role, "integration.operate") });
  } catch {
    notFound();
  }
  await appendAudit(prisma, { actorUserId: user.id, action: "customer.viewed", objectType: "Customer", objectId: id, customerId: id });
  const c = data.customer;
  const d = data.decision;
  const e = data.eligibility;
  const balancesStale = data.summary.balancesAsOf ? t.getTime() - new Date(data.summary.balancesAsOf).getTime() > 15 * 60_000 : false;
  const scriptSummary = "Verify the right party before discussing debt. Explain the overdue installment, establish the reason, and record an affordable commitment.";
  const drawerCustomer = {
    id: c.id,
    name: c.displayName,
    cif: c.cif,
    language: c.language,
    maxDpd: data.summary.maxDpd,
    overdue: data.summary.overdueDueNow,
    bucket: d?.actionBucket ?? null,
    requiredSkill: d?.requiredSkill ?? null,
    loans: data.loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, totalOverdue: l.totalOverdue, oldestUnpaidDueDate: l.oldestUnpaidDueDate })),
    contacts: data.contacts.map((x) => ({ id: x.id, type: x.type, value: x.value, verification: x.verification, isPrimary: x.isPrimary })),
    scriptSummary,
  };
  return (
    <>
      {sp.from === "queue" && (
        <p className="mb-2 text-xs text-muted">
          <Link href={`/work-queue?queue=${sp.queue ?? "mine"}`}>← Back to work queue</Link>
        </p>
      )}
      <PageHeader kicker={`S04 / ${c.displayName}`} title={c.displayName} lead={`${c.cif} - unsecured AZN cash loan - preferred language ${c.language} - ${data.contacts.some((x) => x.verification === "VERIFIED") ? "verified contact on file" : "no verified contact"} - case owner ${data.case?.ownerName ?? data.case?.teamName ?? "pool"} - source as of ${formatBakuDateTime(c.sourceAsOf)}`} actions={<CustomerActions customer={drawerCustomer} serverNow={t.toISOString()} canWrite={hasPermission(user.role, "interaction.write")} />} />
      <div className="mb-3 flex flex-wrap gap-2">
        {c.specialHandling && <Badge tone="danger">Special handling: {c.specialHandlingReason}</Badge>}
        {data.restrictions.openDisputes.map((x) => (
          <Badge key={x.id} tone="warning">
            Open dispute
          </Badge>
        ))}
        {data.restrictions.supportCases.map((x) => (
          <Badge key={x.id} tone="warning">
            {x.type.replace(/_/g, " ").toLowerCase()} case
          </Badge>
        ))}
        {data.restrictions.paidClaims.map((x) => (
          <Badge key={x.id} tone="info">
            Paid claim under reconciliation
          </Badge>
        ))}
        {data.restrictions.cooldownUntil && new Date(data.restrictions.cooldownUntil) > t && <Badge tone="info">Routine calls suppressed until {formatBakuDateTime(data.restrictions.cooldownUntil)}</Badge>}
        {balancesStale && <Badge tone="danger">Stale balances ({formatBakuDateTime(data.summary.balancesAsOf)})</Badge>}
        {data.contacts.filter((x) => x.verification === "INVALID").map((x) => (
          <Badge key={x.id} tone="danger">
            Wrong number: {x.value}
          </Badge>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Overdue now" value={formatAzn(data.summary.overdueDueNow, { withCurrency: false })} note="AZN - due now across loans" tone={Number(data.summary.overdueDueNow) > 0 ? "danger" : undefined} />
        <Kpi label="Principal outstanding" value={formatAzn(data.summary.principalOutstanding, { withCurrency: false })} note="AZN - includes overdue principal" />
        <Kpi label="Accrued, not overdue" value={formatAzn(data.summary.accruedInterestNotDue, { withCurrency: false })} note="Demo pro-rata interest" />
        <Kpi label="Last verified payment" value={data.summary.lastVerifiedPayment ? formatAzn(data.summary.lastVerifiedPayment.amount, { withCurrency: false }) : "—"} note={data.summary.lastVerifiedPayment ? formatBakuDateTime(data.summary.lastVerifiedPayment.at) : "No posted payment"} />
        <Kpi label="Next due" value={data.summary.nextDue ? formatDate(data.summary.nextDue.date) : "—"} note={data.summary.nextDue ? `${formatAzn(data.summary.nextDue.amount)} · ${data.summary.nextDue.loanId}` : ""} />
        <Kpi label="Loans / max DPD" value={`${data.summary.activeLoans} / ${data.summary.maxDpd}`} note="One coordinated customer case" />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_2fr_1fr]">
        <Card title="Loans" subtitle="Imported contract and financial position are read-only">
          <ul className="space-y-2">
            {data.loans.map((l) => (
              <li key={l.id} className="rounded-md border border-line p-2 text-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/loans/${l.id}`} className="font-medium">
                    {l.coreLoanId}
                  </Link>
                  <Badge tone={l.dpd > 0 ? "danger" : l.status === "ACTIVE" ? "success" : "neutral"}>{l.dpd > 0 ? `DPD ${l.dpd}` : l.status === "ACTIVE" ? "Current" : l.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {formatAzn(l.principalOriginal)} · {formatPercent(l.nominalAnnualRate, 2)} nominal · {l.tenorMonths} m · installment {formatAzn(l.regularInstallment)}
                </p>
                <p className="text-xs">
                  Overdue {formatAzn(l.totalOverdue)} · outstanding {formatAzn(l.principalOutstanding)} · next due {formatDate(l.nextDueDate)}
                </p>
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-bold uppercase tracking-wider text-muted">Contacts</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.contacts.map((x) => (
              <li key={x.id} className="flex items-center justify-between">
                <span>
                  {x.type} {x.value} {x.isPrimary ? "(primary)" : ""}
                </span>
                <Badge tone={x.verification === "VERIFIED" ? "success" : x.verification === "INVALID" ? "danger" : "neutral"}>{x.verification.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CustomerTabs data={JSON.parse(JSON.stringify(data))} initialTab={sp.tab ?? "overview"} />
        </Card>
        <div className="space-y-3">
          <Card title="Why this customer?" subtitle="Model class and action bucket are separate">
            {d ? (
              <Dl
                items={[
                  { label: "Snapshot", value: `${formatDate(d.businessDate)} · rank ${d.rank ?? "unranked"}` },
                  { label: "Decision DPD", value: `${d.decisionDpd} (${d.segmentLabel})` },
                  { label: "Probability source", value: d.probabilitySourceLabel },
                  { label: "Roll probability", value: d.probability ? formatPercent(d.probability) : "Unscored" },
                  { label: "Model class", value: d.riskClass ? `Class ${d.riskClass}` : "n/a" },
                  { label: "Feature snapshot", value: d.featuresAsOf ? formatDate(d.featuresAsOf) : "none" },
                  { label: "Exposure", value: `${formatAzn(d.exposure)} (demo definition - principal only)` },
                  { label: "ERA", value: d.era ? `${formatAzn(d.era)} (risk-ranking amount, not ECL)` : "Unavailable" },
                  { label: "Action bucket", value: d.actionBucket ? `${d.actionBucket} of 10` : "Unscored" },
                  { label: "Recommended action", value: d.recommendedActionLabel },
                  { label: "Effective action", value: d.effectiveActionLabel },
                  { label: "Versions", value: `${d.modelVersion ?? "no model"} · ${d.strategyVersion} · ${d.policyVersion}` },
                  { label: "Reason codes", value: d.reasonCodes.join(", ") },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No current decision snapshot (customer is not in an open case).</p>
            )}
          </Card>
          <Card title="Contact eligibility (voice)" subtitle={e ? `Evaluated ${formatBakuDateTime(t, { seconds: true })} · ${e.policyVersion}` : ""}>
            {e && (
              <>
                {e.eligible ? <Badge tone="success">Eligible now</Badge> : <Callout tone="warning">Blocked: {e.reasons.join(", ")}{e.nextAllowedAt ? ` · next allowed ${formatBakuDateTime(e.nextAllowedAt)}` : ""}</Callout>}
                <ul className="mt-2 space-y-0.5 text-xs">
                  {e.checks.map((ch) => (
                    <li key={ch.code} className={ch.passed ? "text-muted" : "text-danger"}>
                      {ch.passed ? "✓" : "✕"} {ch.label}
                      {ch.detail ? ` — ${ch.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card title="Open work">
            {data.workItems.length === 0 ? (
              <p className="text-sm text-muted">No open work items</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.workItems.map((w) => (
                  <li key={w.id}>
                    <Badge tone={w.status === "ELIGIBLE" ? "success" : w.status === "DEFERRED" ? "warning" : "info"}>{w.status}</Badge> {w.type.replace(/_/g, " ").toLowerCase()}
                    {w.dueAt ? ` · due ${formatBakuDateTime(w.dueAt)}` : ""}
                    {w.ownerName ? ` · ${w.ownerName}` : ""}
                    {w.deferredReasons.length ? <span className="text-xs text-muted"> · {w.deferredReasons.join(", ")}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
