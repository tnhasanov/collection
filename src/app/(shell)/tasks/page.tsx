import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { BAKU_ZONE, formatBakuDateTime, formatBakuTime } from "@/server/dates";
import { Badge, Card } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { TaskActions, CreateCallbackButton } from "@/components/tasks/TaskActions";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
const TASK_TYPES = ["CALLBACK", "PTP_FOLLOWUP", "DISPUTE_REVIEW", "RECONCILIATION", "SUPPORT_REVIEW", "MANUAL_REVIEW", "LATER_STAGE_REVIEW", "HANDOVER"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; owner?: string; type?: string; day?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "customer.read")) redirect("/access-denied");
  const { view = "list", owner = "all", type = "", day } = await searchParams;
  const t = await now();
  const base = DateTime.fromJSDate(t, { zone: BAKU_ZONE });
  const dayStart = (day ? DateTime.fromISO(day, { zone: BAKU_ZONE }) : base).startOf("day");
  const rangeEnd = view === "day" ? dayStart.endOf("day") : view === "week" ? dayStart.plus({ days: 7 }) : null;
  const where: Prisma.WorkItemWhereInput = { type: { in: type ? [type as (typeof TASK_TYPES)[number]] : [...TASK_TYPES] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } };
  if (owner === "me") where.ownerUserId = user.id;
  if (!hasPermission(user.role, "customer.read.unscoped")) where.OR = [{ ownerUserId: user.id }, { claimedByUserId: user.id }];
  if (rangeEnd) where.dueAt = { gte: view === "day" ? dayStart.toJSDate() : dayStart.toJSDate(), lte: rangeEnd.toJSDate() };
  const items = await prisma.workItem.findMany({ where, include: { customer: true, owner: { select: { displayName: true, id: true } } }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 300 });
  const agents = await prisma.user.findMany({ where: { isActive: true, role: { in: ["AGENT", "SENIOR_AGENT", "TEAM_LEAD"] } }, select: { id: true, displayName: true } });
  const byDay = new Map<string, typeof items>();
  for (const i of items) {
    const k = i.dueAt ? DateTime.fromJSDate(i.dueAt, { zone: BAKU_ZONE }).toISODate()! : "undated";
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  const link = (p: Record<string, string>) => `/tasks?${new URLSearchParams({ view, owner, type, ...(day ? { day } : {}), ...p }).toString()}`;
  return (
    <>
      <PageHeader kicker="S08 / callback and task calendar" title="Callbacks & tasks" lead="Callbacks, PTP follow-ups, dispute reviews, reconciliation requests, manual reviews and late-stage handovers. Customer restrictions supersede any rescheduling." actions={hasPermission(user.role, "callback.write") ? <CreateCallbackButton /> : null} />
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {[["list", "List"], ["day", "Day"], ["week", "Week"]].map(([k, l]) => (
          <Link key={k} href={link({ view: k })} className="tab" aria-current={view === k ? "page" : undefined} style={view === k ? { background: "var(--color-brand-light)", color: "var(--color-brand-dark)" } : undefined}>
            {l}
          </Link>
        ))}
        <span className="mx-2 text-muted">|</span>
        <Link href={link({ owner: owner === "me" ? "all" : "me" })} className="tab">
          Owner: {owner === "me" ? "me" : "all"}
        </Link>
        <select className="select w-auto" defaultValue={type} onChange={undefined} aria-label="Task type" form="task-filter-form">
          <option value="">All types</option>
          {TASK_TYPES.map((x) => (
            <option key={x} value={x}>
              {x.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        {TASK_TYPES.map((x) => (
          <Link key={x} href={link({ type: type === x ? "" : x })} className="badge badge-neutral" aria-current={type === x ? "true" : undefined} style={type === x ? { background: "var(--color-brand-light)" } : undefined}>
            {x.replace(/_/g, " ").toLowerCase()}
          </Link>
        ))}
        {view !== "list" && (
          <span className="ml-auto flex gap-1">
            <Link className="btn btn-secondary btn-sm" href={link({ day: dayStart.minus({ days: view === "day" ? 1 : 7 }).toISODate()! })}>
              ←
            </Link>
            <span className="px-2 py-1 text-xs">{view === "day" ? dayStart.toFormat("dd MMM yyyy") : `${dayStart.toFormat("dd MMM")} – ${dayStart.plus({ days: 6 }).toFormat("dd MMM yyyy")}`}</span>
            <Link className="btn btn-secondary btn-sm" href={link({ day: dayStart.plus({ days: view === "day" ? 1 : 7 }).toISODate()! })}>
              →
            </Link>
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {[...byDay.entries()].map(([k, list]) => (
          <Card key={k} title={k === "undated" ? "Undated" : DateTime.fromISO(k).toFormat("cccc, dd MMM yyyy")} padded={false}>
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Reason</th>
                  <th>Owner</th>
                  <th>State</th>
                  <th>Blocked by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td>{i.dueAt ? formatBakuTime(i.dueAt) : "—"}</td>
                    <td>{i.type.replace(/_/g, " ").toLowerCase()}</td>
                    <td>
                      <Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link>
                    </td>
                    <td className="text-xs text-muted">{i.reason}</td>
                    <td>{i.owner?.displayName ?? "Pool"}</td>
                    <td>
                      <Badge tone={i.status === "ELIGIBLE" ? "success" : i.status === "DEFERRED" ? "warning" : "info"}>{i.status.toLowerCase()}</Badge>
                    </td>
                    <td className="text-xs text-muted">{i.deferredReasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}{i.nextEligibleAt && i.status === "DEFERRED" ? ` · until ${formatBakuDateTime(i.nextEligibleAt)}` : ""}</td>
                    <td>
                      <TaskActions id={i.id} canReassign={hasPermission(user.role, "queue.reassign")} agents={agents} ownerId={i.owner?.id ?? null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
        {items.length === 0 && <Card><p className="text-sm text-muted">No tasks in this view.</p></Card>}
      </div>
    </>
  );
}
