"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Dl, Tabs } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import type { AgentContext } from "@/components/agent/types";

export function CustomerContext({ ctx, verified }: { ctx: AgentContext; verified: boolean }) {
  const c = ctx.customer;
  const [tab, setTab] = useState("facts");
  if (!c) return null;
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  const activePromise = c.promises.find((p) => ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"].includes(p.status));
  const lastOutcome = c.interactions.find((i) => i.status === "SAVED" || i.status === "CORRECTED");
  const blocked = c.restrictions.openDisputes.length + c.restrictions.supportCases.length + c.restrictions.paidClaims.length;
  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Customer context</h2>
          <p className="card-subtitle">
            <Link href={`/customers/${c.customer.id}`}>{c.customer.displayName}</Link> · {c.customer.cif}
          </p>
        </div>
        <Badge tone={verified ? "success" : "warning"}>{verified ? "Right party verified" : "Identity not verified"}</Badge>
      </div>
      <Tabs idPrefix="ctx" active={tab} onChange={setTab} tabs={[{ key: "facts", label: "Facts" }, { key: "loans", label: "Loans", count: c.loans.length }, { key: "payments", label: "Payments", count: c.payments.length }, { key: "history", label: "History", count: c.interactions.length }]} />
      {tab === "facts" && (
        <div id="ctx-panel-facts" role="tabpanel" className="mt-3 space-y-3 text-sm">
          <Dl
            items={[
              { label: "Contact", value: `${primary?.type ?? "—"} ${primary?.value ?? ""} (${primary?.verification.toLowerCase() ?? "n/a"}, masked)` },
              { label: "Language", value: c.customer.language },
              { label: "Loan relationship", value: `${c.summary.activeLoans} active loan${c.summary.activeLoans === 1 ? "" : "s"} · max DPD ${c.summary.maxDpd}` },
              { label: "Overdue now", value: <span className="font-bold text-danger">{fmtAzn(c.summary.overdueDueNow)}</span> },
              { label: "Outstanding principal", value: fmtAzn(c.summary.principalOutstanding) },
              { label: "Accrued, not due", value: `${fmtAzn(c.summary.accruedInterestNotDue)} (demo pro-rata)` },
              { label: "Next installment", value: c.summary.nextDue ? `${fmtDate(c.summary.nextDue.date)} · ${fmtAzn(c.summary.nextDue.amount)}` : "—" },
              { label: "Last verified payment", value: c.summary.lastVerifiedPayment ? `${fmtAzn(c.summary.lastVerifiedPayment.amount)} on ${fmtDateTime(c.summary.lastVerifiedPayment.at)}` : "No recent payment" },
              { label: "Balances as of", value: fmtDateTime(c.summary.balancesAsOf) },
              { label: "Previous outcome", value: lastOutcome ? `${humanize(lastOutcome.businessOutcome)} · ${fmtDateTime(lastOutcome.startedAt)}` : "None" },
              { label: "Active promise", value: activePromise ? `${fmtAzn(activePromise.amount)} by ${fmtDate(activePromise.deadlineDate)} (${humanize(activePromise.status)})` : "No active promise" },
              { label: "Next routine call", value: c.restrictions.cooldownUntil && new Date(c.restrictions.cooldownUntil) > new Date(ctx.serverNow) ? `Suppressed until ${fmtDateTime(c.restrictions.cooldownUntil)}` : "Subject to RPC cooldown after this call" },
            ]}
          />
          {c.decision && (
            <div className="rounded-md bg-brand-light p-2 text-xs">
              <p className="font-bold text-brand-dark">Why this customer?</p>
              <p>
                {c.decision.segmentLabel} · {c.decision.probabilitySourceLabel}
                {c.decision.riskClass ? ` · class ${c.decision.riskClass}` : ""} · ERA {fmtAzn(c.decision.era)} · bucket {c.decision.actionBucket ?? "—"} · rank {c.decision.rank ?? "—"} · {c.decision.effectiveActionLabel}
              </p>
            </div>
          )}
          {(blocked > 0 || c.customer.specialHandling) && (
            <div className="callout callout-warning text-xs">
              {c.customer.specialHandling && <p>Special handling: {c.customer.specialHandlingReason}</p>}
              {c.restrictions.openDisputes.map((d) => (
                <p key={d.id}>Open dispute: {d.reason}</p>
              ))}
              {c.restrictions.supportCases.map((s) => (
                <p key={s.id}>
                  {humanize(s.type)} case: {s.reason}
                </p>
              ))}
              {c.restrictions.paidClaims.map((p) => (
                <p key={p.id}>Paid claim under reconciliation {p.claimedAmount ? fmtAzn(p.claimedAmount) : ""}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === "loans" && (
        <div id="ctx-panel-loans" role="tabpanel" className="mt-3 space-y-2 text-sm">
          {c.loans.map((l) => (
            <div key={l.id} className="rounded-md border border-line p-2">
              <div className="flex items-center justify-between">
                <Link href={`/loans/${l.id}`} className="font-medium">
                  {l.coreLoanId}
                </Link>
                <Badge tone={l.dpd > 0 ? "danger" : "success"}>{l.dpd > 0 ? `DPD ${l.dpd}` : l.status === "ACTIVE" ? "Current" : humanize(l.status)}</Badge>
              </div>
              <p className="text-xs text-muted">
                {fmtAzn(l.principalOriginal)} · {(Number(l.nominalAnnualRate) * 100).toFixed(2)}% nominal · {l.tenorMonths} months · installment {fmtAzn(l.regularInstallment)}
              </p>
              <p className="text-xs">
                Overdue {fmtAzn(l.totalOverdue)} (principal {fmtAzn(l.overduePrincipal)} + interest {fmtAzn(l.overdueInterest)}) · outstanding {fmtAzn(l.principalOutstanding)} · next due {fmtDate(l.nextDueDate)}
              </p>
            </div>
          ))}
        </div>
      )}
      {tab === "payments" && (
        <div id="ctx-panel-payments" role="tabpanel" className="mt-3 text-sm">
          {c.payments.length === 0 && <p className="text-muted">No payments</p>}
          <ul className="divide-y divide-line">
            {c.payments.slice(0, 10).map((p) => (
              <li key={p.id} className="flex justify-between py-1 text-xs">
                <span>
                  {fmtDate(p.valueDate)} · {p.sourceTransactionId}
                </span>
                <span>
                  {fmtAzn(p.amount)} <Badge tone={p.status === "POSTED" ? "success" : p.status === "REVERSED" ? "danger" : "warning"}>{humanize(p.status)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "history" && (
        <div id="ctx-panel-history" role="tabpanel" className="mt-3 text-sm">
          <ul className="divide-y divide-line">
            {c.interactions.slice(0, 10).map((i) => (
              <li key={i.id} className="py-1 text-xs">
                <span className="text-muted">{fmtDateTime(i.startedAt)}</span> · {humanize(i.technicalResult)} · {humanize(i.identityStatus)} · {humanize(i.businessOutcome)}
                {i.agentName ? ` · ${i.agentName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
