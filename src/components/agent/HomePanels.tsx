"use client";
import Link from "next/link";
import { Badge, Card, EmptyState, Kpi } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, fmtDuration, fmtPct, humanize } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext } from "@/components/agent/types";

export function HomePanels({ ctx, locale }: { ctx: AgentContext; locale: Locale }) {
  const tt = (k: string) => t(locale, k);
  const m = ctx.metrics;
  const p = ctx.panels;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={tt("agent.home.attempts")} value={m ? `${m.attempts} / ${m.uniqueCustomers}` : "—"} note={tt("agent.home.attemptsNote")} />
        <Kpi label={tt("agent.home.rpc")} value={m ? m.rpc : "—"} note={m?.rpcRateAttempt !== null && m ? `RPC rate ${fmtPct(m.rpcRateAttempt)} (attempt-based)` : "RPC requires identity verification"} />
        <Kpi label={tt("agent.home.promises")} value={m ? m.promises : "—"} note={m ? `${fmtAzn(m.promisedAmount)} promised · ${m.promisesDueToday} due today · commitments, not cash` : ""} />
        <Kpi label={tt("agent.home.cash")} value={m ? fmtAzn(m.attributedCash) : "—"} note={tt("agent.home.cashNote")} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={tt("agent.home.kept")} value={m?.keptRate !== null && m ? fmtPct(m.keptRate) : "n/a"} note={m ? `${m.keptNumerator} / ${m.keptDenominator} matured promises; not-yet-due excluded` : ""} />
        <Kpi label={tt("agent.home.talk")} value={m ? `${fmtDuration(m.avgTalkSeconds)} / ${fmtDuration(m.avgAcwSeconds)}` : "—"} note="System-derived durations" />
        <Kpi label={tt("agent.home.unresolved")} value={m ? m.unresolvedWrapUps : "—"} note="Next call blocked until saved and acknowledged" tone={m && m.unresolvedWrapUps > 0 ? "warning" : undefined} />
        <Kpi label={tt("agent.home.quality")} value="n/a" note="No valid QA feed in the demo" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title={tt("agent.home.callbacks")} subtitle="Due time and policy eligibility control allocation; no callback bypasses a contact restriction">
          {!p || p.callbacks.length === 0 ? (
            <EmptyState title="No callbacks assigned" />
          ) : (
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Requested time</th>
                  <th>Reason</th>
                  <th>Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {p.callbacks.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.customerId}`}>{c.customerName}</Link>
                    </td>
                    <td>{fmtDateTime(c.dueAt)}</td>
                    <td className="text-muted">{c.reason ?? "Callback"}</td>
                    <td>{c.status === "ELIGIBLE" ? <Badge tone="success">Eligible now</Badge> : <Badge tone="warning">{c.reasons.map(humanize).join(", ") || humanize(c.status)}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={tt("agent.home.promisesDue")} subtitle="Scoped to authorized follow-up ownership">
          {!p || p.promises.length === 0 ? (
            <EmptyState title="No promises due" />
          ) : (
            <ul className="divide-y divide-line">
              {p.promises.map((pr) => (
                <li key={pr.id} className="flex items-center justify-between py-2">
                  <div>
                    <Link href={`/customers/${pr.customerId}`} className="font-medium">
                      {pr.customerName}
                    </Link>
                    <p className="text-xs text-muted">
                      {fmtAzn(pr.amount)} · due {fmtDate(pr.deadlineDate)}
                      {Number(pr.remaining) > 0 && Number(pr.remaining) < Number(pr.amount) ? ` · ${fmtAzn(pr.remaining)} remaining` : ""}
                    </p>
                  </div>
                  <Badge tone={pr.status === "KEPT" ? "success" : pr.status === "BROKEN" ? "danger" : pr.status === "PENDING_RECONCILIATION" ? "warning" : pr.status === "PARTIALLY_PAID" ? "warning" : "info"}>{humanize(pr.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title={tt("agent.home.readiness")} subtitle="Progressive automatic distribution">
          <p className="text-sm">{tt("agent.home.readinessText")}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone={ctx.interaction && ctx.interaction.status === "DRAFT" ? "warning" : "success"}>{tt("agent.home.draft")}: {ctx.interaction && ctx.interaction.status === "DRAFT" ? tt("agent.home.pendingSave") : tt("agent.home.nonePending")}</Badge>
            <Badge tone="neutral">{tt("agent.home.campaign")}: {ctx.session?.campaignCodes.join(", ") || "—"}</Badge>
          </div>
          {p && p.recent.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.home.recent")}</h3>
              <ul className="divide-y divide-line text-sm">
                {p.recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="text-xs text-muted">{fmtDateTime(r.startedAt)}</span>
                    <Link href={`/customers/${r.customerId}`}>{r.customerName}</Link>
                    <span className="text-xs text-muted">
                      {humanize(r.technicalResult)} · {r.identityStatus ? tt(`agent.identity.${r.identityStatus}`) : "—"} · {r.businessOutcome ? tt(`agent.outcomes.${r.businessOutcome}`) : "—"} → {humanize(r.nextAction)}
                    </span>
                    {r.wrapUpStatus === "FAILED" && <Badge tone="danger">Wrap-up failed</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title={tt("agent.home.tasks")} subtitle="Disputes, support referrals, reconciliation and promise follow-ups">
          {!p || p.tasks.length === 0 ? (
            <EmptyState title="No open tasks" />
          ) : (
            <ul className="space-y-1 text-sm">
              {p.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span>
                    {humanize(t.type)} ·{" "}
                    <Link href={`/customers/${t.customerId}`}>{t.customerName}</Link>
                  </span>
                  <span className="text-xs text-muted">{fmtDateTime(t.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
                  </Card>
      </div>
    </>
  );
}
