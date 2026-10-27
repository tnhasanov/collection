import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { formatBakuDateTime } from "@/server/dates";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";

export const dynamic = "force-dynamic";

export default async function AgentCallbacksPage() {
  const { user } = await loadAgentPage();
  const items = await prisma.workItem.findMany({ where: { type: "CALLBACK", OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }] }, include: { customer: true }, orderBy: { dueAt: "asc" }, take: 100 });
  return (
    <>
      <PageHeader kicker="S08 / my callbacks" title="My callbacks" lead="Callbacks you own. Due time and policy eligibility control allocation; a callback never bypasses a contact restriction." />
      <Card padded={false}>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No callbacks" />
          </div>
        ) : (
          <table className="table-dense">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Due (Baku)</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Why blocked</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/customers/${i.customerId}`}>{i.customer.displayName}</Link>
                  </td>
                  <td>{formatBakuDateTime(i.dueAt)}</td>
                  <td className="text-muted">{i.reason}</td>
                  <td>
                    <Badge tone={i.status === "ELIGIBLE" ? "success" : i.status === "COMPLETED" ? "neutral" : "warning"}>{i.status}</Badge>
                  </td>
                  <td className="text-xs text-muted">{i.deferredReasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
