import Link from "next/link";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";

/** Pager for customer lists: the total is a count of distinct customers. */
export function RowsPager({ page, pageSize, total, hrefFor, locale }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string; locale: Locale }) {
  const A = (k: string, v?: Record<string, string | number>) => at(locale, k, v);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px] text-muted" aria-label={A("cl.page", { page, pages })} data-testid="rows-pager">
      <span data-testid="rows-range">{A("cl.range", { from, to, total })} · {A("cl.count", { n: total })}</span>
      <div className="flex items-center gap-2">
        <Link aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={`btn btn-secondary btn-sm ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={hrefFor(Math.max(1, page - 1))} data-testid="pager-prev">
          {A("cl.prev")}
        </Link>
        <span>{A("cl.page", { page, pages })}</span>
        <Link aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined} className={`btn btn-secondary btn-sm ${page >= pages ? "pointer-events-none opacity-50" : ""}`} href={hrefFor(Math.min(pages, page + 1))} data-testid="pager-next">
          {A("cl.next")}
        </Link>
      </div>
    </nav>
  );
}
