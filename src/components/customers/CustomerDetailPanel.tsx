"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtAzn, fmtDate, fmtDateTime } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";
import { ot } from "@/i18n/outcomeText";
import type { JsonOf } from "@/components/agent/types";
import type { CustomerOverview } from "@/server/modules/customers/customerListService";

export type PanelSection = "summary" | "loans" | "work";
type Overview = JsonOf<CustomerOverview>;

const cache = new Map<string, Overview>();

/** Restrained status fill for a work status code (purple = callback/active, green = ready, amber = needs attention). */
export function workChip(code: string): string {
  if (code === "IN_CALL" || code === "CLAIMED" || code.startsWith("CALLBACK")) return code === "CALLBACK_BLOCKED" ? "chip-warning" : "chip-brand";
  if (code === "CALL_READY") return "chip-success";
  if (code === "CALL_BLOCKED" || code === "PTP_FOLLOWUP" || code === "RECONCILIATION" || code === "DISPUTE_REVIEW") return "chip-warning";
  return "chip-neutral";
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1" data-testid={testId}>
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums text-ink">{children}</span>
    </div>
  );
}

/**
 * Right-side, read-only customer drawer shared by the customer lists. Opening it never claims work, reserves the
 * customer or starts a call; it only reads the overview (scoped and audited on the server). Escape closes it and the
 * list keeps its position and selection.
 */
