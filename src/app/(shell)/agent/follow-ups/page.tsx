import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { formatBakuDateTime, formatDate } from "@/server/dates";
import { formatAzn } from "@/server/money";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { remindersForPromises } from "@/server/modules/promises/reminderService";
import { t } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { ACTIVE: "info", KEPT: "success", PARTIALLY_PAID: "warning", PENDING_RECONCILIATION: "warning", BROKEN: "danger", CANCELLED: "neutral", ELIGIBLE: "success", DEFERRED: "warning", QUEUED: "info", CLAIMED: "info", IN_PROGRESS: "info", COMPLETED: "neutral" };
const REMINDER_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { DELIVERED: "success", SENT: "info", SCHEDULED: "neutral", FAILED: "danger", SKIPPED: "warning", CANCELLED: "neutral" };

/**
 * Compact follow-up view for agents: callbacks I own, my promises with reminder status, my support tasks, and the
 * failed contacts of my day that the policy retries centrally (never from this page). One screen, one scope.
 */
export default async function AgentFollowUpsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, now, locale } = await loadAgentPage();
  const { tab = "callbacks" } = await searchParams;
  const tt = (k: string) => t(locale, k);
  const dayStart = new Date(now.getTime() - 24 * 3600_000);
  const [callbacks, promises, tasks, failed] = await Promise.all([
    prisma.workItem.findMany({ where: { type: "CALLBACK", OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, include: { customer: true }, orderBy: { dueAt: "asc" }, take: 100 }),
    prisma.promise.findMany({ where: { OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }], status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION", "BROKEN"] } }, include: { customer: true }, orderBy: { deadline: "asc" }, take: 100 }),
    prisma.workItem.findMany({ where: { type: { in: ["PTP_FOLLOWUP", "RECONCILIATION", "DISPUTE_REVIEW", "SUPPORT_REVIEW", "HANDOVER"] }, OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, include: { customer: true }, orderBy: { dueAt: "asc" }, take: 100 }),
    prisma.interaction.findMany({ where: { agentUserId: user.id, startedAt: { gte: dayStart }, technicalResult: { in: ["NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE"] } }, include: { customer: { select: { displayName: true } }, workItem: { select: { status: true, nextEligibleAt: true, deferredReasons: true } } }, orderBy: { startedAt: "desc" }, take: 100 }),
  ]);
  const reminders = await remindersForPromises(prisma, promises.map((p) => p.id));
  const tabs = [["callbacks", tt("agent.home.callbacks"), callbacks.length], ["promises", tt("nav.promises"), promises.length], ["tasks", tt("agent.home.tasks"), tasks.length], ["failed", "Failed contacts (24h)", failed.length]] as const;
  return (
    <>
      <PageHeader kicker="S07 / S08 / S22" title={tt("nav.agentFollowUps")} lead="Callbacks, promises with reminder status and support tasks in one place. Failed contacts are retried centrally by the contact policy; nothing here redials." />
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, l, n]) => (
          <Link key={k} role="tab" aria-selected={tab === k} href={`/agent/follow-ups?tab=${k}`} className="tab" style={tab === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>
            {l} <span className="text-xs text-muted">({n})</span>
          </Link>
        ))}
      </div>
      <Card padded={false}>
        {tab === "callbacks" && (callbacks.length === 0 ? <div className="p-4"><EmptyState title={tt("common.empty")} /></div> : (
          <table className="table-dense">
            <thead><tr><th>{tt("common.customer")}</th><th>Due (Baku)</th><th>{tt("common.reason")}</th><th>{tt("common.status")}</th><th>Why blocked</th></tr></thead>
            <tbody>
              {callbacks.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link></td>
                  <td>{formatBakuDateTime(i.dueAt)}</td>
                  <td className="text-muted">{i.reason}</td>
                  <td><Badge tone={TONE[i.status] ?? "neutral"}>{i.status.toLowerCase()}</Badge></td>
                  <td className="text-xs text-muted">{i.deferredReasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}{i.nextEligibleAt && i.status === "DEFERRED" ? ` · until ${formatBakuDateTime(i.nextEligibleAt)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {tab === "promises" && (promises.length === 0 ? <div className="p-4"><EmptyState title={tt("common.empty")} /></div> : (
          <table className="table-dense">
            <thead><tr><th>{tt("common.customer")}</th><th className="num">Promised</th><th>Deadline</th><th className="num">Paid</th><th className="num">Remaining</th><th>{tt("common.status")}</th><th>Reminder</th></tr></thead>
            <tbody>
              {promises.map((p) => {
                const jobs = reminders.get(p.id) ?? [];
                const next = jobs.find((j) => j.status === "SCHEDULED");
                const last = [...jobs].reverse().find((j) => j.status !== "SCHEDULED");
                return (
                  <tr key={p.id}>
                    <td><Link href={`/customers/${p.customerId}`}>{p.customer.displayName}</Link></td>
                    <td className="num">{formatAzn(p.amount, { withCurrency: false })}</td>
                    <td>{formatDate(p.deadlineDate)}</td>
                    <td className="num">{formatAzn(p.paidAmount, { withCurrency: false })}</td>
                    <td className="num">{formatAzn(p.remainingAmount, { withCurrency: false })}</td>
                    <td><Badge tone={TONE[p.status] ?? "neutral"}>{p.status.replace(/_/g, " ").toLowerCase()}</Badge></td>
                    <td className="text-xs">
                      {jobs.length === 0 ? <span className="text-muted">—</span> : (
                        <div className="flex flex-col gap-0.5">
                          {last && <span><Badge tone={REMINDER_TONE[last.status] ?? "neutral"}>{last.status.toLowerCase()}</Badge> {formatBakuDateTime(last.sentAt ?? last.scheduledFor)}{last.reason ? <span className="text-muted"> · {last.reason}</span> : null}</span>}
                          {next && <span className="text-muted">next {formatBakuDateTime(next.scheduledFor)}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
        {tab === "tasks" && (tasks.length === 0 ? <div className="p-4"><EmptyState title={tt("common.empty")} /></div> : (
          <table className="table-dense">
            <thead><tr><th>Type</th><th>{tt("common.customer")}</th><th>Due</th><th>{tt("common.reason")}</th><th>{tt("common.status")}</th></tr></thead>
            <tbody>
              {tasks.map((i) => (
                <tr key={i.id}>
                  <td>{i.type.replace(/_/g, " ").toLowerCase()}</td>
                  <td><Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link></td>
                  <td>{formatBakuDateTime(i.dueAt)}</td>
                  <td className="text-muted">{i.reason}</td>
                  <td><Badge tone={TONE[i.status] ?? "info"}>{i.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {tab === "failed" && (failed.length === 0 ? <div className="p-4"><EmptyState title={tt("common.empty")} /></div> : (
          <table className="table-dense">
            <thead><tr><th>When</th><th>{tt("common.customer")}</th><th>Provider result</th><th>Central retry</th></tr></thead>
            <tbody>
              {failed.map((i) => (
                <tr key={i.id}>
                  <td>{formatBakuDateTime(i.startedAt)}</td>
                  <td><Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link></td>
                  <td><Badge tone="neutral">{(i.technicalResult ?? "").toLowerCase().replace(/_/g, " ")}</Badge></td>
                  <td className="text-xs text-muted">{i.workItem ? `${i.workItem.status.toLowerCase()}${i.workItem.nextEligibleAt ? ` · next eligible ${formatBakuDateTime(i.workItem.nextEligibleAt)}` : ""}${i.workItem.deferredReasons.length ? ` · ${i.workItem.deferredReasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}` : ""}` : "Retry decided by the contact policy (timing, attempt caps, permitted hours)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Card>
    </>
  );
}
