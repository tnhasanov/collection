"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Tabs } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import type { JsonOf } from "@/components/agent/types";
import type { Customer360 } from "@/server/modules/customers/customerService";
import { t, type Locale } from "@/i18n/dictionaries";
import { paymentStateLabel } from "@/components/agent/DetailsTabs";

type Data = JsonOf<Customer360>;
const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { ACTIVE: "info", KEPT: "success", PARTIALLY_PAID: "warning", PENDING_RECONCILIATION: "warning", BROKEN: "danger", CANCELLED: "neutral", POSTED: "success", REVERSED: "danger", QUARANTINED: "warning", PENDING: "warning", UNMATCHED: "warning" };

export function CustomerTabs({ data, initialTab, locale = "en" }: { data: Data; initialTab: string; locale?: Locale }) {
  const [tab, setTab] = useState(initialTab);
  const tt = (k: string) => t(locale, k);
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "loans", label: "Loans", count: data.loans.length },
    { key: "payments", label: "Payments", count: data.payments.length },
    { key: "contacts", label: "Contacts", count: data.interactions.length },
    { key: "promises", label: "Promises", count: data.promises.length },
    { key: "related", label: tt("agent.tabs.related"), count: data.relatedParties.length },
    { key: "messages", label: "Messages", count: data.messages.length },
    { key: "documents", label: "Documents" },
    { key: "support", label: "Support / disputes", count: data.restrictions.openDisputes.length + data.restrictions.supportCases.length },
    { key: "decisions", label: "Decision history" },
  ];
  return (
    <div>
      <Tabs idPrefix="c360" tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-3 text-sm" role="tabpanel" id={`c360-panel-${tab}`}>
        {tab === "overview" && (
          <div>
            <h3 className="mb-1 font-bold">Activity timeline</h3>
            <p className="mb-2 text-xs text-muted">Customer-wide record across all related loan accounts</p>
            <ul className="space-y-1.5">
              {data.timeline.map((t) => (
                <li key={`${t.kind}-${t.id}`} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
                  <div>
                    <div className="text-xs text-muted">
                      {fmtDateTime(t.at)} · {t.kind}
                    </div>
                    <div>{t.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {tab === "loans" && (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Loan</th>
                <th>Status</th>
                <th className="num">DPD</th>
                <th className="num">Principal out.</th>
                <th className="num">Overdue principal</th>
                <th className="num">Overdue interest</th>
                <th className="num">Fees</th>
                <th className="num">Unapplied</th>
                <th className="num">Total overdue</th>
                <th>Next due</th>
              </tr>
            </thead>
            <tbody>
              {data.loans.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/loans/${l.id}`}>{l.coreLoanId}</Link>
                  </td>
                  <td>{humanize(l.status)}</td>
                  <td className="num">{l.dpd}</td>
                  <td className="num">{fmtAzn(l.principalOutstanding, false)}</td>
                  <td className="num">{fmtAzn(l.overduePrincipal, false)}</td>
                  <td className="num">{fmtAzn(l.overdueInterest, false)}</td>
                  <td className="num">{fmtAzn(l.feesDue, false)}</td>
                  <td className="num">{fmtAzn(l.unappliedFunds, false)}</td>
                  <td className="num font-bold">{fmtAzn(l.totalOverdue, false)}</td>
                  <td>{fmtDate(l.nextDueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "payments" && (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Loan</th>
                <th>Value date</th>
                <th className="num">Amount</th>
                <th>Payment state</th>
                <th>Reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {data.restrictions.paidClaims.map((c) => (
                <tr key={c.id}>
                  <td>{c.reference ?? "claim"}</td>
                  <td>—</td>
                  <td>—</td>
                  <td className="num">{c.claimedAmount ? fmtAzn(c.claimedAmount, false) : "?"}</td>
                  <td><Badge tone="warning">{tt("agent.paymentStates.CLAIMED")}</Badge></td>
                  <td className="text-xs">hold until {fmtDateTime(c.holdUntil)}</td>
                </tr>
              ))}
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.sourceTransactionId}</td>
                  <td>{p.loanId}</td>
                  <td>{fmtDate(p.valueDate)}</td>
                  <td className="num">{fmtAzn(p.amount, false)}</td>
                  <td>
                    <Badge tone={TONE[p.status] ?? "neutral"}>{paymentStateLabel(locale, p.status, p.reconciliation)}</Badge>
                  </td>
                  <td>{humanize(p.reconciliation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "contacts" && (
          <table className="table-dense">
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>Technical</th>
                <th>Identity</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>Next action</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {data.interactions.map((i) => (
                <tr key={i.id}>
                  <td>{fmtDateTime(i.startedAt)}</td>
                  <td>{humanize(i.channel)}</td>
                  <td>{humanize(i.technicalResult)}</td>
                  <td>{i.isRpc ? <Badge tone="success">RPC verified</Badge> : humanize(i.identityStatus)}</td>
                  <td>{humanize(i.businessOutcome)}</td>
                  <td>{humanize(i.nonPaymentReason)}</td>
                  <td>{humanize(i.nextAction)}</td>
                  <td>{i.agentName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "promises" && (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Created</th>
                <th className="num">Amount</th>
                <th>Deadline</th>
                <th className="num">Paid</th>
                <th className="num">Remaining</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Suppression until</th>
              </tr>
            </thead>
            <tbody>
              {data.promises.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td className="num">{fmtAzn(p.amount, false)}</td>
                  <td>{fmtDate(p.deadlineDate)}</td>
                  <td className="num">{fmtAzn(p.paidAmount, false)}</td>
                  <td className="num">{fmtAzn(p.remainingAmount, false)}</td>
                  <td>
                    <Badge tone={TONE[p.status] ?? "neutral"}>{humanize(p.status)}</Badge>
                  </td>
                  <td className="text-xs">{p.coveredLoanIds.join(", ")}</td>
                  <td className="text-xs">{fmtDateTime(p.suppressionUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "related" && (
          <div className="space-y-2">
            {data.relatedParties.length === 0 && <p className="text-muted">{tt("agent.related.none")}</p>}
            {data.relatedParties.map((r) => (
              <div key={r.id} className="rounded-md border border-line p-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium">{r.displayName}</span>
                  <span className="flex gap-1">
                    <Badge tone="brand">{tt(`agent.related.roles.${r.role}`)}</Badge>
                    <Badge tone={r.verification === "VERIFIED" ? "success" : r.verification === "INVALID" ? "danger" : "neutral"}>{r.verification.toLowerCase()}</Badge>
                    <Badge tone={r.disclosureAllowed ? "success" : "warning"}>{r.disclosureAllowed ? tt("agent.related.allowed") : tt("agent.related.notAllowed")}</Badge>
                  </span>
                </div>
                <p className="text-xs text-muted">{r.relation ?? "—"} · {r.phoneMasked ?? "—"}{r.contactRules ? ` · ${r.contactRules}` : ""}</p>
                <p className="text-xs text-muted">{tt("agent.related.source")}: {r.sourceSystem} · {fmtDate(r.sourceAsOf)}</p>
              </div>
            ))}
          </div>
        )}
        {tab === "messages" && (
          <table className="table-dense">
            <thead><tr><th>Requested</th><th>Kind</th><th>Template</th><th>Status</th><th className="num">Segments</th><th className="num">Est. cost</th></tr></thead>
            <tbody>
              {data.messages.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted">No messages</td></tr>}
              {data.messages.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDateTime(m.requestedAt)}</td>
                  <td>{humanize(m.kind)}</td>
                  <td>{m.template ?? "—"} · {m.language}</td>
                  <td><Badge tone={m.status === "DELIVERED" ? "success" : m.status === "FAILED" || m.status === "BLOCKED" ? "danger" : "info"}>{m.status.toLowerCase()}</Badge>{m.blockReason ? <span className="ml-1 text-xs text-muted">{m.blockReason}</span> : null}</td>
                  <td className="num">{m.segments ?? "—"}</td>
                  <td className="num">{m.estimatedCost ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "documents" && <p className="text-muted">No documents are attached in the synthetic demo. Document storage requires the bank&apos;s approved repository integration (INTEGRATION_MAPPING.md).</p>}
        {tab === "support" && (
          <div className="space-y-2">
            {data.restrictions.openDisputes.length === 0 && data.restrictions.supportCases.length === 0 && data.restrictions.paidClaims.length === 0 && <p className="text-muted">No open support cases, disputes or claims.</p>}
            {data.restrictions.openDisputes.map((d) => (
              <div key={d.id} className="rounded-md border border-line p-2">
                <Badge tone="warning">Dispute · {d.status}</Badge> {d.reason}
              </div>
            ))}
            {data.restrictions.supportCases.map((s) => (
              <div key={s.id} className="rounded-md border border-line p-2">
                <Badge tone="warning">
                  {humanize(s.type)} · {s.status}
                </Badge>{" "}
                {s.reason} {s.restrictionUntil ? `· calls restricted until ${fmtDateTime(s.restrictionUntil)}` : ""}
                <p className="text-xs text-muted">Sensitive details are restricted to authorized reviewers.</p>
              </div>
            ))}
            {data.restrictions.paidClaims.map((c) => (
              <div key={c.id} className="rounded-md border border-line p-2">
                <Badge tone="info">Paid claim</Badge> {c.claimedAmount ? fmtAzn(c.claimedAmount) : "amount unknown"} {c.reference ?? ""} · hold until {fmtDateTime(c.holdUntil)}
              </div>
            ))}
          </div>
        )}
        {tab === "decisions" && (
          <div>
            {data.decision ? (
              <div className="rounded-md border border-line p-2 text-xs">
                <p className="font-bold">Current snapshot {fmtDate(data.decision.businessDate)}</p>
                <p>
                  {data.decision.segmentLabel} · {data.decision.probabilitySourceLabel} · class {data.decision.riskClass ?? "n/a"} · p={data.decision.probability ?? "n/a"} · exposure {fmtAzn(data.decision.exposure)} · ERA {fmtAzn(data.decision.era)} · bucket {data.decision.actionBucket ?? "n/a"} · {data.decision.effectiveActionLabel}
                </p>
                <p className="text-muted">
                  {data.decision.modelVersion ?? "no model"} · {data.decision.strategyVersion} · {data.decision.policyVersion}
                </p>
                {data.decision.trace && typeof data.decision.trace === "object" && "path" in (data.decision.trace as object) && (
                  <ul className="mt-1 list-disc pl-4">
                    {((data.decision.trace as { path: string[] }).path ?? []).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-muted">No decision snapshot.</p>
            )}
            <h4 className="mt-3 font-bold">Case episodes</h4>
            <ul className="text-xs">
              {data.caseHistory.map((c) => (
                <li key={c.id}>
                  Episode {c.episodeNo} · {c.status} · opened {fmtDateTime(c.openedAt)} {c.closedAt ? `· closed ${fmtDateTime(c.closedAt)} (${c.closeReason})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
