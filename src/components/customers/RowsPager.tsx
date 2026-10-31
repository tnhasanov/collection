import Link from "next/link";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";

const Chevron = ({ left }: { left?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d={left ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Footer of a customer worklist: "1–25 / 273 müştəri" and compact page navigation (totals are distinct customers). */
export function RowsPager({ page, pageSize, total, hrefFor, locale }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string; locale: Locale }) {
  const A = (k: string, v?: Record<string, string | number>) => at(locale, k, v);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const prev = page > 1;
  const next = page < pages;
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label={A("cl.page", { page, pages })} data-testid="rows-pager">
      <span data-testid="rows-range">
        {from}–{to} / {A("cl.count", { n: total })}
      </span>
      <div className="flex items-center gap-1">
        <Link aria-disabled={!prev} tabIndex={prev ? undefined : -1} className={`row-icon !h-7 !w-7 ${prev ? "" : "pointer-events-none opacity-40"}`} href={hrefFor(Math.max(1, page - 1))} aria-label={A("cl.prev")} data-testid="pager-prev">
          <Chevron left />
        </Link>
        <span className="min-w-12 text-center tabular-nums" aria-current="page">
          <span className="text-brand">{page}</span>
          {pages > 1 ? ` / ${pages}` : ""}
        </span>
        <Link aria-disabled={!next} tabIndex={next ? undefined : -1} className={`row-icon !h-7 !w-7 ${next ? "" : "pointer-events-none opacity-40"}`} href={hrefFor(Math.min(pages, page + 1))} aria-label={A("cl.next")} data-testid="pager-next">
          <Chevron />
        </Link>
      </div>
    </nav>
  );
}
