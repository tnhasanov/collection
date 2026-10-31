"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";

const SORTS = ["overdue", "dpd", "loans", "name"] as const;

/**
 * Worklist controls (28 px): tabs All / Callbacks / Promises on the left, show and sort on the right. Changing a
 * control applies it at once (no separate submit) and returns to page 1.
 */
export function ListControls({ locale, base, current }: { locale: Locale; base: string; current: { q: string; tab: string; filter: string; sort: string; dir: string } }) {
  const A = (k: string, v?: Record<string, string>) => at(locale, k, v);
  const router = useRouter();
  const href = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.tab !== "all") p.set("tab", next.tab);
    if (next.filter !== "overdue") p.set("filter", next.filter);
    if (next.sort !== "overdue") p.set("sort", next.sort);
    if (next.dir) p.set("dir", next.dir);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <nav className="seg" aria-label={A("cl.title.customers")} data-testid="cl-tabs">
        {(["all", "callbacks", "promises"] as const).map((k) => (
          <Link key={k} href={href({ tab: k })} aria-current={current.tab === k ? "page" : undefined} data-testid={`cl-tab-${k}`}>
            {A(`cl.tab.${k}`)}
          </Link>
        ))}
      </nav>
      {current.q && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-light pr-1 pl-2.5 text-sm text-brand" data-testid="cl-search-chip">
          {A("cl.searchChip", { q: current.q })}
          <Link href={href({ q: "" })} className="row-icon !text-brand" aria-label={A("cl.clearSearch")} title={A("cl.clearSearch")}>
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </Link>
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted">
        <label htmlFor="cl-filter">{A("cl.showLabel")}</label>
        <select id="cl-filter" className="select-compact" value={current.filter} onChange={(e) => router.push(href({ filter: e.target.value }))} data-testid="cl-filter">
          <option value="overdue">{A("cl.filter.overdue")}</option>
          <option value="active">{A("cl.filter.active")}</option>
        </select>
        <label htmlFor="cl-sort" className="ml-2">{A("cl.sortLabel")}</label>
        <select id="cl-sort" className="select-compact" value={current.sort} onChange={(e) => router.push(href({ sort: e.target.value, dir: "" }))} data-testid="cl-sort">
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {A(`cl.sort.${s}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
