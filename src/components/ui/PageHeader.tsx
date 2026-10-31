import * as React from "react";

/**
 * Page header: title with an optional muted line under it (count, date) and actions on the right. `kicker` is a short
 * context label above the title on management screens; worklists use `compact` (22px title, tighter spacing).
 */
export function PageHeader({ kicker, title, lead, meta, actions, compact }: { kicker?: string; title: string; lead?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`${compact ? "mb-4" : "mb-6"} flex flex-wrap items-start justify-between gap-3`}>
      <div className="min-w-0">
        {kicker && <p className="page-kicker">{kicker}</p>}
        <h1 className={compact ? "page-title page-title-compact" : "page-title"}>{title}</h1>
        {meta && <p className="mt-1 text-sm text-muted" data-testid="page-meta">{meta}</p>}
        {lead && <p className="page-lead mt-1 max-w-3xl">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
