import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { proposalSchema, simulateArrangement } from "@/server/modules/arrangements/arrangementService";

const schema = z.object({ customerId: z.string(), proposal: proposalSchema });

export const POST = route(async (req) => {
  const user = await requireUser("customer.read");
  const body = await parseBody(req, schema);
  await requireCustomerAccess(prisma, user, body.customerId);
  return ok(await simulateArrangement(prisma, body.customerId, body.proposal, await now()));
});
