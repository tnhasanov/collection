import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { Callout } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { computeEconomics, defaultEconomicsInput } from "@/server/modules/economics/economicsService";
import { EconomicsWorkbench } from "@/components/economics/EconomicsWorkbench";

export const dynamic = "force-dynamic";

export default async function EconomicsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "strategy.read")) redirect("/access-denied");
  const t = await now();
  const [conservative, base, upside] = await Promise.all((["conservative", "base", "upside"] as const).map((s) => defaultEconomicsInput(prisma, s)));
  const baseResult = await computeEconomics(prisma, base, t);
  const settings = await prisma.setting.findMany({ where: { key: { in: ["economics.unitCosts", "economics.upliftScenarios", "capacity.planning", "capacity.operational"] } } });
  return (
    <>
      <PageHeader kicker="S14 / action economics and capacity" title="Action economics & capacity" lead="Dated unit costs, scenario uplift assumptions, break-even ERA, eligible population and successful-contact capacity. Compare scenarios side by side; nothing here activates a strategy." />
      <Callout tone="warning">Uplift is an assumption per scenario (conservative / base / upside from the source deck), never a measured causal benefit. ERA ranks risk; it is not expected recovery. Units: SMS cost per SMS, IVR per attempt, agent per customer-day.</Callout>
      <div className="mt-3">
        <EconomicsWorkbench presets={{ conservative, base, upside }} initial={baseResult} canEdit={hasPermission(user.role, "settings.write") || hasPermission(user.role, "strategy.draft")} provenance={settings.map((s) => ({ key: s.key, provenance: s.provenance, effectiveFrom: s.effectiveFrom?.toISOString() ?? null, version: s.version, owner: s.owner }))} />
      </div>
    </>
  );
}
