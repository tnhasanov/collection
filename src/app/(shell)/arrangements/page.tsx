import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtAzn, fmtDateTime } from "@/lib/format";
import { ArrangementActions } from "@/components/arrangements/ArrangementActions";
import { ArrangementForm } from "@/components/arrangements/ArrangementForm";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { DRAFT: "neutral", SUBMITTED: "info", REVIEWED: "info", APPROVED: "brand", REJECTED: "danger", SENT_TO_CORE: "warning", CORE_CONFIRMED: "success", ACTIVE: "success", FAILED: "danger" };

export default async function ArrangementsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "arrangement.review") && !hasPermission(user.role, "arrangement.write")) redirect("/access-denied");
  const sp = await searchParams;
  const canReadRestricted = hasPermission(user.role, "support.restricted.read") && ["TEAM_LEAD", "COLLECTIONS_HEAD"].includes(user.role);
  const arrangements = await prisma.arrangement.findMany({ orderBy: { createdAt: "desc" }, include: { customer: { select: { displayName: true } }, supportCase: { select: { id: true, type: true, status: true, reason: true, restrictionUntil: true, slaDueAt: true } } } });
  const hardship = await prisma.supportCase.findMany({ where: { type: "HARDSHIP", status: { in: ["OPEN", "UNDER_REVIEW"] } }, include: { customer: { select: { displayName: true } }, arrangements: { select: { id: true } } }, orderBy: { createdAt: "desc" } });
  const selected = arrangements.find((a) => a.id === sp.id) ?? arrangements[0] ?? null;
  const approval = selected?.approvalId ? await prisma.approvalRequest.findUnique({ where: { id: selected.approvalId }, select: { id: true, status: true } }) : null;
  const cmp = selected?.comparison as Record<string, unknown> | null;
  const intake = (selected?.intake ?? {}) as Record<string, unknown>;
  return (
    <>
      <PageHeader kicker="S10 / repayment support and arrangements" title="Hardship & arrangements" lead="Intake → affordability → proposal → review → independent approval → core submission (mock) → active. Restricted details are visible only to authorized reviewers; the collections layer never changes a contract itself." />
      <Callout tone="info">Temporary plans and restructures are simulated with the annuity engine for comparison only. No fee, penalty or capitalization is invented; core banking remains the source of truth for the binding schedule.</Callout>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="space-y-3">
          <Card title="Open hardship cases" padded={false}>
            <table className="table-dense"><thead><tr><th>Support case</th><th>Customer</th><th>Status</th><th>Reason</th><th>Restriction until</th><th>SLA</th><th>Arrangements</th></tr></thead>
              <tbody>{hardship.map((h) => <tr key={h.id}><td className="text-xs">{h.id}</td><td><a href={`/customers/${h.customerId}`}>{h.customer.displayName}</a></td><td><Badge tone={h.status === "OPEN" ? "warning" : "info"}>{h.status.toLowerCase().replace("_", " ")}</Badge></td><td className="text-xs">{h.reason}</td><td className="text-xs">{h.restrictionUntil ? fmtDateTime(h.restrictionUntil) : "—"}</td><td className="text-xs">{h.slaDueAt ? fmtDateTime(h.slaDueAt) : "—"}</td><td className="text-xs">{h.arrangements.length}</td></tr>)}{hardship.length === 0 && <tr><td colSpan={7} className="p-3 text-muted">No open hardship cases.</td></tr>}</tbody></table>
          </Card>
          <Card title="Arrangements" padded={false}>
            <table className="table-dense"><thead><tr><th>Id</th><th>Customer</th><th>Type</th><th>Status</th><th>Proposal</th><th>Created</th></tr></thead>
              <tbody>{arrangements.map((a) => { const p = a.proposal as Record<string, unknown>; return <tr key={a.id} className={selected?.id === a.id ? "bg-brand-light" : ""}><td><a href={`/arrangements?id=${a.id}`}>{a.id.slice(-8)}</a></td><td><a href={`/customers/${a.customerId}`}>{a.customer.displayName}</a></td><td className="text-xs">{a.type.replace("_", " ").toLowerCase()}</td><td><Badge tone={TONE[a.status] ?? "neutral"}>{a.status.toLowerCase().replace(/_/g, " ")}</Badge></td><td className="text-xs">{a.type === "TEMPORARY_PLAN" ? `${fmtAzn(String(p.monthlyPayment))} × ${String(p.months)} months` : `${String(p.newTenorMonths)} months from ${String(p.firstDueDate)}`}</td><td className="text-xs">{fmtDateTime(a.createdAt)}</td></tr>; })}{arrangements.length === 0 && <tr><td colSpan={6} className="p-3 text-muted">No arrangements.</td></tr>}</tbody></table>
          </Card>
          {hasPermission(user.role, "arrangement.write") || hasPermission(user.role, "arrangement.review") ? <Card title="New proposal" subtitle="Simulate before saving; the simulation is attached as the comparison"><ArrangementForm supportCases={hardship.map((h) => ({ id: h.id, customerId: h.customerId, label: `${h.id} · ${h.customer.displayName}` }))} /></Card> : null}
        </div>
        {selected ? (
          <Card title={`Arrangement ${selected.id.slice(-8)} · ${selected.customer.displayName}`} subtitle={`${selected.type.replace("_", " ")} · created ${fmtDateTime(selected.createdAt)} by ${selected.createdBy}`} actions={<Badge tone={TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase().replace(/_/g, " ")}</Badge>}>
            <Dl items={[
              { label: "Support case", value: selected.supportCase ? `${selected.supportCase.id} · ${selected.supportCase.type} · ${selected.supportCase.status}` : "—" },
              { label: "Reviewer", value: selected.reviewerUserId ?? "—" },
              { label: "Approval", value: approval ? `${approval.id} · ${approval.status.toLowerCase().replace("_", " ")}` : "—" },
              { label: "Core reference", value: selected.coreReference ?? "—" },
            ]} />
            <p className="mt-2 text-sm font-medium">Intake</p>
            <ul className="text-xs">{Object.entries(intake).map(([k, v]) => <li key={k}><span className="text-muted">{k}:</span> {typeof v === "string" && v === "restricted" && !canReadRestricted ? <Badge tone="neutral">restricted</Badge> : String(v)}</li>)}</ul>
            <p className="mt-2 text-sm font-medium">Proposal</p>
            <pre className="rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.proposal, null, 1)}</pre>
            {cmp && (
              <div className="mt-2 text-sm">
                <p className="font-medium">Comparison (simulation)</p>
                {cmp.type === "TEMPORARY_PLAN" ? <p className="text-xs">Overdue {fmtAzn(String(cmp.currentOverdue))} · contractual in window {fmtAzn(String(cmp.contractualDueInWindow))} · plan total {fmtAzn(String(cmp.planTotal))} · shortfall at plan end {fmtAzn(String(cmp.shortfallAtPlanEnd))} · overdue covered: {cmp.overdueCovered ? "yes" : "no"}</p> : <p className="text-xs">Simulated {String((cmp.simulated as Record<string, unknown>)?.months)} months at {String((cmp.simulated as Record<string, unknown>)?.rate)}: regular {fmtAzn(String((cmp.simulated as Record<string, unknown>)?.regularPayment))} (current {fmtAzn(String((cmp.current as Record<string, unknown>)?.regularPaymentAllLoans))}) · total payable {fmtAzn(String((cmp.simulated as Record<string, unknown>)?.totalPayable))} vs remaining contractual {fmtAzn(String((cmp.current as Record<string, unknown>)?.remainingContractual))} (Δ {fmtAzn(String(cmp.deltaRemainingPayable))})</p>}
                <p className="text-xs text-muted">{String(cmp.note)}</p>
              </div>
            )}
            <div className="mt-3"><ArrangementActions id={selected.id} status={selected.status} isProposer={selected.createdBy === user.id} canReview={hasPermission(user.role, "arrangement.review")} canRequest={hasPermission(user.role, "approval.request")} canWrite={hasPermission(user.role, "arrangement.write") || hasPermission(user.role, "arrangement.review")} /></div>
          </Card>
        ) : <Card><p className="text-sm text-muted">No arrangement selected.</p></Card>}
      </div>
    </>
  );
}
