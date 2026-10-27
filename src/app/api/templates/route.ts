import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { createTemplateVersion } from "@/server/modules/templates/templateService";

const schema = z.object({ fromId: z.string().nullable().optional(), code: z.string().regex(/^[A-Z0-9-]{3,40}$/), version: z.string().regex(/^[A-Za-z0-9._-]{1,20}$/), kind: z.enum(["SMS", "AGENT_SCRIPT", "PTP_REMINDER", "SUPPORT_SCRIPT", "THIRD_PARTY_SCRIPT"]), language: z.enum(["AZ", "EN", "RU"]), title: z.string().min(3).max(120), text: z.string().min(1).max(4000), channelScope: z.array(z.string()).min(1), fallbackLanguage: z.enum(["AZ", "EN", "RU"]).nullable().optional() });

export const POST = route(async (req) => {
  const user = await requireUser("template.manage");
  const body = await parseBody(req, schema);
  const t = await createTemplateVersion(prisma, body, user);
  return ok({ id: t.id });
});
