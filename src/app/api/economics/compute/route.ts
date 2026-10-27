import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { computeEconomics, economicsInputSchema } from "@/server/modules/economics/economicsService";

/** Compute a scenario (break-even, benefit, capacity) without activating anything. */
export const POST = route(async (req) => {
  await requireUser("strategy.read");
  const input = await parseBody(req, economicsInputSchema);
  return ok(await computeEconomics(prisma, input, await now()));
});
