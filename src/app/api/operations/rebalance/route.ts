import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { simulateRebalance } from "@/server/modules/operations/operationsService";

export async function POST() {
  try {
    await requireUser("operations.manage");
    return ok(await simulateRebalance(prisma));
  } catch (e) {
    return fail(e);
  }
}
