import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseQuery } from "@/server/http";
import { requireUser, isSyntheticMode } from "@/server/auth/session";
import { customerScope, customerWhere } from "@/server/auth/scope";
import { now } from "@/server/clock";
import { forbidden } from "@/server/errors";

const schema = z.object({ kind: z.enum(["loans", "transactions"]).default("loans"), q: z.string().max(80).default(""), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(50).default(20) });

/**
 * Scoped, searchable, paginated lookup for the payment simulator (synthetic environments only). Every active loan
 * is selectable regardless of DPD or overdue amount; the authorization scope is applied inside the query.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser("payment.simulate");
    if (!isSyntheticMode()) throw forbidden("Payment simulation is available only in synthetic environments (DEMO or PILOT)");
    const { kind, q, page, pageSize } = parseQuery(req, schema);
    const scope = await customerScope(prisma, user, await now());
    const term = q.trim();
    if (kind === "loans") {
      const where = {
        status: "ACTIVE" as const,
        customer: customerWhere(scope),
        ...(term ? { OR: [{ coreLoanId: { contains: term, mode: "insensitive" as const } }, { id: { contains: term, mode: "insensitive" as const } }, { customerId: { contains: term, mode: "insensitive" as const } }, { customer: { OR: [{ displayName: { contains: term, mode: "insensitive" as const } }, { cif: { contains: term, mode: "insensitive" as const } }] } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.loan.count({ where }),
        prisma.loan.findMany({ where, orderBy: [{ customerId: "asc" }, { coreLoanId: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, coreLoanId: true, customerId: true, totalOverdue: true, dpd: true, nextDueAmount: true, customer: { select: { displayName: true } } } }),
      ]);
      return ok({ total, page, pageSize, rows: rows.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, customerId: l.customerId, customerName: l.customer.displayName, totalOverdue: l.totalOverdue.toString(), dpd: l.dpd, nextDueAmount: l.nextDueAmount?.toString() ?? null })) });
    }
    const where = {
      status: "POSTED" as const,
      customer: customerWhere(scope),
      ...(term ? { OR: [{ sourceTransactionId: { contains: term, mode: "insensitive" as const } }, { loanRef: { contains: term, mode: "insensitive" as const } }, { customer: { displayName: { contains: term, mode: "insensitive" as const } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({ where, orderBy: { eventAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, sourceTransactionId: true, sourceSystem: true, amount: true, loanRef: true, eventAt: true, customer: { select: { displayName: true } } } }),
    ]);
    return ok({ total, page, pageSize, rows: rows.map((p) => ({ id: p.id, transactionId: p.sourceTransactionId, sourceSystem: p.sourceSystem, amount: p.amount.toString(), loanRef: p.loanRef, eventAt: p.eventAt, customerName: p.customer?.displayName ?? null })) });
  } catch (e) {
    return fail(e);
  }
}
