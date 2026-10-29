import type { Role } from "@/generated/prisma/enums";

/**
 * Permission matrix (server-enforced). A disabled menu is never authorization; every API route and page
 * checks the permission on the server. Object-level scope (which customers a user may open) is checked
 * separately in access.ts.
 */
export const PERMISSIONS = [
  "agent.desktop",
  "agent.supervise",
  "customer.read",
  "customer.read.unscoped",
  "customer.contact.masked",
  "queue.read",
  "queue.claim",
  "queue.reassign",
  "interaction.write",
  "interaction.correct",
  "promise.write",
  "callback.write",
  "payment.read",
  "payment.simulate",
  "payment.reconcile",
  "import.write",
  "strategy.read",
  "strategy.draft",
  "model.read",
  "model.draft",
  "policy.draft",
  "approval.request",
  "approval.decide",
  "operations.read",
  "operations.manage",
  "analytics.read",
  "integration.read",
  "integration.operate",
  "exception.manage",
  "audit.read",
  "settings.read",
  "settings.write",
  "users.manage",
  "export.scoped",
  "recovery.manage",
  "arrangement.write",
  "arrangement.review",
  "campaign.manage",
  "template.manage",
  "support.restricted.read",
  "demo.switch-role",
  "reminder.resend",
  "diagnostics.read",
  "special-case.confirm",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const AGENT_BASE: Permission[] = ["agent.desktop", "customer.read", "customer.contact.masked", "queue.read", "interaction.write", "promise.write", "callback.write", "payment.read", "support.restricted.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  AGENT: AGENT_BASE,
  SENIOR_AGENT: [...AGENT_BASE, "queue.claim", "interaction.correct"],
  TEAM_LEAD: [
    ...AGENT_BASE,
    "agent.supervise",
    "customer.read.unscoped",
    "queue.claim",
    "queue.reassign",
    "interaction.correct",
    "operations.read",
    "operations.manage",
    "analytics.read",
    "exception.manage",
    "strategy.read",
    "model.read",
    "settings.read",
    "approval.request",
    "export.scoped",
    "arrangement.write",
    "arrangement.review",
    "recovery.manage",
    "integration.read",
    "reminder.resend",
    "special-case.confirm",
  ],
  COLLECTIONS_HEAD: [
    ...AGENT_BASE,
    "agent.supervise",
    "customer.read.unscoped",
    "queue.claim",
    "queue.reassign",
    "operations.read",
    "operations.manage",
    "analytics.read",
    "exception.manage",
    "strategy.read",
    "strategy.draft",
    "model.read",
    "policy.draft",
    "settings.read",
    "settings.write",
    "approval.request",
    "export.scoped",
    "arrangement.write",
    "arrangement.review",
    "recovery.manage",
    "campaign.manage",
    "template.manage",
    "integration.read",
    "payment.reconcile",
    "reminder.resend",
    "special-case.confirm",
  ],
  RISK_ANALYST: ["customer.read", "customer.read.unscoped", "customer.contact.masked", "analytics.read", "strategy.read", "strategy.draft", "model.read", "policy.draft", "settings.read", "approval.request", "export.scoped", "operations.read", "payment.read", "integration.read"],
  MODEL_MAKER: ["customer.read", "customer.read.unscoped", "customer.contact.masked", "analytics.read", "strategy.read", "model.read", "model.draft", "approval.request", "settings.read", "payment.read", "integration.read"],
  INDEPENDENT_APPROVER: ["customer.read", "customer.read.unscoped", "customer.contact.masked", "analytics.read", "strategy.read", "model.read", "approval.decide", "settings.read", "audit.read", "payment.read", "integration.read"],
  INTEGRATION_OPERATOR: ["integration.read", "integration.operate", "import.write", "payment.read", "payment.reconcile", "payment.simulate", "exception.manage", "settings.read", "customer.read", "customer.read.unscoped", "customer.contact.masked", "operations.read", "diagnostics.read"],
  AUDITOR: ["audit.read", "customer.read", "customer.read.unscoped", "customer.contact.masked", "analytics.read", "strategy.read", "model.read", "settings.read", "payment.read", "operations.read", "integration.read", "export.scoped", "diagnostics.read"],
  ADMIN: ["users.manage", "settings.read", "settings.write", "integration.read", "integration.operate", "audit.read", "customer.read", "customer.read.unscoped", "customer.contact.masked", "operations.read", "strategy.read", "model.read", "analytics.read", "payment.read", "payment.simulate", "exception.manage", "demo.switch-role", "import.write", "diagnostics.read"],
  SERVICE: ["integration.operate", "import.write", "payment.read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  AGENT: "Collection agent",
  SENIOR_AGENT: "Senior agent",
  TEAM_LEAD: "Team lead",
  COLLECTIONS_HEAD: "Collections head",
  RISK_ANALYST: "Risk analyst",
  MODEL_MAKER: "Model maker",
  INDEPENDENT_APPROVER: "Independent approver",
  INTEGRATION_OPERATOR: "Integration operator",
  AUDITOR: "Auditor / QA reviewer",
  ADMIN: "System administrator",
  SERVICE: "Service account",
};

/** Landing route by role (S01). */
export function landingPathForRole(role: Role): string {
  switch (role) {
    case "AGENT":
    case "SENIOR_AGENT":
      return "/agent";
    case "TEAM_LEAD":
    case "COLLECTIONS_HEAD":
      return "/operations";
    case "RISK_ANALYST":
    case "MODEL_MAKER":
      return "/analytics";
    case "INDEPENDENT_APPROVER":
      return "/approvals";
    case "INTEGRATION_OPERATOR":
      return "/integrations";
    case "AUDITOR":
      return "/audit";
    case "ADMIN":
      return "/admin/users";
    default:
      return "/overview";
  }
}
