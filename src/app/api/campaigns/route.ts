import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { createCampaign } from "@/server/modules/campaigns/campaignService";

const schema = z.object({ code: z.string().regex(/^[A-Z0-9_]{3,40}$/), name: z.string().min(3).max(120), templateId: z.string().nullable(), strategyVersionId: z.string().nullable(), languages: z.array(z.enum(["AZ", "EN", "RU"])).min(1), scheduledAt: z.string().datetime({ offset: true }).nullable().optional() });

export const POST = route(async (req) => {
  const user = await requireUser("campaign.manage");
  const body = await parseBody(req, schema);
  const c = await createCampaign(prisma, { ...body, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }, user);
  return ok({ id: c.id });
});
