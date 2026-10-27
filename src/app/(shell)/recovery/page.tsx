import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtAzn, fmtDateTime } from "@/lib/format";
import { HandoverActions, HandoverCreate } from "@/components/recovery/HandoverActions";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { DRAFT: "neutral", REVIEW_REQUESTED: "info", APPROVED: "brand", EXPORTED: "success", ACCEPTED: "success", RETURNED: "warning" };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "recovery.manage")) redirect("/access-denied");
  const sp = await searchParams;
  const laterStage = await prisma.collectionCase.findMany({ where: { status: { in: ["OPEN", "HANDOVER"] }, maxDpd: { gte: 31 } }, include: { customer: { select: { displayName: true, branch: true } }, handovers: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ maxDpd: "desc" }] });
  const handovers = await prisma.handoverPacket.findMany({ orderBy: { createdAt: "desc" }, include: { case: { include: { customer: { select: { displayName: true } } } } } });
  const selected = handovers.find((h) => h.id === sp.id) ?? handovers[0] ?? null;
  const packet = selected?.packet as Record<string, unknown> | null;
  const approval = selected?.approvalId ? await prisma.approvalRequest.findUnique({ where: { id: selected.approvalId }, select: { id: true, status: true } }) : null;
  return (
    <>
      <PageHeader kicker="S26 / recovery handover" title="Later-stage review & handover" lead="Cases beyond 30 DPD leave the early-arrears model scope. A frozen packet (customer, loans, balances, contact history, promises, support flags, decision context) is reviewed, approved on S11, exported to the receiving team and acknowledged or returned with a reason." />
      <Callout tone="info">Export cancels routine early-arrears work for the case and sets it to HANDOVER; a return re-opens it. Restricted support details never travel in the packet.</Callout>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="space-y-3">
          <Card title="Later-stage cases (31+ DPD)" padded={false}>
            <table className="table-dense"><thead><tr><th>Customer</th><th>Branch</th><th className="text-right">Max DPD</th><th className="text-right">Overdue</th><th className="text-right">Exposure</th><th>Case</th><th>Handover</th><th></th></tr></thead>
              <tbody>{laterStage.map((c) => <tr key={c.id}><td><a href={`/customers/${c.customerId}`}>{c.customer.displayName}</a></td><td className="text-xs">{c.customer.branch}</td><td className="text-right">{c.maxDpd}</td><td className="text-right">{fmtAzn(c.totalOverdue.toString(), false)}</td><td className="text-right">{fmtAzn(c.modelExposure.toString(), false)}</td><td><Badge tone={c.status === "HANDOVER" ? "warning" : "neutral"}>{c.status.toLowerCase()}</Badge></td><td className="text-xs">{c.handovers[0] ? <a href={`/recovery?id=${c.handovers[0].id}`}>{c.handovers[0].status.toLowerCase().replace("_", " ")}</a> : "—"}</td><td>{!c.handovers[0] || ["RETURNED"].includes(c.handovers[0].status) ? <HandoverCreate caseId={c.id} /> : null}</td></tr>)}{laterStage.length === 0 && <tr><td colSpan={8} className="p-3 text-muted">No later-stage cases.</td></tr>}</tbody></table>
          </Card>
          <Card title="Handover packets" padded={false}>
            <table className="table-dense"><thead><tr><th>Packet</th><th>Customer</th><th>Receiving team</th><th>Status</th><th>Deadline</th><th>Created</th><th>Acknowledged</th></tr></thead>
              <tbody>{handovers.map((h) => <tr key={h.id} className={selected?.id === h.id ? "bg-brand-light" : ""}><td><a href={`/recovery?id=${h.id}`}>{h.id.slice(-8)}</a></td><td>{h.case.customer.displayName}</td><td className="text-xs">{h.receivingTeam}</td><td><Badge tone={TONE[h.status] ?? "neutral"}>{h.status.toLowerCase().replace("_", " ")}</Badge></td><td className="text-xs">{h.deadline ? fmtDateTime(h.deadline) : "—"}</td><td className="text-xs">{fmtDateTime(h.createdAt)}</td><td className="text-xs">{h.acknowledgedBy ? `${h.acknowledgedBy} · ${fmtDateTime(h.acknowledgedAt)}` : h.returnReason ? `returned: ${h.returnReason}` : "—"}</td></tr>)}{handovers.length === 0 && <tr><td colSpan={7} className="p-3 text-muted">No handover packets yet.</td></tr>}</tbody></table>
          </Card>
        </div>
        {selected && packet ? (
          <Card title={`Packet ${selected.id.slice(-8)} · ${selected.case.customer.displayName}`} subtitle={`${selected.receivingTeam} · generated ${fmtDateTime(String(packet.generatedAt))}`} actions={<Badge tone={TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase().replace("_", " ")}</Badge>}>
            <Dl items={[
              { label: "Approval", value: approval ? `${approval.id} · ${approval.status.toLowerCase().replace("_", " ")}` : "—" },
              { label: "Case", value: `${String((packet.case as Record<string, unknown>).status)} · max DPD ${String((packet.case as Record<string, unknown>).maxDpd)} · overdue ${fmtAzn(String((packet.case as Record<string, unknown>).totalOverdue))}` },
              { label: "Loans", value: `${(packet.loans as unknown[]).length}` },
              { label: "Contact history", value: `${String((packet.contactHistory as Record<string, unknown>).attempts)} attempts · ${String((packet.contactHistory as Record<string, unknown>).rpc)} RPC · last RPC ${(packet.contactHistory as Record<string, unknown>).lastRpcAt ? fmtDateTime(String((packet.contactHistory as Record<string, unknown>).lastRpcAt)) : "—"}` },
              { label: "Promises / support flags / open exceptions", value: `${(packet.promises as unknown[]).length} / ${(packet.supportFlags as unknown[]).length} / ${(packet.openExceptions as unknown[]).length}` },
            ]} />
            <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Packet contents</summary><pre className="max-h-80 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(packet, null, 1)}</pre></details>
            <div className="mt-3"><HandoverActions id={selected.id} status={selected.status} /></div>
          </Card>
        ) : <Card><p className="text-sm text-muted">No packet selected.</p></Card>}
      </div>
    </>
  );
}
