import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { APPROVAL_TYPE_LABELS } from "@/server/modules/approvals/approvalService";
import { ApprovalActions } from "@/components/approvals/ApprovalActions";
import type { ApprovalType } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { PENDING: "warning", INFO_REQUESTED: "info", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ id?: string; status?: string; type?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  const canDecide = hasPermission(user.role, "approval.decide");
  const canRequest = hasPermission(user.role, "approval.request");
  if (!canDecide && !canRequest) redirect("/access-denied");
  const sp = await searchParams;
  const status = sp.status ?? "OPEN";
  const where = { ...(status === "OPEN" ? { status: { in: ["PENDING", "INFO_REQUESTED"] as ("PENDING" | "INFO_REQUESTED")[] } } : status === "ALL" ? {} : { status: status as "APPROVED" }), ...(sp.type ? { type: sp.type as ApprovalType } : {}) };
  const requests = await prisma.approvalRequest.findMany({ where, orderBy: [{ createdAt: "desc" }], include: { maker: { select: { displayName: true, id: true } }, checker: { select: { displayName: true } } }, take: 100 });
  const selected = sp.id ? await prisma.approvalRequest.findUnique({ where: { id: sp.id }, include: { maker: { select: { displayName: true, id: true } }, checker: { select: { displayName: true } } } }) : requests[0] ?? null;
  const counts = await prisma.approvalRequest.groupBy({ by: ["status"], _count: { _all: true } });
  const impact = selected?.impactJson as Record<string, unknown> | null;
  return (
    <>
      <PageHeader kicker="S11 / approvals inbox" title="Approvals" lead="Maker/checker governance for model, strategy, policy, template, campaign, arrangement, handover and rollback changes. The checker is always a different user; approving applies the effect with a rollback target." />
      <Callout tone="info">Status counts: {counts.map((c) => `${c.status.toLowerCase().replace("_", " ")} ${c._count._all}`).join(" · ") || "none"}. Decisions are audited with before/after, impact, validation and evidence.</Callout>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {["OPEN", "APPROVED", "REJECTED", "CANCELLED", "ALL"].map((s) => <a key={s} className={`tab ${status === s ? "tab-active" : ""}`} aria-current={status === s ? "page" : undefined} href={`/approvals?status=${s}${sp.type ? `&type=${sp.type}` : ""}`}>{s.toLowerCase()}</a>)}
        <span className="ml-auto text-xs text-muted">Type: <a href={`/approvals?status=${status}`}>all</a> {Object.entries(APPROVAL_TYPE_LABELS).map(([k, v]) => <a key={k} className={`ml-2 ${sp.type === k ? "font-bold" : ""}`} href={`/approvals?status=${status}&type=${k}`}>{v}</a>)}</span>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_520px]">
        <Card title="Requests" padded={false}>
          <table className="table-dense">
            <thead><tr><th>Request</th><th>Type</th><th>Object</th><th>Maker</th><th>Status</th><th>Created</th><th>Checker</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className={selected?.id === r.id ? "bg-brand-light" : ""}>
                  <td><a href={`/approvals?status=${status}&id=${r.id}`}>{r.title}</a><div className="text-xs text-muted">{r.id}</div></td>
                  <td className="text-xs">{APPROVAL_TYPE_LABELS[r.type]}</td><td className="text-xs">{r.objectType} · {r.objectId}</td><td className="text-xs">{r.maker.displayName}</td>
                  <td><Badge tone={TONE[r.status] ?? "neutral"}>{r.status.toLowerCase().replace("_", " ")}</Badge></td><td className="text-xs">{fmtDateTime(r.createdAt)}</td><td className="text-xs">{r.checker?.displayName ?? "—"}</td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={7} className="p-3 text-muted">No requests in this view.</td></tr>}
            </tbody>
          </table>
        </Card>
        {selected ? (
          <Card title={selected.title} subtitle={`${APPROVAL_TYPE_LABELS[selected.type]} · ${selected.objectType} ${selected.objectId}`} actions={<Badge tone={TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase().replace("_", " ")}</Badge>}>
            <Dl items={[
              { label: "Maker", value: `${selected.maker.displayName} · ${fmtDateTime(selected.createdAt)}` },
              { label: "Rationale", value: selected.rationale },
              { label: "Checker", value: selected.checker ? `${selected.checker.displayName}${selected.decidedAt ? ` · ${fmtDateTime(selected.decidedAt)}` : ""}` : "—" },
              { label: "Decision note", value: selected.decisionNote ?? "—" },
              { label: "Proposed effective", value: selected.proposedEffectiveAt ? fmtDateTime(selected.proposedEffectiveAt) : "On approval" },
              { label: "Rollback target", value: selected.rollbackTargetId ?? "—" },
            ]} />
            {impact && (
              <div className="mt-2 text-sm">
                <p className="font-medium">Impact statement</p>
                {typeof impact.population === "number" ? <p className="text-xs">Dry simulation: {String(impact.population)} customers, {String((impact.workload as { callItems?: number } | undefined)?.callItems ?? "?")} call items, {String((impact.changedCustomers as unknown[] | undefined)?.length ?? 0)} changed treatments, {String((impact.blockedContacts as { total?: number } | undefined)?.total ?? "?")} blocked contacts, channel cost {String((impact.channelCosts as { total?: string } | undefined)?.total ?? "?")} AZN.</p> : <pre className="max-h-32 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(impact, null, 1)}</pre>}
              </div>
            )}
            <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Before / after</summary><div className="grid gap-2 md:grid-cols-2"><pre className="max-h-64 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.beforeJson, null, 1)}</pre><pre className="max-h-64 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.afterJson, null, 1)}</pre></div></details>
            {selected.validationJson ? <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Validation</summary><pre className="max-h-40 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.validationJson, null, 1)}</pre></details> : null}
            {selected.evidenceJson ? <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Evidence / applied effect</summary><pre className="max-h-40 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.evidenceJson, null, 1)}</pre></details> : null}
            <div className="mt-3">
              <ApprovalActions id={selected.id} status={selected.status} isMaker={selected.maker.id === user.id} canDecide={selected.type === "PTP_EXCEPTION" ? hasPermission(user.role, "ptp-exception.decide") : canDecide} />
            </div>
          </Card>
        ) : <Card><p className="text-sm text-muted">Select a request.</p></Card>}
      </div>
    </>
  );
}
