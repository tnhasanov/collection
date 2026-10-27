import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { createArrangement, proposalSchema } from "@/server/modules/arrangements/arrangementService";

const schema = z.object({ customerId: z.string(), supportCaseId: z.string().nullable().optional(), intake: z.record(z.string(), z.unknown()), proposal: proposalSchema });

export const POST = route(async (req) => {
  const user = await requireUser("arrangement.write");
  const body = await parseBody(req, schema);
  await requireCustomerAccess(prisma, user, body.customerId);
  const a = await createArrangement(prisma, body, user, await now());
  return ok({ id: a.id });
});
