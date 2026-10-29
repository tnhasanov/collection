import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { forbidden } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";
import { customerScope, scopeAllows, type CustomerScope } from "@/server/auth/scope";

/**
 * Object-level access. Every page and API route re-checks the same scope (see scope.ts), so a stale tab cannot
 * keep access after a handover, and an old interaction cannot grant indefinite access.
 */
export async function canAccessCustomer(db: Db, user: SessionUser, customerId: string, scope?: CustomerScope): Promise<boolean> {
  const s = scope ?? (await customerScope(db, user, new Date()));
  if (s.kind === "BRANCHES") {
    const c = await db.customer.findUnique({ where: { id: customerId }, select: { branch: true } });
    return !!c && scopeAllows(s, { id: customerId, branch: c.branch });
  }
  return scopeAllows(s, { id: customerId });
}

export async function requireCustomerAccess(db: Db, user: SessionUser, customerId: string, scope?: CustomerScope) {
  const ok = await canAccessCustomer(db, user, customerId, scope);
  if (!ok) {
    await appendAudit(db, { actorUserId: user.id, action: "access.denied", objectType: "Customer", objectId: customerId, customerId, blocked: true, reason: "Out-of-scope customer access attempt" });
    throw forbidden("This customer is outside your assigned scope");
  }
}
