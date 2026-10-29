import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { getSetting } from "@/server/modules/settings/settingsService";

/**
 * One server-side authorization scope for everything customer-related: lists, details, search, aggregates,
 * exports and APIs apply the same scope BEFORE pagination, so a user can never see a row they could not open.
 *
 *  - Unscoped roles (team lead, head, risk, approver, operator, auditor, admin): every customer, optionally
 *    limited to their branch scopes.
 *  - Scoped roles (agents): customers currently reserved for them, work items they own or claimed, their own
 *    interactions inside a bounded history window (open/draft/pending wrap-up always), and their promises that
 *    are still active or matured recently. An old interaction never grants indefinite access.
 */
export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] as const;
export const ACTIVE_WORK_STATUSES = ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] as const;
export const ACTIVE_PROMISE_STATUSES = ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] as const;
export const DEFAULT_SCOPED_HISTORY_DAYS = 14;

export interface CustomerScope {
  /** ALL = every customer; BRANCHES = customers of the listed branches; CUSTOMERS = the explicit list; NONE = nothing. */
  kind: "ALL" | "BRANCHES" | "CUSTOMERS" | "NONE";
  branches: string[];
  customerIds: string[];
  historyDays: number;
  evaluatedAt: Date;
}

export async function scopedHistoryDays(db: Db): Promise<number> {
  const v = await getSetting<number>("access.scopedHistoryDays", db).catch(() => null);
  return typeof v === "number" && v > 0 ? v : DEFAULT_SCOPED_HISTORY_DAYS;
}

/** Computes the customer scope of a user at `now`. Cheap enough to run per request (four indexed queries for agents). */
export async function customerScope(db: Db, user: SessionUser, now: Date): Promise<CustomerScope> {
  const historyDays = await scopedHistoryDays(db);
  const base = { branches: [] as string[], customerIds: [] as string[], historyDays, evaluatedAt: now };
  if (hasPermission(user.role, "customer.read.unscoped")) {
    return user.branchScopes.length === 0 ? { ...base, kind: "ALL" } : { ...base, kind: "BRANCHES", branches: [...user.branchScopes] };
  }
  if (!hasPermission(user.role, "customer.read")) return { ...base, kind: "NONE" };
  const since = new Date(now.getTime() - historyDays * 86_400_000);
  const [reservations, work, interactions, promises] = await Promise.all([
    db.routingReservation.findMany({ where: { agentUserId: user.id, status: { in: [...ACTIVE_RESERVATION_STATUSES] } }, select: { customerId: true } }),
    db.workItem.findMany({ where: { OR: [{ ownerUserId: user.id }, { claimedByUserId: user.id }], status: { in: [...ACTIVE_WORK_STATUSES] } }, select: { customerId: true } }),
    db.interaction.findMany({
      where: { agentUserId: user.id, OR: [{ status: { in: ["OPEN", "DRAFT"] } }, { wrapUpStatus: { in: ["PENDING", "FAILED"] } }, { startedAt: { gte: since } }] },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    db.promise.findMany({
      where: { AND: [{ OR: [{ ownerUserId: user.id }, { createdByUserId: user.id }] }, { OR: [{ status: { in: [...ACTIVE_PROMISE_STATUSES] } }, { createdAt: { gte: since } }, { maturedAt: { gte: since } }] }] },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);
  const ids = new Set<string>();
  for (const r of reservations) ids.add(r.customerId);
  for (const w of work) ids.add(w.customerId);
  for (const i of interactions) ids.add(i.customerId);
  for (const p of promises) ids.add(p.customerId);
  return { ...base, kind: "CUSTOMERS", customerIds: [...ids] };
}

/** Where-clause for the Customer model itself. */
export function customerWhere(scope: CustomerScope): Prisma.CustomerWhereInput {
  switch (scope.kind) {
    case "ALL":
      return {};
    case "BRANCHES":
      return { branch: { in: scope.branches } };
    case "CUSTOMERS":
      return { id: { in: scope.customerIds } };
    case "NONE":
      return { id: { in: [] } };
  }
}

/** Where-clause fragment for any model that carries `customerId` and a `customer` relation (payments, promises, work items, interactions, exceptions, claims, messages). */
export function byCustomerWhere(scope: CustomerScope): { customerId?: { in: string[] }; customer?: { branch: { in: string[] } } } {
  switch (scope.kind) {
    case "ALL":
      return {};
    case "BRANCHES":
      return { customer: { branch: { in: scope.branches } } };
    case "CUSTOMERS":
      return { customerId: { in: scope.customerIds } };
    case "NONE":
      return { customerId: { in: [] } };
  }
}

export function scopeIsUnscoped(scope: CustomerScope): boolean {
  return scope.kind === "ALL" || scope.kind === "BRANCHES";
}

/** Point check against an already computed scope (branch is needed only for BRANCHES scopes). */
export function scopeAllows(scope: CustomerScope, customer: { id: string; branch?: string | null }): boolean {
  switch (scope.kind) {
    case "ALL":
      return true;
    case "BRANCHES":
      return !!customer.branch && scope.branches.includes(customer.branch);
    case "CUSTOMERS":
      return scope.customerIds.includes(customer.id);
    case "NONE":
      return false;
  }
}
