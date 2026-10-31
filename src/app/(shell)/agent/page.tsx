import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { formatAzn } from "@/server/money";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { agentFollowUps } from "@/server/modules/agent/followUpService";
import { agentDashboard } from "@/server/modules/agent/dashboardService";
import { at } from "@/i18n/agentText";
import { t } from "@/i18n/dictionaries";
import { modeOf } from "@/components/agent/mode";
import { DashboardShift } from "@/components/agent/DashboardShift";
import { loadAgentPage } from "./loader";

export const dynamic = "force-dynamic";

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baku" });
const LONG_DATE: Record<string, Intl.DateTimeFormat> = {
  az: new Intl.DateTimeFormat("az-AZ", { day: "numeric", month: "long", weekday: "long", timeZone: "Asia/Baku" }),
  ru: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "Asia/Baku" }),
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", weekday: "long", timeZone: "Asia/Baku" }),
};

function Card({ title, action, children, testId }: { title: string; action?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="panel" data-testid={testId} aria-label={title}>
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The agent's personal dashboard: today's results, due work (with the restriction that applies now on hover), the
 * queue context, what needs attention and the last saved outcomes. Calls happen in /agent/call; "Go Ready" leads there.
 */
export default async function AgentDashboardPage() {
  const { user, initial, locale, now } = await loadAgentPage();
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const money = (v: string | null | undefined) => (v === null || v === undefined ? "—" : formatAzn(v, { locale }));
  const items = await agentFollowUps(prisma, user.id, now);
  const d = await agentDashboard(prisma, user, items);
  const m = initial.metrics!;
  const mode = modeOf(initial);
  const inCall = mode === "live" || mode === "dialing" || mode === "recovery" || mode === "acw" || mode === "wrapup";
  const state = initial.session?.confirmedState ?? "OFFLINE";
  const workLabel = (w: (typeof d.due)[number]) => A(w.kind === "TASK" ? `dw.${w.taskType}` : `dw.${w.kind}`);
  const when = (w: (typeof d.due)[number]) => {
    if (w.kind === "PROMISE") return w.due === "TODAY" ? A("dash.today") : formatDate(w.date, locale);
    if (!w.at) return "—";
    // Today: the time; earlier: the date (the full date and time is in the tooltip).
    return w.due === "TODAY" ? TIME.format(new Date(w.at)) : formatDate(new Date(w.at), locale);
  };
  const kpis = [
    { key: "attempts", label: A("dash.k.attempts"), value: String(m.attempts) },
    { key: "rpc", label: A("dash.k.rpc"), value: String(m.rpc) },
    { key: "promises", label: A("dash.k.promises"), value: String(m.promises) },
    { key: "cash", label: A("dash.k.cash"), value: money(m.attributedCash).replace(/,00 AZN$|\.00 AZN$/, " AZN") },
  ];

  return (
    <>
      <PageHeader title={A("dash.title")} meta={LONG_DATE[locale]?.format(now) ?? LONG_DATE.en.format(now)} actions={<DashboardShift locale={locale} state={state} hasSession={!!initial.session?.id} inCall={inCall} />} />

      {m.unresolvedWrapUps > 0 && !inCall && <p className="callout callout-warning mb-4 text-sm">{A("dash.unresolved", { n: m.unresolvedWrapUps })}</p>}

      <section aria-label={A("dash.workload")} className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="dash-workload">
        {kpis.map((k) => (
          <div key={k.key} className="panel px-6 py-5" data-testid={`dash-kpi-${k.key}`}>
            <p className="text-sm text-muted">{k.label}</p>
            <p className="mt-2 text-[30px] leading-9 font-medium text-ink tabular-nums">{k.value}</p>
          </div>
        ))}
      </section>

      <div className="mb-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={A("dash.dueWork")} testId="dash-due" action={<Link href="/agent/follow-ups" className="text-sm">{A("dash.seeAll")}</Link>}>
          {d.due.length === 0 ? (
            <p className="px-6 pb-5 text-sm text-muted">{A("dash.none")}</p>
          ) : (
            <table className="rows-table">
              <colgroup>
                <col />
                <col className="hidden w-[34%] sm:table-column" />
                <col className="w-[96px] sm:w-[110px]" />
                <col className="w-[112px] sm:w-[130px]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="!pl-6">{A("col.customer")}</th>
                  <th scope="col" className="hidden sm:table-cell">{A("dash.col.work")}</th>
                  <th scope="col">{A("dash.col.time")}</th>
                  <th scope="col" className="num !pr-6">{A("dash.col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {d.due.map((w) => (
                  <tr key={w.key} data-testid="dash-due-row" data-kind={w.kind}>
                    <td className="!pl-6" title={w.customerName}><Link href={`/customers/${w.customerId}`} className="text-ink hover:text-brand">{w.customerName}</Link></td>
                    <td className="secondary hidden sm:table-cell" title={w.eligible === false ? w.blockers.map((b) => A(`pol.${b}`)).join(", ") : workLabel(w)}>
                      {workLabel(w)}
                      {w.eligible === false && <span className="status-chip chip-warning ml-2">{A("dash.waiting")}</span>}
                    </td>
                    <td className={w.due === "OVERDUE" ? "text-danger" : ""} title={w.at ? formatBakuDateTime(w.at, { locale }) : undefined}>{when(w)}</td>
                    <td className="num !pr-6">{money(w.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="h-2" />
        </Card>

        <div className="space-y-6">
          <Card title={A("dash.queue")} testId="dash-queue">
            <div className="px-6 pb-5">
              <div className="flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-sm text-muted">{A("dash.readyItems")}</span>
                <span className="text-[30px] leading-9 font-medium tabular-nums">{d.queue.ready}</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">{A("dash.language")}</dt><dd>{d.queue.languages.join(", ")}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{A("dash.skill")}</dt><dd>{A(d.queue.senior ? "dash.skill.SENIOR" : "dash.skill.REGULAR")}</dd></div>
              </dl>
            </div>
          </Card>
          <Card title={A("dash.attention")} testId="dash-attention">
            <div className="flex flex-col items-start gap-2 px-6 pb-5">
              {d.attention.broken > 0 && <Link href="/agent/follow-ups?tab=promises" className="status-chip chip-warning !h-auto py-1 text-[13px]">{A("dash.broken", { n: d.attention.broken })}</Link>}
              {d.attention.claims > 0 && <span className="status-chip chip-neutral !h-auto py-1 text-[13px]">{A("dash.claims", { n: d.attention.claims })}</span>}
              {d.attention.unresolved > 0 && <Link href="/agent/call" className="status-chip chip-warning !h-auto py-1 text-[13px]">{A("dash.unfinished", { n: d.attention.unresolved })}</Link>}
              {d.attention.broken + d.attention.claims + d.attention.unresolved === 0 && <span className="text-sm text-muted">{A("dash.allClear")}</span>}
            </div>
          </Card>
        </div>
      </div>

      <Card title={A("dash.recent")} testId="dash-results" action={<Link href="/agent/results" className="text-sm">{A("res.title")}</Link>}>
        {d.recent.length === 0 ? (
          <p className="px-6 pb-5 text-sm text-muted">{A("dash.none")}</p>
        ) : (
          <table className="rows-table">
            <colgroup>
              <col />
              <col className="hidden w-[28%] sm:table-column" />
              <col className="w-[112px] sm:w-[140px]" />
              <col className="hidden w-[140px] sm:table-column" />
              <col className="w-[64px] sm:w-[96px]" />
            </colgroup>
            <thead className="sr-only">
              <tr>
                <th scope="col">{A("col.customer")}</th>
                <th scope="col" className="hidden sm:table-cell">{A("col.result")}</th>
                <th scope="col">{A("dash.col.amount")}</th>
                <th scope="col" className="hidden sm:table-cell">{A("col.when")}</th>
                <th scope="col">{A("dash.col.time")}</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id} data-testid="dash-recent-row">
                  <td className="!pl-6" title={r.customerName}><Link href={`/customers/${r.customerId}`} className="text-ink hover:text-brand">{r.customerName}</Link></td>
                  <td className="secondary hidden sm:table-cell">{r.outcome ? t(locale, `agent.outcomes.${r.outcome}`) : "—"}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td className="num hidden sm:table-cell">{r.date ? formatDate(r.date.slice(0, 10), locale) : "—"}</td>
                  <td className="secondary num !pr-6">{r.at ? TIME.format(new Date(r.at)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="h-2" />
      </Card>
    </>
  );
}
