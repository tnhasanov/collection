import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission, ROLE_LABELS } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { agentDesktopContext } from "@/server/modules/agent/agentDesktopService";
import { workerOnline } from "@/server/modules/dialer/mockEventScheduler";
import { currentLocale } from "@/i18n/locale";
import type { AgentContext } from "@/components/agent/types";

export async function loadAgentPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "agent.desktop")) redirect("/access-denied");
  const profile = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
  const t = await now();
  const locale = await currentLocale();
  const ctx = await agentDesktopContext(prisma, user, t, { full: true });
  const initial = JSON.parse(JSON.stringify({ ...ctx, workerOnline: await workerOnline() })) as AgentContext;
  return {
    user,
    initial,
    locale,
    // Technical diagnostics (correlation ids, provider references, versions) are shown only to roles that read them.
    showDiagnostics: hasPermission(user.role, "diagnostics.read") || hasPermission(user.role, "agent.supervise"),
    agentUser: { id: user.id, displayName: user.displayName, roleLabel: ROLE_LABELS[user.role], teamName: user.teamName, languages: user.languages, manualDialAllowed: profile?.manualDialAllowed ?? false },
    now: t,
  };
}
