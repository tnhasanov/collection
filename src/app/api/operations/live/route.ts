import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { liveSupervision } from "@/server/modules/operations/operationsService";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireUser("operations.read");
    return ok(await liveSupervision(prisma, await now()));
  } catch (e) {
    return fail(e);
  }
}
