"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, fmtShortDateTime } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";
import { ot } from "@/i18n/outcomeText";
import type { JsonOf } from "@/components/agent/types";
import type { CustomerOverview } from "@/server/modules/customers/customerListService";

export type PanelSection = "summary" | "loans" | "work";
type Overview = JsonOf<CustomerOverview>;
type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const cache = new Map<string, Overview>();

export function workTone(code: string): Tone {
  if (code === "IN_CALL" || code === "CLAIMED") return "info";
  if (code === "CALL_READY" || code === "CALLBACK_DUE") return "success";
  if (code.endsWith("_BLOCKED")) return "warning";
  return "neutral";
}

export function workLabel(locale: Locale, code: string, dueAt: string | null | undefined): string {
  return at(locale, `cl.work.${code}`, { date: dueAt ? fmtShortDateTime(dueAt) : "" });
}

/**
 * Right-side, read-only customer panel shared by the customer lists. Opening it never claims work, reserves the
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

  // Focus the requested section once it is rendered ("2 kredit" opens the loans directly).
  const loaded = !!data;
  useEffect(() => {
    const target = section === "loans" ? loansRef.current : section === "work" ? workRef.current : titleRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }, [section, customerId, loaded]);

  const fmtD = (v: string | null | undefined) => fmtDate(v ?? null, locale);
  const s = data?.summary;
  const next = data?.work.find((w) => w.next) ?? null;
  const others = data?.work.filter((w) => !w.next) ?? [];
  const blockers = (reasons: string[]) => reasons.map((r) => A(`pol.${r}`)).join(", ");

  return (
    <aside className="detail-panel" role="dialog" aria-modal="false" aria-labelledby="cd-title" data-testid="customer-detail-panel">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="cd-title" ref={titleRef} tabIndex={-1} className="truncate text-lg font-semibold text-ink focus:outline-none" title={data?.customer.displayName ?? name}>
            {data?.customer.displayName ?? name}
          </h2>
          <p className="text-[13px] text-muted">{data ? `${data.customer.cif} · ${data.customer.branch}` : A("cd.loading")}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label={A("cd.close")} data-testid="detail-close">
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto text-sm">
        {error && <p className="callout callout-danger m-4">{A("cd.error")}</p>}
        {!data && !error && <p className="p-4 text-muted">{A("cd.loading")}</p>}
        {data && s && (
          <>
            <section className="px-4 py-3" aria-labelledby="cd-summary" data-testid="detail-summary">
              <h3 id="cd-summary" className="sr-only">{A("cd.summary")}</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt className="text-[13px] text-muted">{A("cl.col.overdue")}</dt><dd className={`font-semibold ${Number(s.totalOverdue) > 0 ? "text-danger" : "text-success"}`}>{fmtAzn(s.totalOverdue)}</dd></div>
                <div><dt className="text-[13px] text-muted">{A("cl.col.maxDpd")}</dt><dd className="font-semibold">{s.maxDpd}</dd></div>
                <div><dt className="text-[13px] text-muted">{A("cl.col.loans")}</dt><dd>{s.loans}</dd></div>
                <div><dt className="text-[13px] text-muted">{A("cd.principal")}</dt><dd>{fmtAzn(s.principalOutstanding)}</dd></div>
                {data.decision && (
                  <>
                    <div><dt className="text-[13px] text-muted">{A("cd.bucket")}</dt><dd>{data.decision.bucket ?? "—"}</dd></div>
                    <div><dt className="text-[13px] text-muted">{A("cd.era")}</dt><dd>{data.decision.era ? fmtAzn(data.decision.era) : "—"}</dd></div>
                  </>
                )}
              </dl>
              {s.balancesAsOf && <p className="mt-2 text-[13px] text-muted">{A("cd.balancesAsOf", { date: fmtDateTime(s.balancesAsOf, false, locale) })}</p>}
            </section>

            <section className="px-4 py-3" aria-labelledby="cd-work" data-testid="detail-work">
              <h3 id="cd-work" ref={workRef} tabIndex={-1}>{A("cd.work")}</h3>
              {!next ? (
                <p className="mt-1 text-muted">{A("cd.noWork")}</p>
              ) : (
                <div className="mt-2 space-y-1">
                  <Badge tone={workTone(next.code)}>{workLabel(locale, next.code, next.dueAt)}</Badge>
                  <p className="text-[13px] text-muted">
                    {[next.dueAt ? A("cd.due", { date: fmtDateTime(next.dueAt, false, locale) }) : null, next.owner ? A("cd.owner", { name: next.owner }) : A("cd.pool")].filter(Boolean).join(" · ")}
                  </p>
                  {next.reasons.length > 0 && (
                    <p className="text-[13px] text-warning">
                      {blockers(next.reasons)}
                      {next.nextEligibleAt ? ` · ${A("cd.until", { date: fmtDateTime(next.nextEligibleAt, false, locale) })}` : ""}
                    </p>
                  )}
                  {next.reason && <p className="text-[13px] text-muted">{next.reason}</p>}
                </div>
              )}
              {others.length > 0 && (
                <>
                  <h4 className="mt-3 text-[13px] font-medium text-muted">{A("cd.otherWork")}</h4>
                  <ul className="mt-1 space-y-1" data-testid="detail-other-work">
                    {others.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={workTone(w.code)}>{workLabel(locale, w.code, w.dueAt)}</Badge>
                        <span className="text-[13px] text-muted">{[w.dueAt ? fmtDateTime(w.dueAt, false, locale) : null, w.reasons.length ? blockers(w.reasons) : null].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="px-4 py-3" aria-labelledby="cd-loans" data-testid="detail-loans">
              <h3 id="cd-loans" ref={loansRef} tabIndex={-1}>
                {A("cd.loans")} <span className="font-normal text-muted">({data.loans.length})</span>
              </h3>
              <ul className="mt-2 space-y-2">
                {data.loans.map((l) => (
                  <li key={l.id} className="rounded-md border border-line p-3" data-testid="detail-loan">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/loans/${l.id}`} className="font-medium" title={A("cd.loanOpen")}>{l.coreLoanId}</Link>
                      {l.status !== "ACTIVE" ? <Badge tone="neutral">{A("cd.closedLoan")}</Badge> : <Badge tone={l.dpd > 0 ? "danger" : "success"}>{l.dpd > 0 ? at(locale, "call.dpd", { n: l.dpd }) : A("cust.current")}</Badge>}
                    </div>
                    {Number(l.totalOverdue) > 0 && (
                      <p className="mt-1">
                        <span className="font-semibold text-danger">{A("cd.overdue")} {fmtAzn(l.totalOverdue)}</span>{" "}
                        <span className="text-[13px] text-muted">({A("cd.split", { p: fmtAzn(l.overduePrincipal, false), i: fmtAzn(l.overdueInterest, false) })})</span>
                      </p>
                    )}
                    <p className="text-[13px] text-muted">
                      {A("cd.principal")} {fmtAzn(l.principalOutstanding)}
                      {l.nextDueDate ? ` · ${A("cd.nextDue", { date: fmtD(l.nextDueDate) })}${l.nextDueAmount ? ` · ${fmtAzn(l.nextDueAmount)}` : ""}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="px-4 py-3" aria-labelledby="cd-promises" data-testid="detail-promises">
              <h3 id="cd-promises">{A("cd.promises")}</h3>
              {data.promises.length === 0 ? (
                <p className="mt-1 text-muted">{A("cd.noPromises")}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.promises.map((p) => (
                    <li key={p.id} className="rounded-md border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{fmtAzn(p.amount)} · {fmtD(p.deadlineDate)}</span>
                        <Badge tone={p.status === "BROKEN" ? "danger" : p.status === "ACTIVE" ? "info" : "warning"}>{A(`ps.${p.status}`)}</Badge>
                      </div>
                      <p className="text-[13px] text-muted">{A("cd.paid", { paid: fmtAzn(p.paid, false), rest: fmtAzn(p.remaining, false) })}</p>
                      <p className="text-[13px]">{A("cd.covers", { loans: p.loans.map((l) => l.coreLoanId).join(", ") || "—" })}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="px-4 py-3" aria-labelledby="cd-last" data-testid="detail-last-contact">
              <h3 id="cd-last">{A("cd.last")}</h3>
              {!data.lastContact ? (
                <p className="mt-1 text-muted">{A("cd.noContact")}</p>
              ) : (
                <p className="mt-1">
                  {fmtDateTime(data.lastContact.at, false, locale)} ·{" "}
                  {[data.lastContact.technicalResult ? ot(locale, `tr.${data.lastContact.technicalResult}`) : null, data.lastContact.identityStatus ? ot(locale, `id.${data.lastContact.identityStatus}`) : null, data.lastContact.businessOutcome ? t(locale, `agent.outcomes.${data.lastContact.businessOutcome}`) : null, data.lastContact.agentName].filter(Boolean).join(" · ")}
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <Link href={`/customers/${customerId}`} className="btn btn-secondary" data-testid="detail-profile">
          {A("cd.profile")}
        </Link>
        <span className="text-[13px] text-muted">{A("cd.readOnly")}</span>
      </footer>
    </aside>
  );
}
