import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { teamGrid } from "@/server/modules/operations/operationsService";
import { PageHeader } from "@/components/ui/PageHeader";
import { LiveSupervision } from "@/components/operations/LiveSupervision";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "operations.read")) redirect("/access-denied");
  const data = await teamGrid(prisma, await now());
  return (
    <>
      <PageHeader kicker="S17 / team allocation & operations" title="Team allocation & operations" lead="Provider-confirmed agent states, campaign work and pending wrap-ups in one supervisor view. Keep customer ownership, skill requirements and contact restrictions intact when allocating work." />
      <LiveSupervision initial={JSON.parse(JSON.stringify(data))} canManage={hasPermission(user.role, "operations.manage")} />
    </>
  );
}
