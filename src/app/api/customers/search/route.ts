import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { searchCustomers } from "@/server/modules/customers/customerService";
import { canAccessCustomer } from "@/server/auth/access";

export async function GET(req: Request) {
  try {
    const user = await requireUser("customer.read");
    const { q } = parseQuery(req, z.object({ q: z.string().max(80).default("") }));
    const rows = await searchCustomers(prisma, q);
    const allowed = [];
    for (const r of rows) if (await canAccessCustomer(prisma, user, r.id)) allowed.push(r);
    return ok({ rows: allowed, hiddenByScope: rows.length - allowed.length });
  } catch (e) {
    return fail(e);
  }
}
