import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { formatAzn } from "@/server/money";
import type { FollowUpItem } from "@/server/modules/agent/followUpService";
import { at } from "@/i18n/agentText";
import { ot } from "@/i18n/outcomeText";
import type { Locale } from "@/i18n/dictionaries";

/** Server-rendered pieces of a follow-up row, shared by the follow-up list and the dashboard. */
export const DUE_TONE = { OVERDUE: "danger", TODAY: "warning", LATER: "neutral", NONE: "neutral" } as const;
const PROMISE_TONE: Record<string, "info" | "warning" | "danger" | "success" | "neutral"> = { ACTIVE: "info", PARTIALLY_PAID: "warning", PENDING_RECONCILIATION: "warning", BROKEN: "danger", KEPT: "success" };

/** The next step, or the restriction that applies now and when it ends. */
export function NextStep({ item, locale }: { item: FollowUpItem; locale: Locale }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const vars = { ...(item.next.vars ?? {}) };
  if (vars.date) vars.date = formatDate(vars.date, locale);
  if (item.eligible === false) {
    return (
      <div className="space-y-0.5" data-testid="fu-blockers">
        {item.blockers.map((b) => (
          <p key={b.code} className="text-warning">
            {A(`pol.${b.code}`)}
            <span className="text-muted"> · {b.until ? A("fu.until", { date: formatBakuDateTime(b.until, { locale }) }) : A("fu.openEnded")}</span>
          </p>
        ))}
        {item.nextEligibleAt && <p className="text-[13px] text-muted" data-testid="fu-next-eligible">{A("fu.nextEligible", { date: formatBakuDateTime(item.nextEligibleAt, { locale }) })}</p>}
      </div>
    );
  }
  return <p className={item.eligible ? "text-success" : ""}>{A(item.next.code, vars)}</p>;
}

export function Details({ item, locale }: { item: FollowUpItem; locale: Locale }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  if (item.kind === "PROMISE" && item.promise) {
    const r = item.promise.reminder;
    return (
      <div className="space-y-0.5">
        <p>
          {A("fu.promiseLine", { amount: formatAzn(item.promise.amount), paid: formatAzn(item.promise.paid, { withCurrency: false }), rest: formatAzn(item.promise.remaining, { withCurrency: false }) })} <Badge tone={PROMISE_TONE[item.status] ?? "neutral"}>{A(`ps.${item.status}`)}</Badge>
        </p>
        <p className="text-[13px] text-muted">
          {r ? A("fu.reminder", { status: A(`rem.${r.status}`).toLowerCase(), date: formatBakuDateTime(r.at, { locale }) }) : null}
          {r && item.promise.nextReminderAt ? " · " : null}
          {item.promise.nextReminderAt ? A("fu.nextReminder", { date: formatBakuDateTime(item.promise.nextReminderAt, { locale }) }) : null}
        </p>
      </div>
    );
  }
  if (item.kind === "CALLBACK") {
    return (
      <p>
        {item.origin ? A(item.origin === "CUSTOMER_REQUESTED" ? "fu.customerRequested" : "fu.agentProposed") : A("fu.kind.CALLBACK")}
        {item.note ? <span className="text-muted"> · {item.note}</span> : null}
      </p>
    );
  }
  if (item.kind === "TASK") {
    return (
      <p>
        {A(`tt.${item.taskType}`)}
        {item.note ? <span className="text-muted"> · {A(`fu.r.${item.note}`) === `fu.r.${item.note}` ? item.note : A(`fu.r.${item.note}`)}</span> : null}
      </p>
    );
  }
  return <p>{A("fu.lastAttempt", { when: formatBakuDateTime(item.dueAt, { locale }), result: item.technicalResult ? ot(locale, `tr.${item.technicalResult}`) : "—" })}</p>;
}

export function FollowUpRow({ item, locale }: { item: FollowUpItem; locale: Locale }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  return (
    <li className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)]" data-testid="follow-up-row" data-kind={item.kind} data-due={item.due}>
      <div>
        {item.due !== "NONE" && <Badge tone={DUE_TONE[item.due]}>{A(`fu.due.${item.due}`)}</Badge>}
        <p className="mt-0.5 text-[13px] text-muted">{item.kind === "PROMISE" ? formatDate(item.dueDate, locale) : item.kind === "FAILED" ? A("fu.kind.FAILED") : formatBakuDateTime(item.dueAt, { locale })}</p>
      </div>
      <div className="min-w-0">
        <Link href={`/customers/${item.customerId}`} className="font-medium">{item.customerName}</Link>
        <p className="text-[13px] text-muted">{A(`fu.kind.${item.kind}`)}</p>
      </div>
      <div className="min-w-0">
        <Details item={item} locale={locale} />
      </div>
      <div className="min-w-0">
        <NextStep item={item} locale={locale} />
      </div>
    </li>
  );
}

export function FollowUpHead({ locale }: { locale: Locale }) {
  const A = (k: string) => at(locale, k);
  return (
    <li className="hidden gap-4 px-4 py-2 text-[13px] font-medium text-muted md:grid md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)]" aria-hidden="true">
      <span>{A("col.due")}</span>
      <span>{A("col.customer")}</span>
      <span>{A("col.type")}</span>
      <span>{A("fu.next")}</span>
    </li>
  );
}

/** Two-line follow-up for the dashboard: who and when, then the next step or the blocker. */
export function CompactFollowUp({ item, locale }: { item: FollowUpItem; locale: Locale }) {
  const A = (k: string) => at(locale, k);
  return (
    <li className="space-y-1 px-4 py-3 text-sm" data-testid="dash-follow-up" data-kind={item.kind} data-due={item.due}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/customers/${item.customerId}`} className="font-medium">{item.customerName}</Link>
        {item.due !== "NONE" && <Badge tone={DUE_TONE[item.due]}>{A(`fu.due.${item.due}`)}</Badge>}
        <span className="ml-auto text-[13px] text-muted tabular-nums">{item.kind === "PROMISE" ? formatDate(item.dueDate, locale) : formatBakuDateTime(item.dueAt, { locale })}</span>
      </div>
      {item.kind === "PROMISE" ? <Details item={item} locale={locale} /> : <NextStep item={item} locale={locale} />}
    </li>
  );
}
