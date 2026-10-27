import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission, PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { formatBakuDateTime } from "@/server/dates";
import { Badge, Card } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Role } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "users.manage")) redirect("/access-denied");
  const users = await prisma.user.findMany({ include: { team: true, agentProfile: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, createdAt: true } } }, orderBy: [{ role: "asc" }, { displayName: "asc" }] });
  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  return (
    <>
      <PageHeader kicker="S25 / users, roles & organizational access" title="Users, roles & access" lead="Identity mapping, teams, roles, skills, language, branch/portfolio scopes and session controls. No admin self-escalation into model approval or audit rewriting; service accounts are narrowly scoped." />
      <Card padded={false} title="Users">
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>User</th><th>Role</th><th>Team</th><th>Skills / seniority</th><th>Languages</th><th>Branch scope</th><th>Dialer identity</th><th>Status</th><th>Active sessions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.displayName}</div><div className="text-xs text-muted">{u.username} · {u.identityRef ?? "local-demo identity"}</div></td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.team?.name ?? "—"}</td>
                  <td className="text-xs">{u.skills.join(", ") || "—"}{u.agentProfile ? ` · ${u.agentProfile.seniority.toLowerCase()}` : ""}</td>
                  <td>{u.languages.join("/")}</td>
                  <td className="text-xs">{u.branchScopes.length ? u.branchScopes.join(", ") : "all branches"}</td>
                  <td className="text-xs">{u.agentProfile ? `${u.agentProfile.providerAgentRef} · ext ${u.agentProfile.extension} · ${u.agentProfile.campaignCodes.join(", ")}` : "—"}</td>
                  <td><Badge tone={u.isActive ? "success" : "neutral"}>{u.isServiceAccount ? "service" : u.isActive ? "active" : "inactive"}</Badge></td>
                  <td className="text-xs">{u.sessions.length ? `${u.sessions.length} (since ${formatBakuDateTime(u.sessions[0].createdAt)})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-3" padded={false} title="Permission matrix" subtitle="Enforced on the server for every page and API route (automated API-level access tests in tests/integration). Maker and checker roles are separated; ADMIN cannot approve or draft models.">
        <div className="overflow-x-auto">
          <table className="table-dense text-xs">
            <thead><tr><th>Permission</th>{roles.map((r) => (<th key={r} className="whitespace-nowrap">{ROLE_LABELS[r]}</th>))}</tr></thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}><td className="font-mono">{p}</td>{roles.map((r) => (<td key={r} className="text-center">{ROLE_PERMISSIONS[r].includes(p) ? "✓" : ""}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">User administration (create/deactivate, identity mapping to the bank IdP, scope changes) is performed through the identity provider and seed configuration in this demo; changes made here would be audited as access changes.</p>
    </>
  );
}
