import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { renderTemplate, smsInfo, validateTemplateText, variablesForCustomer } from "@/server/modules/templates/templateService";

const schema = z.object({ text: z.string().max(4000), kind: z.enum(["SMS", "AGENT_SCRIPT", "PTP_REMINDER", "SUPPORT_SCRIPT", "THIRD_PARTY_SCRIPT"]).default("SMS"), customerId: z.string().nullable().optional() });

/** Validate + render a template with a synthetic customer's variables; SMS length/encoding/segments. */
export const POST = route(async (req) => {
  const user = await requireUser("template.manage");
  const body = await parseBody(req, schema);
  if (body.customerId) await requireCustomerAccess(prisma, user, body.customerId);
  const vars = await variablesForCustomer(prisma, body.customerId ?? null, user.displayName);
  const rendered = renderTemplate(body.text, vars);
  return ok({ validation: validateTemplateText(body.text, body.kind), rendered, sms: body.kind === "SMS" || body.kind === "PTP_REMINDER" ? smsInfo(rendered) : null, variables: vars });
});
