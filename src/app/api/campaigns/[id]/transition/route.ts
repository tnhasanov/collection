import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { CAMPAIGN_ACTIONS, transitionCampaign } from "@/server/modules/campaigns/campaignService";

const schema = z.object({ action: z.enum(CAMPAIGN_ACTIONS), note: z.string().min(3).max(600) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("campaign.manage");
  const { id } = await ctx.params;
  const parsed = await parseBody(req, schema);
  return ok(await transitionCampaign(prisma, id, parsed.action, user, parsed.note, await now()));
});
