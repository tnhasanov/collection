import type { Role } from "@/generated/prisma/enums";
import { hasPermission, type Permission } from "@/server/auth/permissions";

export interface NavItem {
  href: string;
  labelKey: string;
  screen: string;
  permission?: Permission;
}
export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const AGENT_NAV: NavGroup[] = [
  {
    labelKey: "nav.myWorkspace",
    items: [
      { href: "/agent", labelKey: "nav.agent", screen: "S28A" },
      { href: "/agent/call", labelKey: "nav.agentCall", screen: "S28B" },
      { href: "/agent/callbacks", labelKey: "nav.agentCallbacks", screen: "S08" },
      { href: "/agent/promises", labelKey: "nav.agentPromises", screen: "S07" },
      { href: "/agent/results", labelKey: "nav.agentResults", screen: "S18" },
      { href: "/agent/tasks", labelKey: "nav.agentTasks", screen: "S22" },
    ],
  },
];

const MANAGEMENT_NAV: NavGroup[] = [
  {
    labelKey: "nav.work",
    items: [
      { href: "/overview", labelKey: "nav.overview", screen: "S02", permission: "analytics.read" },
      { href: "/work-queue", labelKey: "nav.workQueue", screen: "S03", permission: "queue.read" },
      { href: "/customers", labelKey: "nav.customers", screen: "S04", permission: "customer.read" },
      { href: "/promises", labelKey: "nav.promises", screen: "S07", permission: "customer.read" },
      { href: "/tasks", labelKey: "nav.tasks", screen: "S08", permission: "customer.read" },
      { href: "/payments", labelKey: "nav.payments", screen: "S09", permission: "payment.read" },
    ],
  },
  {
    labelKey: "nav.portfolio",
    items: [
      { href: "/analytics", labelKey: "nav.analytics", screen: "S18", permission: "analytics.read" },
      { href: "/arrangements", labelKey: "nav.arrangements", screen: "S10", permission: "arrangement.review" },
      { href: "/recovery", labelKey: "nav.recovery", screen: "S26", permission: "recovery.manage" },
      { href: "/self-service", labelKey: "nav.selfService", screen: "S27", permission: "analytics.read" },
    ],
  },
  {
    labelKey: "nav.strategy",
    items: [
      { href: "/strategies", labelKey: "nav.strategies", screen: "S12", permission: "strategy.read" },
      { href: "/models/prometeia", labelKey: "nav.models", screen: "S13", permission: "model.read" },
      { href: "/strategy/economics", labelKey: "nav.economics", screen: "S14", permission: "strategy.read" },
      { href: "/model-monitoring", labelKey: "nav.monitoring", screen: "S19", permission: "model.read" },
      { href: "/campaigns", labelKey: "nav.campaigns", screen: "S15", permission: "campaign.manage" },
      { href: "/templates", labelKey: "nav.templates", screen: "S16", permission: "template.manage" },
    ],
  },
  {
    labelKey: "nav.management",
    items: [
      { href: "/operations", labelKey: "nav.operations", screen: "S17", permission: "operations.read" },
      { href: "/approvals", labelKey: "nav.approvals", screen: "S11", permission: "approval.request" },
      { href: "/exceptions", labelKey: "nav.exceptions", screen: "S22", permission: "exception.manage" },
    ],
  },
  {
    labelKey: "nav.administration",
    items: [
      { href: "/data/imports", labelKey: "nav.imports", screen: "S20", permission: "import.write" },
      { href: "/integrations", labelKey: "nav.integrations", screen: "S21", permission: "integration.read" },
      { href: "/audit", labelKey: "nav.audit", screen: "S23", permission: "audit.read" },
      { href: "/settings", labelKey: "nav.settings", screen: "S24", permission: "settings.read" },
      { href: "/admin/users", labelKey: "nav.users", screen: "S25", permission: "users.manage" },
    ],
  },
];

export function navForRole(role: Role): NavGroup[] {
  if (role === "AGENT" || role === "SENIOR_AGENT") return AGENT_NAV;
  const approverExtra: NavGroup[] = role === "INDEPENDENT_APPROVER" ? [{ labelKey: "nav.management", items: [{ href: "/approvals", labelKey: "nav.approvals", screen: "S11", permission: "approval.decide" }] }] : [];
  const groups = MANAGEMENT_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || hasPermission(role, i.permission)) })).filter((g) => g.items.length > 0);
  for (const extra of approverExtra) {
    const g = groups.find((x) => x.labelKey === extra.labelKey);
    if (g) {
      for (const it of extra.items) if (!g.items.some((x) => x.href === it.href)) g.items.push(it);
    } else groups.push(extra);
  }
  return groups;
}
