import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { formatDate, formatBakuDateTime } from "@/server/dates";
import { formatAzn } from "@/server/money";
import { remindersForPromises } from "@/server/modules/promises/reminderService";

export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { ACTIVE: "info", KEPT: "success", PARTIALLY_PAID: "warning", PENDING_RECONCILIATION: "warning", BROKEN: "danger", CANCELLED: "neutral" };
const REMINDER_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = { DELIVERED: "success", SENT: "info", SCHEDULED: "neutral", FAILED: "danger", SKIPPED: "warning", CANCELLED: "neutral" };

/** My promises (S07 agent view): own commitments with verified cash, remaining amount and reminder delivery status. */
export default async function AgentPromisesPage() {
  const { user } = await loadAgentPage();
  const promises = await prisma.promise.findMany({ where: { OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }] }, include: { customer: true }, orderBy: { deadline: "asc" }, take: 100 });
  const reminders = await remindersForPromises(prisma, promises.map((p) => p.id));
  return (
    <>
      <PageHeader kicker="S07 / my promises" title="My promises" lead="Commitments you obtained, tracked separately from actual received cash. Remaining amounts update only from verified postings; reminder status comes from the SMS gateway receipt." />
      <Card padded={false}>
        {promises.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No promises yet" />
          </div>
        ) : (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Promised</th>
                <th>Deadline</th>
                <th className="num">Paid / linked</th>
                <th className="num">Remaining</th>
                <th>State</th>
                <th>Reminder</th>
                <th>Suppression until</th>
              </tr>
            </thead>
            <tbody>
              {promises.map((p) => {
                const jobs = reminders.get(p.id) ?? [];
                const next = jobs.find((j) => j.status === "SCHEDULED");
                const last = [...jobs].reverse().find((j) => j.status !== "SCHEDULED");
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/customers/${p.customerId}`}>{p.customer.displayName}</Link>
                    </td>
                    <td className="num">{formatAzn(p.amount, { withCurrency: false })}</td>
                    <td>{formatDate(p.deadlineDate)}</td>
                    <td className="num">{formatAzn(p.paidAmount, { withCurrency: false })}</td>
                    <td className="num">{formatAzn(p.remainingAmount, { withCurrency: false })}</td>
                    <td>
                      <Badge tone={TONE[p.status] ?? "neutral"}>{p.status.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="text-xs">
                      {jobs.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {last && (
                            <span>
                              <Badge tone={REMINDER_TONE[last.status] ?? "neutral"}>{last.status.toLowerCase()}</Badge> {last.sentAt ? formatBakuDateTime(last.sentAt) : formatBakuDateTime(last.scheduledFor)}
                              {last.reason ? <span className="text-muted"> · {last.reason}</span> : null}
                            </span>
                          )}
                          {next && <span className="text-muted">next {formatBakuDateTime(next.scheduledFor)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-muted">{p.suppressionUntil ? formatBakuDateTime(p.suppressionUntil) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
