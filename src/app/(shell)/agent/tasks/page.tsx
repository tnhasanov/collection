import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { formatBakuDateTime } from "@/server/dates";

export const dynamic = "force-dynamic";

export default async function AgentTasksPage() {
  const { user } = await loadAgentPage();
  const items = await prisma.workItem.findMany({ where: { type: { in: ["PTP_FOLLOWUP", "RECONCILIATION", "DISPUTE_REVIEW", "SUPPORT_REVIEW", "HANDOVER"] }, OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, include: { customer: true }, orderBy: { dueAt: "asc" } });
  return (
    <>
      <PageHeader kicker="S22 / support tasks" title="Support tasks" lead="Disputes, support referrals, reconciliation requests and promise follow-ups assigned to you." />
      <Card padded={false}>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No open tasks" />
          </div>
        ) : (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Type</th>
                <th>Customer</th>
                <th>Due</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.type.replace(/_/g, " ")}</td>
                  <td>
                    <Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link>
                  </td>
                  <td>{formatBakuDateTime(i.dueAt)}</td>
                  <td className="text-muted">{i.reason}</td>
                  <td>
                    <Badge tone="info">{i.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