export function CustomerDetailPanel({ customerId, name, section, locale, onClose }: { customerId: string; name: string; section: PanelSection; locale: Locale; onClose: () => void }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const [data, setData] = useState<Overview | null>(() => cache.get(customerId) ?? null);
  const [error, setError] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const loansRef = useRef<HTMLHeadingElement>(null);
  const workRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/customers/${customerId}/overview`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body?.ok) {
          cache.set(customerId, body.data);
          setData(body.data);
          setError(false);
        } else setError(true);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError(true);
      });
    return () => ctrl.abort();
  }, [customerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus the requested section once it is rendered (the loan count opens the loans directly).
  const loaded = !!data;
  useEffect(() => {
    const target = section === "loans" ? loansRef.current : section === "work" ? workRef.current : titleRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (section !== "summary") target.scrollIntoView({ block: "start" });
  }, [section, customerId, loaded]);

  const money = (v: string | null | undefined, cur = true) => fmtAzn(v ?? null, cur, locale);
  const fmtD = (v: string | null | undefined) => fmtDate(v ?? null, locale);
  const fmtDT = (v: string | null | undefined) => fmtDateTime(v ?? null, false, locale);
  const s = data?.summary;
  const next = data?.work.find((w) => w.next) ?? null;
  const others = data?.work.filter((w) => !w.next) ?? [];
  const blockers = (reasons: string[]) => reasons.map((r) => A(`pol.${r}`)).join(", ");
  const days = (n: number) => A("cd.days", { n });
  const last = data?.lastContact ?? null;
  const lastLine = last ? [last.technicalResult ? ot(locale, `tr.${last.technicalResult}`) : null, last.identityStatus ? ot(locale, `id.${last.identityStatus}`) : null, last.businessOutcome ? t(locale, `agent.outcomes.${last.businessOutcome}`) : null, last.agentName].filter(Boolean).join(" · ") : "";

  return (
    <aside className="detail-panel" role="dialog" aria-modal="false" aria-labelledby="cd-title" data-testid="customer-detail-panel">
      <header className="flex items-start gap-3 border-b border-line px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h2 id="cd-title" ref={titleRef} tabIndex={-1} className="truncate text-[22px] leading-7 font-medium text-ink focus:outline-none" title={data?.customer.displayName ?? name}>
            {data?.customer.displayName ?? name}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{data ? `CIF ${data.customer.cif.replace(/^CIF-/, "")}` : A("cd.loading")}</p>
        </div>
        <button type="button" className="row-icon !h-8 !w-8" onClick={onClose} aria-label={A("cd.close")} data-testid="detail-close">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="callout callout-danger m-6">{A("cd.error")}</p>}
        {!data && !error && <p className="px-6 py-4 text-muted">{A("cd.loading")}</p>}
        {data && s && (
          <>
            <section className="px-6 py-5" aria-labelledby="cd-summary" data-testid="detail-summary">
              <h3 id="cd-summary" className="!text-[13px] !font-normal !text-muted">{t(locale, "agent.facts.overdue")}</h3>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="tabular-nums">
                  <span className={`text-[30px] leading-9 font-medium ${Number(s.totalOverdue) > 0 ? "text-ink" : "text-success"}`}>{money(s.totalOverdue, false)}</span> <span className="text-muted">AZN</span>
                </p>
                {s.maxDpd > 0 && <span className="status-chip chip-warning">{days(s.maxDpd)}</span>}
              </div>
              <div className="mt-3">
                <Row label={A("cd.principal")}>{money(s.principalOutstanding)}</Row>
                {data.decision && (
                  <>
                    <Row label={A("cd.bucket")}>{data.decision.bucket ?? "—"}</Row>
                    {data.decision.era && <Row label={A("cd.era")}>{money(data.decision.era)}</Row>}
                  </>
                )}
              </div>
            </section>

            <section className="px-6 py-5" aria-labelledby="cd-loans" data-testid="detail-loans">
              <div className="flex items-baseline justify-between">
                <h3 id="cd-loans" ref={loansRef} tabIndex={-1}>{A("cd.loans")}</h3>
                <span className="text-muted">{data.loans.length}</span>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {data.loans.map((l) => (
                  <li key={l.id} className="py-3" data-testid="detail-loan">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/loans/${l.id}`} className="font-medium text-ink hover:text-brand" title={A("cd.loanOpen")}>{l.coreLoanId}</Link>
                      <span className="tabular-nums">{l.status !== "ACTIVE" ? <span className="text-muted">{A("cd.closedLoan")}</span> : money(l.totalOverdue)}</span>
                    </div>
                    {l.status === "ACTIVE" && (
                      <p className="mt-0.5 text-[13px] text-muted">
                        {[l.dpd > 0 ? days(l.dpd) : A("cust.current"), Number(l.totalOverdue) > 0 ? A("cd.split", { p: money(l.overduePrincipal, false), i: money(l.overdueInterest, false) }) : null].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {A("cd.principal")} {money(l.principalOutstanding)}
                      {l.nextDueDate ? ` · ${A("cd.nextDue", { date: fmtD(l.nextDueDate) })}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="px-6 py-5" aria-labelledby="cd-work" data-testid="detail-work">
              <h3 id="cd-work" ref={workRef} tabIndex={-1}>{A("cd.work")}</h3>
              {!next ? (
                <p className="mt-2 text-muted">{A("cd.noWork")}</p>
              ) : (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`status-chip ${workChip(next.code)}`}>{A(`cl.work.${next.code}`)}</span>
                    <span className="tabular-nums text-ink">{next.dueAt ? fmtDT(next.dueAt) : ""}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{next.owner ? A("cd.owner", { name: next.owner }) : A("cd.pool")}</p>
                  {next.reasons.length > 0 && (
                    <p className="mt-1 text-[13px] text-warning">
                      {blockers(next.reasons)}
                      {next.nextEligibleAt ? ` · ${A("cd.until", { date: fmtDT(next.nextEligibleAt) })}` : ""}
                    </p>
                  )}
                </div>
              )}
              {others.length > 0 && (
                <>
                  <h4 className="mt-4 text-[13px] text-muted">{A("cd.otherWork")}</h4>
                  <ul className="mt-1.5 space-y-1.5" data-testid="detail-other-work">
                    {others.map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-3">
                        <span className={`status-chip ${workChip(w.code)}`}>{A(`cl.work.${w.code}`)}</span>
                        <span className="truncate text-[13px] text-muted">{[w.dueAt ? fmtDT(w.dueAt) : null, w.reasons.length ? blockers(w.reasons) : null].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="px-6 py-5" aria-labelledby="cd-last" data-testid="detail-last-contact">
              <h3 id="cd-last">{A("cd.lastConversation")}</h3>
              {!last ? (
                <p className="mt-2 text-muted">{A("cd.noContact")}</p>
              ) : (
                <>
                  <p className="mt-2 text-[13px] text-muted tabular-nums">{fmtDT(last.at)}</p>
                  <p className="mt-1 leading-relaxed text-ink">{last.summary || lastLine}</p>
                  {last.summary && <p className="mt-1 text-xs text-muted">{lastLine}</p>}
                </>
              )}
            </section>

            <section className="px-6 py-5" aria-labelledby="cd-promises" data-testid="detail-promises">
              {data.promises.length === 0 ? (
                <Row label={A("cd.activePromise")}>
                  <span id="cd-promises">{A("cd.none")}</span>
                </Row>
              ) : (
                <>
                  <h3 id="cd-promises">{A("cd.promises")}</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {data.promises.map((p) => (
                      <li key={p.id} className="py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="tabular-nums">{money(p.amount)} · {fmtD(p.deadlineDate)}</span>
                          <span className={`status-chip ${p.status === "BROKEN" ? "chip-warning" : p.status === "ACTIVE" ? "chip-success" : "chip-neutral"}`}>{A(`ps.${p.status}`)}</span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted">{A("cd.paid", { paid: money(p.paid, false), rest: money(p.remaining, false) })} · {A("cd.covers", { loans: p.loans.map((l) => l.coreLoanId).join(", ") || "—" })}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="border-t border-line px-6 py-4">
        <Link href={`/customers/${customerId}`} className="btn btn-primary w-full !text-white" data-testid="detail-profile">
          {A("cd.profile")}
        </Link>
        <p className="mt-2 text-center text-xs text-muted">{A("cd.readOnly")}</p>
      </footer>
    </aside>
  );
}
