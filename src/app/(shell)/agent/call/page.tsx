import { AgentDesktop } from "@/components/agent/AgentDesktop";
import { loadAgentPage } from "../loader";

export const dynamic = "force-dynamic";

export default async function AgentCallPage() {
  const { initial, agentUser } = await loadAgentPage();
  return <AgentDesktop initial={initial} user={agentUser} focus="call" />;
}
