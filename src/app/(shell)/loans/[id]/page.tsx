import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { canAccessCustomer } from "@/server/auth/access";
import { getLoanDetail } from "@/server/modules/finance/loanDetailService";
import { Badge, Callout, Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatAzn, formatPercent } from "@/server/money";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { LoanTabs } from "@/components/loans/LoanTabs";

export const dynamic = "force-dynamic";

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const { id } = await params;
  const loanRow = await prisma.loan.findUnique({ where: { id }, select: { customerId: true } });
  if (!loanRow) notFound();
  if (!(await canAccessCustomer(prisma, user, loanRow.customerId))) redirect("/access-denied");
  const d = await getLoanDetail(prisma, id);
  const l = d.loan;
  return (
    <>
      <PageHeader kicker="S05 / loan detail & annuity schedule" title={`${l.coreLoanId}`} lead={<span><Link href={`/customers/${l.customer.id}`}>{l.customer.displayName}</Link> · {l.customer.cif} · contractual schedule projection; simulations never overwrite core records.</span>} actions={<Badge tone={l.status === "ACTIVE" ? "success" : "neutral"}>{l.status.replace(/_/g, " ")} · DPD {l.dpd} (core authoritative)</Badge>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Original principal" value={formatAzn(l.principalOriginal, { withCurrency: false })} note="AZN" />
        <Kpi label="Nominal annual rate" value={formatPercent(l.nominalAnnualRate, 2)} note={`Monthly periodic rate ${(Number(l.nominalAnnualRate) / 12 * 100).toFixed(2)}% · not APR/EIR`} />
        <Kpi label="Scheduled installment" value={formatAzn(d.localSimulation.regularPayment, { withCurrency: false })} note="AZN - final payment adjusts" />
        <Kpi label="Contractual tenor" value={`${l.tenorMonths} months`} note="Regular end-of-period payments" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Principal outstanding" value={formatAzn(l.principalOutstanding, { withCurrency: false })} />
        <Kpi label="Overdue principal" value={formatAzn(l.overduePrincipal, { withCurrency: false })} />
        <Kpi label="Accrued interest (not due)" value={formatAzn(l.accruedInterestNotDue, { withCurrency: false })} note="demo pro-rata" />
        <Kpi label="Overdue interest" value={formatAzn(l.overdueInterest, { withCurrency: false })} />
        <Kpi label="Approved fees / penalties" value={formatAzn(l.feesDue, { withCurrency: false })} note="none configured" />
        <Kpi label="Unapplied funds" value={formatAzn(l.unappliedFunds, { withCurrency: false })} />
        <Kpi label="Total overdue" value={formatAzn(l.totalOverdue, { withCurrency: false })} tone={Number(l.totalOverdue) > 0 ? "danger" : undefined} />
        <Kpi label="Settlement quote" value="n/a" note="Quote unavailable — request from core" />
      </div>
      <p className="mt-2 text-xs text-muted">
        Origination {formatDate(l.originationDate)} · first due {formatDate(l.firstDueDate)} · maturity {formatDate(l.maturityDate)} · product {l.product} · source schedule {d.schedule?.sourceRef ?? "—"} v{d.schedule?.versionNo ?? "—"} · balances as of {formatBakuDateTime(l.balancesAsOf)} (version {l.balanceVersion}, source {l.sourceSystem} v{l.sourceVersion})
      </p>
      <Callout tone="info" className="mt-2">
        Demo calculation: {formatAzn(l.principalOriginal)} / {formatPercent(l.nominalAnnualRate, 2)} nominal / {l.tenorMonths} months / no fees. First interest {formatAzn(d.localSimulation.installments[0]?.interestDue)}; first principal {formatAzn(d.localSimulation.installments[0]?.principalDue)}. Rounding: AZN cents, half up, final residual adjustment {formatAzn(d.localSimulation.finalAdjustment)}.
      </Callout>
      {d.mismatches.length > 0 && (
        <Callout tone="warning" className="mt-2">
          Core schedule differs from the local annuity simulation on {d.mismatches.length} installment(s) (e.g. #{d.mismatches[0].seq}: core interest {d.mismatches[0].coreInterest} vs local {d.mismatches[0].localInterest}). The core schedule is retained; a reconciliation exception is recorded. Imported data is never overwritten.
        </Callout>
      )}
      <Card className="mt-3">
        <LoanTabs data={JSON.parse(JSON.stringify(d))} />
      </Card>
    </>
  );
}
