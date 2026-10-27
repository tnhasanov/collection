import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { campaignAudience } from "@/server/modules/campaigns/campaignService";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("campaign.manage");
  const { id } = await ctx.params;
  return ok(await campaignAudience(prisma, id, await now()));
});
