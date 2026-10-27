"use client";
import * as React from "react";
import Link from "next/link";

import { cx } from "@/lib/cx";
export { cx };

type ButtonVariant = "primary" | "secondary" | "solid" | "danger" | "ghost";
export function Button({ variant = "secondary", size, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" }) {
  return <button type="button" className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...props} />;
}

export function LinkButton({ variant = "secondary", size, className, href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: "sm"; href: string }) {
  return (
    <Link href={href} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...props}>
      {children}
    </Link>
  );
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("badge", `badge-${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

export function Card({ title, subtitle, actions, children, className, padded = true, id }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; padded?: boolean; id?: string }) {
  return (
    <section className={cx("card", padded && "card-pad", className)} id={id} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className={cx("flex items-start justify-between gap-3", padded ? "mb-3" : "px-4 pt-4 mb-2")}>
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, note, href, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={cx("kpi-value", tone === "danger" && "text-danger", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</span>
      {note && <span className="kpi-note">{note}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="kpi hover:bg-brand-light/40 focus-visible:outline">
      {body}
    </Link>
  ) : (
    <div className="kpi">{body}</div>
  );
}

export function Callout({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("callout", `callout-${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children, required }: { label: string; htmlFor: string; error?: string | null; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span aria-hidden="true" className="text-danger"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("input", props.className)} {...props} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("select", props.className)} {...props} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("textarea", props.className)} {...props} />;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function Dl({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cx("dl-grid", className)}>
      {items.map((i) => (
        <React.Fragment key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Accessible tab strip (roving tabindex, ARIA roles). */
export function Tabs({ tabs, active, onChange, idPrefix = "tab" }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (key: string) => void; idPrefix?: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      refs.current[next]?.focus();
      onChange(tabs[next].key);
    }
  };
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-line pb-1">
      {tabs.map((t, idx) => (
        <button
          key={t.key}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          role="tab"
          type="button"
          id={`${idPrefix}-${t.key}`}
          aria-selected={active === t.key}
          aria-controls={`${idPrefix}-panel-${t.key}`}
          tabIndex={active === t.key ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKey(e, idx)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-1 text-xs text-muted">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

/** Modal dialog on the native <dialog> element: focus trap, Escape, labelled. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title" className={cx("m-auto w-[min(96vw,720px)] rounded-lg border border-line bg-surface p-0 shadow-xl backdrop:bg-brand-dark/40", wide && "w-[min(96vw,1040px)]")}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="dialog-title" className="text-base font-bold">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>
      </div>
      <div className="max-h-[80vh] overflow-auto p-4">{children}</div>
    </dialog>
  );
}

export function Toast({ message, tone = "info" }: { message: string | null; tone?: "info" | "success" | "danger" | "warning" }) {
  if (!message) return null;
  return (
    <div className={cx("fixed bottom-4 right-4 z-50 max-w-sm shadow-lg", "callout", `callout-${tone}`)} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function StatusDot({ tone }: { tone: Tone }) {
  const color = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", neutral: "bg-muted", brand: "bg-brand" }[tone];
  return <span aria-hidden="true" className={cx("inline-block h-2 w-2 rounded-full", color)} />;
}
