"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Dl, Tabs } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";

export function paymentStateLabel(locale: Locale, status: string, reconciliation?: string | null) {
  if (status === "POSTED" && reconciliation && reconciliation !== "MATCHED") return `${t(locale, "agent.paymentStates.POSTED")} · ${humanize(reconciliation)}`;
  return t(locale, `agent.paymentStates.${status}`);
}

/**
 * Right-hand details for the current customer: facts, read-only accounts with explicit payment states, the
 * customer-wide timeline, related persons (role, source, verification, disclosure rule) and payment instructions.
 */
export function DetailsTabs({ ctx, locale, verified, showDiagnostics, onToast, onSent }: { ctx: AgentContext; locale: Locale; verified: boolean; showDiagnostics: boolean; onToast: (m: string, tone?: "info" | "success" | "danger" | "warning") => void; onSent?: () => void }) {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const c = ctx.customer;
  const [tab, setTab] = useState("facts");
  const [sending, setSending] = useState(false);
  if (!c) return null;
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  const activePromise = c.promises.find((p) => ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"].includes(p.status));
  const lastOutcome = c.interactions.find((i) => i.status === "SAVED" || i.status === "CORRECTED");
  const blocked = c.restrictions.openDisputes.length + c.restrictions.supportCases.length + c.restrictions.paidClaims.length;
  const interaction = ctx.interaction;
  const canSendInstructions = !!interaction && ["OPEN", "DRAFT"].includes(interaction.status) && verified;
  const scopeOf = (loanId: string) => c.case?.loans.find((l) => l.loanId === loanId);
  async function sendInstructions() {
    if (!interaction) return;
    setSending(true);
    const r = await api<{ status: string; duplicate: boolean; segments: number | null; estimatedCost: string | null }>(`/api/customers/${c!.customer.id}/sms`, { templateCode: "PAY-INSTRUCTIONS-01", interactionId: interaction.id, rpcConfirmed: verified });
    setSending(false);
    if (!r.ok) onToast(`${r.error.message}${(r.error.details as { reasons?: string[] } | undefined)?.reasons ? `: ${(r.error.details as { reasons: string[] }).reasons.join(", ")}` : ""}`, "warning");
    else onToast(`${tt("agent.payInstr.sent")}${r.data.duplicate ? " (duplicate ignored)" : ""} · ${r.data.segments ?? "?"} ${tt("agent.payInstr.segments")} · ${tt("agent.payInstr.cost")} ${r.data.estimatedCost ?? "?"} AZN`, "success");
    onSent?.();
  }
  return (
    <div className="drawer-tabs">
      <Tabs idPrefix="ctx" active={tab} onChange={setTab} tabs={[{ key: "facts", label: tt("agent.tabs.facts") }, { key: "accounts", label: tt("agent.tabs.accounts"), count: c.loans.length }, { key: "timeline", label: tt("agent.tabs.timeline"), count: c.timeline.length }, { key: "related", label: tt("agent.tabs.related"), count: c.relatedParties.length }, { key: "pay", label: tt("agent.tabs.payInstr") }]} />
      {tab === "facts" && (
        <div id="ctx-panel-facts" role="tabpanel" className="space-y-3 text-sm">
          <Dl
            items={[
              { label: tt("agent.facts.contact"), value: `${primary?.type ?? "—"} ${primary?.value ?? ""} (${primary?.verification.toLowerCase() ?? "n/a"})` },
              { label: tt("agent.facts.language"), value: c.customer.language },
              { label: tt("agent.facts.overdue"), value: <span className="font-semibold text-danger">{fmtAzn(c.summary.overdueDueNow)}</span> },
              { label: tt("agent.facts.principal"), value: fmtAzn(c.summary.principalOutstanding) },
              { label: tt("agent.facts.nextInstallment"), value: c.summary.nextDue ? `${fmtDate(c.summary.nextDue.date)} · ${fmtAzn(c.summary.nextDue.amount)}` : "—" },
              { label: tt("agent.facts.lastPayment"), value: c.summary.lastVerifiedPayment ? `${fmtAzn(c.summary.lastVerifiedPayment.amount)} · ${fmtDateTime(c.summary.lastVerifiedPayment.at)}` : tt("common.none") },
              { label: tt("agent.facts.balancesAsOf"), value: fmtDateTime(c.summary.balancesAsOf) },
              { label: tt("agent.facts.previousOutcome"), value: lastOutcome ? `${tt(`agent.outcomes.${lastOutcome.businessOutcome}`)} · ${fmtDateTime(lastOutcome.startedAt)}` : tt("common.none") },
              { label: tt("agent.facts.activePromise"), value: activePromise ? `${fmtAzn(activePromise.amount)} · ${fmtDate(activePromise.deadlineDate)} (${humanize(activePromise.status)})` : tt("agent.facts.noPromise") },
              { label: tt("agent.facts.nextRoutineCall"), value: c.restrictions.cooldownUntil && new Date(c.restrictions.cooldownUntil) > new Date(ctx.serverNow) ? fmtDateTime(c.restrictions.cooldownUntil) : "—" },
            ]}
          />
          {c.decision && (
            <div className="rounded-md bg-brand-light p-2 text-xs">
              <p className="font-semibold text-brand-dark">{tt("agent.facts.why")}</p>
              <p>
                {c.decision.segmentLabel} · ERA {fmtAzn(c.decision.era)} · bucket {c.decision.actionBucket ?? "—"} · {c.decision.effectiveActionLabel}
                {showDiagnostics ? ` · ${c.decision.probabilitySourceLabel}${c.decision.riskClass ? ` · class ${c.decision.riskClass}` : ""} · rank ${c.decision.rank ?? "—"}` : ""}
              </p>
            </div>
          )}
          {(blocked > 0 || c.customer.specialHandling) && (
            <div className="callout callout-warning text-xs">
              <p className="font-semibold">{tt("agent.facts.restrictions")}</p>
              {c.customer.specialHandling && <p>{c.customer.specialHandlingReason}</p>}
              {c.restrictions.openDisputes.map((d) => <p key={d.id}>{tt("agent.outcomes.DISPUTE")}: {d.reason}</p>)}
              {c.restrictions.supportCases.map((s) => <p key={s.id}>{humanize(s.type)}: {s.reason}</p>)}
              {c.restrictions.paidClaims.map((p) => <p key={p.id}>{tt("agent.paymentStates.CLAIMED")} {p.claimedAmount ? fmtAzn(p.claimedAmount) : ""}</p>)}
            </div>
          )}
        </div>
      )}
      {tab === "accounts" && (
        <div id="ctx-panel-accounts" role="tabpanel" className="space-y-2 text-sm">
          {c.loans.map((l) => {
            const scope = scopeOf(l.id);
            return (
              <div key={l.id} className="rounded-md border border-line p-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium">{l.coreLoanId}</span>
                  <span className="flex gap-1">
                    {scope && <Badge tone={scope.inScope ? "info" : "neutral"}>{scope.inScope ? "in case scope" : `released · ${humanize(scope.releaseReason)}`}</Badge>}
                    <Badge tone={l.dpd > 0 ? "danger" : "success"}>{l.dpd > 0 ? `DPD ${l.dpd}` : l.status === "ACTIVE" ? "Current" : humanize(l.status)}</Badge>
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {fmtAzn(l.principalOriginal)} · {(Number(l.nominalAnnualRate) * 100).toFixed(2)}% · {l.tenorMonths} m · installment {fmtAzn(l.regularInstallment)}
                </p>
                <p className="text-xs">
                  {tt("agent.facts.overdue")} {fmtAzn(l.totalOverdue)} (principal {fmtAzn(l.overduePrincipal)} + interest {fmtAzn(l.overdueInterest)}) · outstanding {fmtAzn(l.principalOutstanding)} · next due {fmtDate(l.nextDueDate)}
                </p>
              </div>
            );
          })}
          <h4 className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("nav.payments")}</h4>
          {c.payments.length === 0 && c.restrictions.paidClaims.length === 0 && <p className="text-xs text-muted">{tt("common.none")}</p>}
          <ul className="divide-y divide-line">
            {c.restrictions.paidClaims.map((p) => (
              <li key={p.id} className="flex justify-between py-1 text-xs">
                <span>{p.reference ?? "claim"}</span>
                <span>{p.claimedAmount ? fmtAzn(p.claimedAmount) : "?"} <Badge tone="warning">{tt("agent.paymentStates.CLAIMED")}</Badge></span>
              </li>
            ))}
            {c.payments.slice(0, 10).map((p) => (
              <li key={p.id} className="flex justify-between py-1 text-xs">
                <span>{fmtDate(p.valueDate)} · {p.loanId ?? "—"}{showDiagnostics ? ` · ${p.sourceTransactionId}` : ""}</span>
                <span>
                  {fmtAzn(p.amount)} <Badge tone={p.status === "POSTED" ? "success" : p.status === "REVERSED" ? "danger" : "warning"}>{paymentStateLabel(locale, p.status, p.reconciliation)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "timeline" && (
        <div id="ctx-panel-timeline" role="tabpanel" className="text-sm">
          <ul className="space-y-1.5">
            {c.timeline.slice(0, 25).map((e) => (
              <li key={`${e.kind}-${e.id}`} className="flex gap-2">
                <span className={`timeline-dot ${e.kind === "payment" ? "bg-success" : e.kind === "promise" ? "bg-info" : e.kind === "interaction" ? "bg-brand" : "bg-muted"}`} aria-hidden="true" />
                <div>
                  <div className="text-xs text-muted">{fmtDateTime(e.at)} · {e.kind}</div>
                  <div className="text-xs">{e.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "related" && (
        <div id="ctx-panel-related" role="tabpanel" className="space-y-2 text-sm">
          {c.relatedParties.length === 0 && <p className="text-xs text-muted">{tt("agent.related.none")}</p>}
          {c.relatedParties.map((r) => (
            <div key={r.id} className="rounded-md border border-line p-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-medium">{r.displayName}</span>
                <span className="flex gap-1">
                  <Badge tone="brand">{tt(`agent.related.roles.${r.role}`)}</Badge>
                  <Badge tone={r.verification === "VERIFIED" ? "success" : r.verification === "INVALID" ? "danger" : "neutral"}>{r.verification.toLowerCase()}</Badge>
                  <Badge tone={r.disclosureAllowed ? "success" : "warning"}>{r.disclosureAllowed ? tt("agent.related.allowed") : tt("agent.related.notAllowed")}</Badge>
                </span>
              </div>
              <p className="text-xs text-muted">
                {r.relation ?? "—"} · {r.phoneMasked ?? "—"}{r.contactRules ? ` · ${r.contactRules}` : ""}
              </p>
              <p className="text-xs text-muted">{tt("agent.related.source")}: {r.sourceSystem} · {fmtDate(r.sourceAsOf)}</p>
            </div>
          ))}
        </div>
      )}
      {tab === "pay" && (
        <div id="ctx-panel-pay" role="tabpanel" className="space-y-2 text-sm">
          <p className="text-xs text-muted">{tt("agent.payInstr.preview")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" disabled={!canSendInstructions || sending} onClick={sendInstructions} title={!interaction || !["OPEN", "DRAFT"].includes(interaction.status) ? tt("agent.payInstr.noCall") : !verified ? tt("agent.payInstr.requiresRpc") : undefined} data-testid="send-pay-instructions">{sending ? "…" : tt("agent.payInstr.send")}</Button>
            {!verified && <span className="text-xs text-warning">{tt("agent.payInstr.requiresRpc")}</span>}
          </div>
          <h4 className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.payInstr.recent")}</h4>
          {c.messages.length === 0 ? <p className="text-xs text-muted">{tt("common.none")}</p> : (
            <ul className="divide-y divide-line text-xs">
              {c.messages.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-1 py-1">
                  <span>{fmtDateTime(m.requestedAt)} · {humanize(m.kind)} · {m.template ?? "—"} · {m.language}</span>
                  <span>
                    <Badge tone={m.status === "DELIVERED" ? "success" : m.status === "FAILED" || m.status === "BLOCKED" ? "danger" : "info"}>{m.status.toLowerCase()}</Badge>
                    {m.segments ? ` · ${m.segments} ${tt("agent.payInstr.segments")}` : ""}{m.estimatedCost ? ` · ${m.estimatedCost} AZN` : ""}{m.blockReason ? ` · ${m.blockReason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/customers/${c.customer.id}`} className="text-xs">{tt("common.open")} →</Link>
        </div>
      )}
    </div>
  );
}
