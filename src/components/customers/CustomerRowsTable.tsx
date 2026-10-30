"use client";
import { useCallback, useRef, useState } from "react";
import { fmtAzn, fmtDate } from "@/lib/format";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";
import type { JsonOf } from "@/components/agent/types";
import type { CustomerRow } from "@/server/modules/customers/customerListService";
import { CustomerDetailPanel, workLabel, workTone, type PanelSection } from "@/components/customers/CustomerDetailPanel";

type Row = JsonOf<CustomerRow>;

const TONE_CLASS: Record<string, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-canvas text-ink",
};

/**
 * One customer = one compact row: name, CIF, loan count, total overdue, highest DPD and the next work, each on a single
 * line. Long values are truncated with the full text in a tooltip. The name (or the loan count, or the details button)
 * opens the read-only detail panel; the list keeps its position and highlights the selected customer.
 */
export function CustomerRowsTable({ rows, locale, variant, caption }: { rows: Row[]; locale: Locale; variant: "customers" | "queue"; caption: string }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const [open, setOpen] = useState<{ id: string; name: string; section: PanelSection } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const queue = variant === "queue";

  const show = (row: Row, section: PanelSection, el: HTMLElement | null) => {
    trigger.current = el;
    setSelected(row.id);
    setOpen({ id: row.id, name: row.displayName, section });
  };
  const close = useCallback(() => {
    // Back to where the user was: the button that opened the panel, in an unchanged list.
    trigger.current?.focus({ preventScroll: true });
    setOpen(null);
  }, []);

  const status = (r: Row) => {
    if (r.next) {
      const label = workLabel(locale, r.next.code, r.next.dueAt);
      const reasons = r.next.reasons.map((x) => A(`pol.${x}`)).join(", ");
      const full = [label, reasons].filter(Boolean).join(" · ");
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`status-chip ${TONE_CLASS[workTone(r.next.code)] ?? TONE_CLASS.neutral}`} title={full} data-testid="row-next">
            {label}
          </span>
          {r.openWork > 1 && (
            <button type="button" className="cell-button shrink-0 text-[13px]" title={A("cl.moreTitle", { n: r.openWork - 1 })} aria-label={`${r.displayName}: ${A("cl.moreTitle", { n: r.openWork - 1 })}`} onClick={(e) => show(r, "work", e.currentTarget)} data-testid="row-more-work">
              {A("cl.more", { n: r.openWork - 1 })}
            </button>
          )}
        </span>
      );
    }
    if (r.promise) return <span className="status-chip bg-info-bg text-info" title={A(`ps.${r.promise.status}`)}>{A("cl.promise", { date: fmtDate(r.promise.deadlineDate, locale) })}</span>;
    return <span className="text-muted">{A("cl.noWork")}</span>;
  };

  return (
    <>
      <table className="rows-table" data-testid="customer-rows">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {queue && <col className="hidden w-[52px] md:table-column" />}
          <col />
          <col className="hidden w-[132px] md:table-column" />
          <col className="hidden w-[104px] md:table-column" />
          <col className="w-[88px] md:w-[132px]" />
          <col className="hidden w-[160px] md:table-column" />
          <col className="w-[132px] md:w-[236px]" />
          <col className="hidden w-[60px] md:table-column" />
        </colgroup>
        <thead>
          <tr>
            {queue && <th scope="col" className="hidden md:table-cell" title={A("cl.col.rank")}>{A("cl.col.rank")}</th>}
            <th scope="col" title={A("cl.col.customer")}>{A("cl.col.customer")}</th>
            <th scope="col" className="hidden md:table-cell" title={A("cl.col.cif")}>{A("cl.col.cif")}</th>
            <th scope="col" className="num hidden md:table-cell" title={A("cl.col.loans")}>{A("cl.col.loans")}</th>
            <th scope="col" className="num" title={A("cl.col.overdue")}>{A("cl.col.overdue")}</th>
            <th scope="col" className="num hidden md:table-cell" title={A("cl.col.maxDpd")}>{A("cl.col.maxDpd")}</th>
            <th scope="col" title={A("cl.col.next")}>{A("cl.col.next")}</th>
            <th scope="col" className="hidden md:table-cell"><span className="sr-only">{A("cl.col.details")}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-selected={selected === r.id}
              data-testid="customer-row"
              data-customer={r.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a,button")) return;
                show(r, "summary", e.currentTarget.querySelector<HTMLElement>("[data-testid='row-open']"));
              }}
              className="cursor-pointer"
            >
              {queue && <td className="hidden text-muted md:table-cell">{r.rank ?? "—"}</td>}
              <td>
                <button type="button" className="cell-button" title={r.displayName} onClick={(e) => show(r, "summary", e.currentTarget)} aria-haspopup="dialog" data-testid="row-open">
                  {r.displayName}
                </button>
              </td>
              <td className="hidden text-muted md:table-cell" title={r.cif}>{r.cif}</td>
              <td className="num hidden md:table-cell">
                <button type="button" className="cell-button ml-auto" onClick={(e) => show(r, "loans", e.currentTarget)} aria-label={`${r.displayName}: ${r.loans === 1 ? A("cl.loans1") : A("cl.loansN", { n: r.loans })}`} data-testid="row-loans">
                  {r.loans === 1 ? A("cl.loans1") : A("cl.loansN", { n: r.loans })}
                </button>
              </td>
              <td className={`num font-medium ${Number(r.totalOverdue) > 0 ? "text-danger" : "text-muted"}`} data-testid="row-overdue">
                <span className="md:hidden" title={fmtAzn(r.totalOverdue)}>{fmtAzn(r.totalOverdue, false)}</span>
                <span className="hidden md:inline">{fmtAzn(r.totalOverdue)}</span>
              </td>
              <td className="num hidden md:table-cell" data-testid="row-dpd">{r.maxDpd}</td>
              <td>{status(r)}</td>
              <td className="hidden text-right md:table-cell" style={{ textOverflow: "clip" }}>
                <button type="button" className="btn btn-ghost btn-sm px-2" onClick={(e) => show(r, "summary", e.currentTarget)} aria-label={`${A("cl.col.details")}: ${r.displayName}`} title={A("cl.col.details")} data-testid="row-details">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <CustomerDetailPanel key={open.id} customerId={open.id} name={open.name} section={open.section} locale={locale} onClose={close} />}
    </>
  );
}
