import * as React from "react";
import Link from "next/link";
import { cx } from "@/components/ui";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
}

/** Dense operational table (server-rendered). Sorting/pagination are driven through URL search params by the caller. */
export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing to show", selectedKey, caption, dense = true }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: string; selectedKey?: string | null; caption?: string; dense?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className={cx("table-dense", !dense && "text-base")}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.align === "right" && "num")} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} aria-selected={selectedKey === k ? true : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.align === "right" && "num")}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex items-center justify-between gap-3 py-2 text-xs text-muted" aria-label="Pagination">
      <span>
        {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of {total}
      </span>
      <div className="flex gap-1">
        <Link aria-disabled={page <= 1} className={cx("btn btn-secondary btn-sm", page <= 1 && "pointer-events-none opacity-50")} href={hrefFor(Math.max(1, page - 1))}>
          Previous
        </Link>
        <span className="px-2 py-1">
          Page {page} / {pages}
        </span>
        <Link aria-disabled={page >= pages} className={cx("btn btn-secondary btn-sm", page >= pages && "pointer-events-none opacity-50")} href={hrefFor(Math.min(pages, page + 1))}>
          Next
        </Link>
      </div>
    </nav>
  );
}
