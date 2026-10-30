import { AgentDesktop } from "@/components/agent/AgentDesktop";
import { loadAgentPage } from "../loader";

export const dynamic = "force-dynamic";

/** The canonical call workspace: every call, after-call work and wrap-up happens here. */
export default async function Page() {
  const { initial, agentUser, locale, showDiagnostics } = await loadAgentPage();
  return <AgentDesktop initial={initial} user={agentUser} locale={locale} showDiagnostics={showDiagnostics} />;
}
