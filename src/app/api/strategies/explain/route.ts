import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { notFound, unprocessable } from "@/server/errors";
import { explainCustomerUnderStrategy, validateStrategyConfig } from "@/server/modules/strategy/strategyService";

const schema = z.object({ customerId: z.string().min(1), strategyId: z.string().min(1) });

/** Customer-level explanation under a candidate strategy versus the active daily snapshot. */
export const GET = route(async (req) => {
  const user = await requireUser("strategy.read");
  const q = parseQuery(req, schema);
  await requireCustomerAccess(prisma, user, q.customerId);
  const sv = await prisma.strategyVersion.findUnique({ where: { id: q.strategyId } });
  if (!sv) throw notFound("Strategy version not found");
  const v = validateStrategyConfig(sv.configJson);
  if (!v.config) throw unprocessable("Strategy configuration is invalid", v.issues);
  const result = await explainCustomerUnderStrategy(prisma, q.customerId, v.config, await now());
  if (!result) throw notFound("Customer not found");
  return ok(result);
});
