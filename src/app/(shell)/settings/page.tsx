import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { formatBakuDateTime } from "@/server/dates";
import { Card, Callout } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsEditor } from "@/components/settings/SettingsEditor";

export const dynamic = "force-dynamic";
const GROUPS: [string, string, string][] = [
  ["product", "Cash-loan product & financial conventions", "Nominal-rate display, rounding, schedule simulation, business-day/calendar conventions, demo allocation policy, DPD tolerance, currency."],
  ["contactPolicy", "Contact policy", "Cooldowns, quiet hours, holidays, day/week/channel limits, PTP restrictions, support/dispute rules, retry rules, freshness thresholds. Assumed limits are not labelled as Azerbaijani legal requirements."],
  ["freshness", "Source-freshness thresholds", "Critical balance/payment freshness blocks amount-specific outreach until refreshed."],
  ["model", "Decision and model conventions", "Segment boundaries, draft roll rates, self-cure preference, exposure definition, bucket method, rescore policy."],
  ["economics", "Action economics", "Unit costs and uplift scenarios from the source deck."],
  ["capacity", "Capacity", "Planning and operational capacity inputs."],
  ["outbound", "Outbound execution controls", "Kill switch and paused channels/campaigns."],
  ["clock", "Clocks", "Business date for portfolio calculations; actual clock for dispatch restrictions. Historical simulation cannot authorize real outreach."],
  ["flags", "Feature flags", "Real connectors and AI features default off."],
];

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "settings.read")) redirect("/access-denied");
  const settings = await prisma.setting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  const t = await now();
  return (
    <>
      <PageHeader kicker="S24 / product and policy settings" title="Product & policy settings" lead={`Every parameter is marked Source-based, Demo assumption or Bank-approved with owner, version and effective date. App clock ${formatBakuDateTime(t, { seconds: true })} (${process.env.DEMO_CLOCK_MODE === "real" ? "real" : "demo offset"}).`} />
      <Callout tone="warning">Nothing on this page is a legal requirement assertion. Demo assumptions are reversible placeholders; policy and model parameters route through independent approval (S11) before they take effect.</Callout>
      <div className="mt-3 space-y-3">
        {GROUPS.map(([g, title, lead]) => (
          <Card key={g} title={title} subtitle={lead}>
            <SettingsEditor items={settings.filter((s) => s.group === g).map((s) => ({ key: s.key, value: s.value, provenance: s.provenance, owner: s.owner, version: s.version, effectiveFrom: s.effectiveFrom ? s.effectiveFrom.toISOString() : null, description: s.description, editable: s.editableRoles.includes(user.role) || (hasPermission(user.role, "settings.write") && !["AUDITOR"].includes(user.role)), updatedAt: s.updatedAt.toISOString(), updatedBy: s.updatedBy }))} />
          </Card>
        ))}
      </div>
    </>
  );
}
