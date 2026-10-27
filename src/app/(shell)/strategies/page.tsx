import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { formatBakuDateTime } from "@/server/dates";
import { Callout } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StrategyDesigner } from "@/components/strategies/StrategyDesigner";
import { validateStrategyConfig } from "@/server/modules/strategy/strategyService";

export const dynamic = "force-dynamic";

export default async function StrategiesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "strategy.read")) redirect("/access-denied");
  const sp = await searchParams;
  const versions = await prisma.strategyVersion.findMany({ orderBy: [{ code: "asc" }, { createdAt: "desc" }] });
  const approvals = await prisma.approvalRequest.findMany({ where: { objectType: "StrategyVersion", status: { in: ["PENDING", "INFO_REQUESTED"] } }, select: { id: true, objectId: true, status: true } });
  const run = await prisma.decisionRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
  const t = await now();
  const items = versions.map((v) => ({
    id: v.id,
    code: v.code,
    version: v.version,
    status: v.status,
    config: v.configJson,
    createdBy: v.createdBy,
    approvedBy: v.approvedBy,
    activatedAt: v.activatedAt?.toISOString() ?? null,
    retiredAt: v.retiredAt?.toISOString() ?? null,
    notes: v.notes,
    simulation: v.simulationJson,
    simulatedAt: v.simulatedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    validation: validateStrategyConfig(v.configJson),
    openApproval: approvals.find((a) => a.objectId === v.id) ?? null,
  }));
  const selected = items.find((i) => i.id === sp.v) ?? items.find((i) => i.status === "ACTIVE") ?? items[0] ?? null;
  return (
    <>
      <PageHeader kicker="S12 / strategy designer" title="Collections strategy" lead={`Versioned decision tables: eligibility → probability → exposure/ERA → action bucket → treatment → contact controls → capacity → dispatch. Current daily snapshot ${run ? run.businessDate.toISOString().slice(0, 10) : "none"} · app clock ${formatBakuDateTime(t)}.`} />
      <Callout tone="info">Rules are data, never code. Drafts are validated for overlaps, gaps, invalid probabilities and disabled channels; a dry simulation never changes work items. Publishing happens only through independent approval on S11, and no treatment can bypass the server-enforced contact restrictions.</Callout>
      <div className="mt-3">
        <StrategyDesigner versions={items} selectedId={selected?.id ?? null} canDraft={hasPermission(user.role, "strategy.draft")} canSubmit={hasPermission(user.role, "approval.request")} />
      </div>
    </>
  );
}
