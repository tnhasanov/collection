import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { ingestIntegrationEvent } from "@/server/modules/payments/paymentService";

/** Inbound application event endpoint (payment.posted, payment.reversed, loan.balance.snapshot, customer.contact.updated). Idempotent. */
export async function POST(req: Request) {
  try {
    await requireUser("integration.operate");
    const body = await req.json();
    const r = await ingestIntegrationEvent(prisma, body, await now());
    return ok(r, { status: r.status === "DUPLICATE" ? 200 : 202 });
  } catch (e) {
    return fail(e);
  }
}
