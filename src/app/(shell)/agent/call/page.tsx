import { AgentDesktop } from "@/components/agent/AgentDesktop";
import { loadAgentPage } from "../loader";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { initial, agentUser, locale, showDiagnostics } = await loadAgentPage();
  return <AgentDesktop initial={initial} user={agentUser} focus="call" locale={locale} showDiagnostics={showDiagnostics} />;
}
