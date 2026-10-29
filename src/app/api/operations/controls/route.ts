import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { getOutboundControls, setSetting } from "@/server/modules/settings/settingsService";
import { appendAudit } from "@/server/modules/audit/audit";
import { forceEndInteraction } from "@/server/modules/dialer/providerReconciliation";
import { now } from "@/server/clock";
import { badRequest } from "@/server/errors";

const schema = z.object({ action: z.enum(["KILL_SWITCH_ON", "KILL_SWITCH_OFF", "PAUSE_CHANNEL", "RESUME_CHANNEL", "PAUSE_CAMPAIGN", "RESUME_CAMPAIGN", "FORCE_END_CALL"]), channel: z.enum(["VOICE", "SMS"]).optional(), campaignCode: z.string().optional(), interactionId: z.string().optional(), reason: z.string().min(3).max(300) });

/** Emergency and campaign controls. Pausing is immediate; resuming uses the approved active policy. Every change is audited. */
export async function POST(req: Request) {
  try {
    const user = await requireUser("operations.manage");
    const input = await parseBody(req, schema);
    if (input.action === "FORCE_END_CALL") {
      // Supervisor exception path for a call the provider did not end (rejected/unknown End, lost worker): the
      // interaction moves to after-call work with an upper-bound talk time, the agent lands in ACW and the
      // related CALL_CONTROL_FAILURE / CALL_STATE_UNKNOWN exceptions are resolved. Audited with the reason.
      if (!input.interactionId) throw badRequest("interactionId is required");
      const r = await forceEndInteraction(prisma, { interactionId: input.interactionId, actorUserId: user.id, reason: input.reason, now: await now() });
      return ok(r);
    }
    const c = await getOutboundControls(prisma);
    switch (input.action) {
      case "KILL_SWITCH_ON": await setSetting(prisma, "outbound.killSwitch", true, user.id); break;
      case "KILL_SWITCH_OFF": await setSetting(prisma, "outbound.killSwitch", false, user.id); break;
      case "PAUSE_CHANNEL": await setSetting(prisma, "outbound.pausedChannels", [...new Set([...c.pausedChannels, input.channel!])], user.id); break;
      case "RESUME_CHANNEL": await setSetting(prisma, "outbound.pausedChannels", c.pausedChannels.filter((x) => x !== input.channel), user.id); break;
      case "PAUSE_CAMPAIGN": await setSetting(prisma, "outbound.pausedCampaigns", [...new Set([...c.pausedCampaigns, input.campaignCode!])], user.id); await prisma.campaign.updateMany({ where: { code: input.campaignCode }, data: { status: "PAUSED" } }); break;
      case "RESUME_CAMPAIGN": await setSetting(prisma, "outbound.pausedCampaigns", c.pausedCampaigns.filter((x) => x !== input.campaignCode), user.id); await prisma.campaign.updateMany({ where: { code: input.campaignCode }, data: { status: "RUNNING" } }); break;
    }
    await appendAudit(prisma, { actorUserId: user.id, action: `outbound.${input.action.toLowerCase()}`, objectType: "Setting", objectId: "outbound", reason: input.reason, changes: { channel: input.channel, campaignCode: input.campaignCode } });
    return ok(await getOutboundControls(prisma));
  } catch (e) {
    return fail(e);
  }
}
