import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { customerScope } from "@/server/auth/scope";
import { searchCustomers } from "@/server/modules/customers/customerService";

/** Scoped search: the authorization scope is applied inside the query, before the limit. */
export async function GET(req: Request) {
  try {
    const user = await requireUser("customer.read");
    const { q, limit } = parseQuery(req, z.object({ q: z.string().max(80).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) }));
    const scope = await customerScope(prisma, user, await now());
    const result = await searchCustomers(prisma, q, { limit, scope });
    return ok({ rows: result.rows, hiddenByScope: result.hiddenByScope, normalized: result.normalized });
  } catch (e) {
    return fail(e);
  }
}
