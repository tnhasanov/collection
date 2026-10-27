import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { forbidden } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * Object-level access: unscoped roles see every customer in their branch scope; agents see only customers
 * currently assigned/reserved to them, their owned callbacks/follow-ups, their own interactions and promises.
 * Every API request re-checks this; a stale tab cannot keep access after a handover.
 */
export async function canAccessCustomer(db: Db, user: SessionUser, customerId: string): Promise<boolean> {
  if (hasPermission(user.role, "customer.read.unscoped")) {
    if (user.branchScopes.length === 0) return true;
    const c = await db.customer.findUnique({ where: { id: customerId }, select: { branch: true } });
    return !!c && user.branchScopes.includes(c.branch);
  }
  if (!hasPermission(user.role, "customer.read")) return false;
  const reservation = await db.routingReservation.findFirst({ where: { customerId, agentUserId: user.id, status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } }, select: { id: true } });
  if (reservation) return true;
  const work = await db.workItem.findFirst({ where: { customerId, OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, select: { id: true } });
  if (work) return true;
  const own = await db.interaction.findFirst({ where: { customerId, agentUserId: user.id }, select: { id: true } });
  if (own) return true;
  const promise = await db.promise.findFirst({ where: { customerId, OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }] }, select: { id: true } });
  return !!promise;
}

export async function requireCustomerAccess(db: Db, user: SessionUser, customerId: string) {
  const ok = await canAccessCustomer(db, user, customerId);
  if (!ok) {
    await appendAudit(db, { actorUserId: user.id, action: "access.denied", objectType: "Customer", objectId: customerId, customerId, blocked: true, reason: "Out-of-scope customer access attempt" });
    throw forbidden("This customer is outside your assigned scope");
  }
}
