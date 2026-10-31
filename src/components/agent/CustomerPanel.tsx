"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Tabs } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at, errorText } from "@/i18n/agentText";
import { ot } from "@/i18n/outcomeText";
import type { AgentContext } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";

type Tone = "info" | "success" | "danger" | "warning";
const PROMISE_OPEN = ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"];

export function paymentStateLabel(locale: Locale, status: string, reconciliation?: string | null) {
  if (status === "POSTED" && reconciliation && reconciliation !== "MATCHED") return `${t(locale, "agent.paymentStates.POSTED")} · ${t(locale, "agent.paymentStates.UNMATCHED")}`;
  return t(locale, `agent.paymentStates.${status}`);
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baku" });

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-ink tabular-nums">{children}</span>
    </div>
  );
}

/**
 * Right-hand customer context: a compact summary of the facts an agent needs while talking, then five tabs that
 * size to their content. Technical identifiers, model versions and audit entries stay out of the agent view; a
 * supervising role sees them under "Diagnostics".
 */
export function CustomerPanel({ ctx, locale, verified, showDiagnostics, onToast, onSent }: { ctx: AgentContext; locale: Locale; verified: boolean; showDiagnostics: boolean; onToast: (m: string, tone?: Tone) => void; onSent?: () => void }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const T = (k: string) => t(locale, k);
  const c = ctx.customer;
  const [tab, setTab] = useState("facts");
  const [sending, setSending] = useState(false);
  if (!c) return null;
  const fmtD = (v: string | null | undefined) => fmtDate(v ?? null, locale);
  const fmtDT = (v: string | null | undefined) => fmtDateTime(v ?? null, false, locale);
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  const openPromise = c.promises.find((p) => PROMISE_OPEN.includes(p.status));
  const lastOutcome = c.interactions.find((i) => (i.status === "SAVED" || i.status === "CORRECTED") && i.businessOutcome);
  const interaction = ctx.interaction;
  const inCall = !!interaction && ["OPEN", "DRAFT"].includes(interaction.status);
  const canSend = inCall && verified;
  const scopeOf = (loanId: string) => c.case?.loans.find((l) => l.loanId === loanId);
  const cooldownActive = !!c.restrictions.cooldownUntil && new Date(c.restrictions.cooldownUntil) > new Date(ctx.serverNow);
  const restrictions: string[] = [
    ...(c.customer.specialHandling ? [`${A("cust.special")}${c.customer.specialHandlingReason ? `: ${c.customer.specialHandlingReason}` : ""}`] : []),
    ...c.restrictions.openDisputes.map((d) => `${A("cust.dispute")}: ${d.reason}`),
    ...c.restrictions.supportCases.map((s) => `${ot(locale, `st.${s.type}`)}: ${s.reason}`),
    ...c.restrictions.paidClaims.map((p) => `${A("cust.claim")}${p.claimedAmount ? ` · ${fmtAzn(p.claimedAmount, true, locale)}` : ""}`),
  ];
  const promiseStatus = (s: string) => A(`ps.${s}`);
  const kindLabel = (k: string) => (A(`msg.kind.${k}`) === `msg.kind.${k}` ? "SMS" : A(`msg.kind.${k}`));
  const contactState = (v: string) => A(v === "VERIFIED" ? "cust.contactVerified" : v === "INVALID" ? "cust.contactInvalid" : "cust.contactUnverified");

  // Agent timeline: calls, payments, promises and messages in plain language (no audit entries).
  const timeline = [
    ...c.interactions.map((i) => ({
      key: `i-${i.id}`,
      at: i.startedAt,
      tone: "bg-brand",
      title: A("tl.call"),
      text: [i.technicalResult ? ot(locale, `tr.${i.technicalResult}`) : null, i.identityStatus ? ot(locale, `id.${i.identityStatus}`) : null, i.businessOutcome ? T(`agent.outcomes.${i.businessOutcome}`) : i.status === "OPEN" || i.status === "DRAFT" ? A("tl.open") : null, i.agentName].filter(Boolean).join(" · "),
    })),
    ...c.payments.map((p) => ({ key: `p-${p.id}`, at: p.eventAt, tone: "bg-success", title: A("tl.payment"), text: `${fmtAzn(p.amount, true, locale)} · ${paymentStateLabel(locale, p.status, p.reconciliation)}` })),
    ...c.promises.map((p) => ({ key: `r-${p.id}`, at: p.createdAt, tone: "bg-info", title: A("tl.promise"), text: A("cust.promiseLine", { amount: fmtAzn(p.amount), date: fmtD(p.deadlineDate), status: promiseStatus(p.status) }) })),
    ...c.messages.map((m) => ({ key: `m-${m.id}`, at: m.requestedAt, tone: "bg-muted", title: A("tl.message"), text: `${kindLabel(m.kind)} · ${A(`msg.${m.status}`)}` })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  async function sendInstructions() {
    if (!interaction) return;
    setSending(true);
    const r = await api<{ status: string; duplicate: boolean; segments: number | null; estimatedCost: string | null }>(`/api/customers/${c!.customer.id}/sms`, { templateCode: "PAY-INSTRUCTIONS-01", interactionId: interaction.id, rpcConfirmed: verified });
    setSending(false);
    if (!r.ok) onToast(errorText(locale, r.error), "warning");
    else onToast(A("sms.sent", { segments: r.data.segments ?? "?", cost: r.data.estimatedCost ?? "?" }), "success");
    onSent?.();
  }

  return (
    <div className="panel" data-testid="customer-panel">
      <div className="border-b border-line px-6 py-5" data-testid="customer-summary">
        <p className="text-[13px] text-muted">{T("agent.facts.overdue")}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="tabular-nums" data-testid="summary-overdue">
            <span className={`text-[30px] leading-9 font-medium ${Number(c.summary.overdueDueNow) > 0 ? "text-ink" : "text-success"}`}>{fmtAzn(c.summary.overdueDueNow, false, locale)}</span> <span className="text-muted">AZN</span>
          </p>
          {c.summary.maxDpd > 0 && <span className="status-chip chip-warning">{A("cd.days", { n: c.summary.maxDpd })}</span>}
        </div>
        <div className="mt-3 text-sm">
          <Line label={T("agent.facts.principal")}>{fmtAzn(c.summary.principalOutstanding, true, locale)}</Line>
          <Line label={A("cp.lastPayment")}>
            <span title={c.summary.lastVerifiedPayment ? fmtAzn(c.summary.lastVerifiedPayment.amount, true, locale) : undefined}>{c.summary.lastVerifiedPayment ? fmtD(c.summary.lastVerifiedPayment.at) : T("common.none")}</span>
          </Line>
          <Line label={A("cd.activePromise")}>
            {openPromise ? `${fmtAzn(openPromise.amount, true, locale)} · ${fmtD(openPromise.deadlineDate)} · ${promiseStatus(openPromise.status)}` : A("cd.none")}
          </Line>
        </div>
        <p className="mt-2 text-xs text-muted">{T("topbar.sourceRefreshed")} {c.summary.balancesAsOf ? TIME.format(new Date(c.summary.balancesAsOf)) : "—"}</p>
        {restrictions.length > 0 && (
          <div className="callout callout-warning mt-3 text-sm" data-testid="customer-restrictions">
            <p className="font-medium">{A("cust.restrictions")}</p>
            {restrictions.map((r) => <p key={r}>{r}</p>)}
          </div>
        )}
      </div>

      <div className="border-b border-line px-6 py-3">
        <Tabs
          idPrefix="ctx"
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "facts", label: T("agent.tabs.facts") },
            { key: "accounts", label: A("cd.loans") },
            { key: "timeline", label: T("agent.tabs.timeline") },
            { key: "related", label: A("cp.contacts") },
          ]}
        />
      </div>

      <div className="px-6 py-4 text-sm">
        {tab === "facts" && (
          <div id="ctx-panel-facts" role="tabpanel">
            <Line label={A("cp.phone")}>
              <span title={primary ? contactState(primary.verification) : undefined}>{primary ? primary.value : "—"}</span>
              {primary?.verification === "INVALID" && <span className="ml-2 text-warning">{contactState(primary.verification)}</span>}
            </Line>
            <Line label={T("agent.facts.previousOutcome")}>{lastOutcome ? T(`agent.outcomes.${lastOutcome.businessOutcome}`) : T("common.none")}</Line>
            <Line label={A("cp.nextPayment")}>{c.summary.nextDue ? fmtD(c.summary.nextDue.date) : "—"}</Line>
            {cooldownActive && <Line label={T("agent.facts.nextRoutineCall")}>{fmtDT(c.restrictions.cooldownUntil)}</Line>}
            <Line label={T("agent.facts.language")}>{c.customer.language.toUpperCase()}</Line>
            {c.decision && <Line label={A("cust.priority")}>{c.decision.actionBucket ?? "—"}</Line>}

            <div className="mt-5 flex items-center justify-between gap-3" data-testid="pay-instructions">
              <Button variant="secondary" className="min-w-44" disabled={!canSend || sending} onClick={sendInstructions} title={!inCall ? T("agent.payInstr.noCall") : !verified ? T("agent.payInstr.requiresRpc") : T("agent.payInstr.preview")} data-testid="send-pay-instructions">
                {sending ? A("ctl.working") : T("agent.tabs.payInstr")}
              </Button>
              <span className="text-sm text-muted">SMS</span>
            </div>
            {inCall && !verified && <p className="mt-1.5 text-xs text-warning">{T("agent.payInstr.requiresRpc")}</p>}
            {c.messages.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-[13px]">
                {c.messages.slice(0, 3).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 py-1.5">
                    <span className="text-muted">{fmtDT(m.requestedAt)} · {kindLabel(m.kind)}</span>
                    <span>{A(`msg.${m.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
            {showDiagnostics && c.decision && (
              <details className="mt-3 rounded-md border border-line px-3 py-2 text-xs" data-testid="customer-diagnostics">
                <summary className="cursor-pointer font-medium">{A("cust.diagnostics")}</summary>
                <p className="mt-1">{c.decision.segmentLabel} · {c.decision.effectiveActionLabel} · {c.decision.probabilitySourceLabel}{c.decision.riskClass ? ` · ${c.decision.riskClass}` : ""} · rank {c.decision.rank ?? "—"}</p>
                <p className="text-muted">{c.decision.modelVersion ?? "—"} · {c.decision.strategyVersion ?? "—"} · {c.decision.policyVersion ?? "—"}</p>
                <p className="text-muted">CIF {c.customer.cif}{interaction ? ` · ${interaction.correlationId}` : ""}</p>
              </details>
            )}
            <Link href={`/customers/${c.customer.id}`} className="mt-3 inline-block text-[13px]">{A("cust.fullProfile")} →</Link>
          </div>
        )}

        {tab === "accounts" && (
          <div id="ctx-panel-accounts" role="tabpanel" className="space-y-2">
            {c.loans.map((l) => {
              const scope = scopeOf(l.id);
              return (
                <div key={l.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-medium">{A("cust.loan")} {l.coreLoanId}</span>
                    <span className="flex gap-1">
                      {scope && !scope.inScope && <Badge tone="neutral">{A("cust.released")}</Badge>}
                      <Badge tone={l.dpd > 0 ? "danger" : "success"}>{l.dpd > 0 ? A("call.dpd", { n: l.dpd }) : l.status === "ACTIVE" ? A("cust.current") : l.status}</Badge>
                    </span>
                  </div>
                  <p className="text-[13px] text-muted">{A("cust.terms", { rate: (Number(l.nominalAnnualRate) * 100).toFixed(2), months: l.tenorMonths, installment: fmtAzn(l.regularInstallment, true, locale) })}</p>
                  {Number(l.totalOverdue) > 0 && (
                    <p>
                      <span className="font-semibold text-danger">{T("agent.facts.overdue")} {fmtAzn(l.totalOverdue, true, locale)}</span> <span className="text-[13px] text-muted">({A("cust.overdueSplit", { p: fmtAzn(l.overduePrincipal), i: fmtAzn(l.overdueInterest, true, locale) })})</span>
                    </p>
                  )}
                  <p className="text-[13px]">
                    {A("cust.outstanding")} {fmtAzn(l.principalOutstanding, true, locale)}
                    {l.nextDueDate ? ` · ${A("cust.nextDueOn", { date: fmtD(l.nextDueDate) })}` : ""}
                  </p>
                </div>
              );
            })}
            <h4 className="pt-1 text-[13px] font-semibold text-muted">{A("cust.payments")}</h4>
            {c.payments.length === 0 && c.restrictions.paidClaims.length === 0 ? (
              <p className="text-[13px] text-muted">{A("cust.noPayments")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {c.restrictions.paidClaims.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1.5">
                    <span>{A("cust.claim")}</span>
                    <span>{p.claimedAmount ? fmtAzn(p.claimedAmount, true, locale) : "—"} <Badge tone="warning">{T("agent.paymentStates.CLAIMED")}</Badge></span>
                  </li>
                ))}
                {c.payments.slice(0, 10).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1.5">
                    <span>{fmtD(p.valueDate)}{showDiagnostics ? ` · ${p.sourceTransactionId}` : ""}</span>
                    <span>
                      {fmtAzn(p.amount, true, locale)} <Badge tone={p.status === "POSTED" ? "success" : p.status === "REVERSED" ? "danger" : "warning"}>{paymentStateLabel(locale, p.status, p.reconciliation)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "timeline" && (
          <div id="ctx-panel-timeline" role="tabpanel">
            {timeline.length === 0 ? (
              <p className="text-muted">{A("tl.none")}</p>
            ) : (
              <ul className="space-y-2">
                {timeline.slice(0, 20).map((e) => (
                  <li key={e.key} className="flex gap-2">
                    <span className={`timeline-dot ${e.tone}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[13px] text-muted">{fmtDT(e.at)} · {e.title}</div>
                      <div>{e.text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "related" && (
          <div id="ctx-panel-related" role="tabpanel" className="space-y-2">
            {c.relatedParties.length === 0 && <p className="text-muted">{T("agent.related.none")}</p>}
            {c.relatedParties.map((r) => (
              <div key={r.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium">{r.displayName}</span>
                  <Badge tone="brand">{T(`agent.related.roles.${r.role}`)}</Badge>
                </div>
                <p className="text-[13px] text-muted">{[r.relation, r.phoneMasked, A(`rel.${r.verification}`)].filter(Boolean).join(" · ")}</p>
                <p className={`text-[13px] ${r.disclosureAllowed ? "text-success" : "text-warning"}`}>{r.disclosureAllowed ? T("agent.related.allowed") : T("agent.related.notAllowed")}</p>
                {r.contactRules && <p className="text-[13px]">{r.contactRules}</p>}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
