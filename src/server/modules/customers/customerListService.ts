import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { CustomerScope } from "@/server/auth/scope";
import { fromDbDate } from "@/server/dates";
import { normalizePhoneTerm } from "@/server/modules/customers/customerService";
import { OPEN_WORK_STATUSES, orderWork, workStatusCode } from "@/server/modules/work/nextWork";

/**
 * One row per customer for customer-oriented lists (portfolio list, work queue). Rows are keyed by the stable customer
 * id — never by name or telephone — and the figures are the bank's own loan projections: the number of active loans,
 * their overdue amounts summed once each, and the highest DPD among them. Scope and filters are applied in the query
 * BEFORE grouping and pagination, and the total is a count of distinct customers. Nothing is merged in the database:
 * loans, work items and promises stay separate records and are shown individually in the detail panel.
 */
export type CustomerSort = "overdue" | "dpd" | "loans" | "name";
export type CustomerFilter = "overdue" | "active";

export interface NextWork {
  id: string;
  type: string;
  status: string;
  code: string;
  dueAt: Date | null;
  nextEligibleAt: Date | null;
  reasons: string[];
}

export interface CustomerRow {
  id: string;
  displayName: string;
  cif: string;
  branch: string;
  /** Active loans of the customer (distinct). */
  loans: number;
  /** Sum of `totalOverdue` over the active loans, each loan once. */
  totalOverdue: string;
  /** Highest DPD among the active loans. */
  maxDpd: number;
  next: NextWork | null;
  /** All open work items of the customer (the next one included). */
  openWork: number;
  promise: { status: string; deadlineDate: string | null } | null;
  /** Decision rank of the next work item (work queue only). */
  rank?: number | null;
}

export interface CustomerPage {
  rows: CustomerRow[];
  /** Distinct customers matching scope and filters (not loans, not work items). */
  total: number;
  page: number;
  pageSize: number;
}

const OPEN_PROMISE = ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] as const;

function scopeSql(scope: CustomerScope): Prisma.Sql {
  switch (scope.kind) {
    case "ALL":
      return Prisma.sql`TRUE`;
    case "BRANCHES":
      return Prisma.sql`c."branch" = ANY(${scope.branches}::text[])`;
    case "CUSTOMERS":
      return Prisma.sql`c."id" = ANY(${scope.customerIds}::text[])`;
    case "NONE":
      return Prisma.sql`FALSE`;
  }
}

/** Search by name, customer id, CIF, loan id or telephone (same matching as the customer search). */
async function searchSql(db: Db, q: string | undefined): Promise<Prisma.Sql> {
  const term = q?.trim();
  if (!term) return Prisma.sql`TRUE`;
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const phone = normalizePhoneTerm(term);
  const [loan, phoneCustomers] = await Promise.all([
    db.loan.findFirst({ where: { OR: [{ id: term }, { coreLoanId: term }] }, select: { customerId: true } }),
    phone ? db.contactPoint.findMany({ where: { type: { in: ["MOBILE", "LANDLINE"] }, value: { contains: phone.slice(-9) } }, select: { customerId: true }, take: 50 }) : Promise.resolve([]),
  ]);
  const ids = [...new Set([...(loan ? [loan.customerId] : []), ...phoneCustomers.map((p) => p.customerId)])];
  return Prisma.sql`(c."displayName" ILIKE ${like} OR c."cif" ILIKE ${like} OR c."id" ILIKE ${like} OR c."id" = ANY(${ids}::text[]))`;
}

const SORT_SQL: Record<CustomerSort, string> = {
  overdue: `"totalOverdue"`,
  dpd: `"maxDpd"`,
  loans: `"loans"`,
  name: `"displayName"`,
};

/** Aggregates of active loans per customer, for a known set of customers (one row each, loans counted once). */
export async function customerAggregates(db: Db, customerIds: string[]): Promise<Map<string, { loans: number; totalOverdue: string; maxDpd: number }>> {
  const out = new Map<string, { loans: number; totalOverdue: string; maxDpd: number }>();
  if (customerIds.length === 0) return out;
  const groups = await db.loan.groupBy({ by: ["customerId"], where: { customerId: { in: customerIds }, status: "ACTIVE" }, _count: { _all: true }, _sum: { totalOverdue: true }, _max: { dpd: true } });
  for (const g of groups) out.set(g.customerId, { loans: g._count._all, totalOverdue: (g._sum.totalOverdue ?? 0).toString(), maxDpd: g._max.dpd ?? 0 });
  return out;
}

/** Next work, open-work count and the open promise for the customers on one page. */
export async function attachWork(db: Db, rows: Omit<CustomerRow, "next" | "openWork" | "promise">[], now: Date): Promise<CustomerRow[]> {
  const ids = rows.map((r) => r.id);
  const [work, promises] = await Promise.all([
    ids.length ? db.workItem.findMany({ where: { customerId: { in: ids }, status: { in: [...OPEN_WORK_STATUSES] } }, select: { id: true, customerId: true, type: true, status: true, rank: true, priority: true, dueAt: true, createdAt: true, nextEligibleAt: true, deferredReasons: true } }) : Promise.resolve([]),
    ids.length ? db.promise.findMany({ where: { customerId: { in: ids }, status: { in: [...OPEN_PROMISE] } }, orderBy: { deadline: "asc" }, select: { customerId: true, status: true, deadlineDate: true } }) : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const mine = orderWork(work.filter((w) => w.customerId === r.id), now);
    const first = mine[0];
    const p = promises.find((x) => x.customerId === r.id);
    return {
      ...r,
      next: first ? { id: first.id, type: first.type, status: first.status, code: workStatusCode(first, now), dueAt: first.dueAt, nextEligibleAt: first.nextEligibleAt, reasons: first.deferredReasons } : null,
      openWork: mine.length,
      promise: p ? { status: p.status, deadlineDate: fromDbDate(p.deadlineDate) } : null,
    };
  });
}

/**
 * Portfolio list: customers in scope with at least one active loan (optionally only those with something overdue),
 * aggregated in the database, then sorted and paged by customer. Ties are broken by customer id so pages never
 * overlap or skip a customer.
 */
export async function listCustomers(db: Db, opts: { scope: CustomerScope; q?: string; filter?: CustomerFilter; sort?: CustomerSort; dir?: "asc" | "desc"; page: number; pageSize: number; now: Date }): Promise<CustomerPage> {
  const sort = SORT_SQL[opts.sort ?? "overdue"] ? opts.sort ?? "overdue" : "overdue";
  const dir = opts.dir === "asc" ? "ASC" : opts.dir === "desc" ? "DESC" : sort === "name" ? "ASC" : "DESC";
  const having = opts.filter === "active" ? Prisma.sql`COUNT(l."id") > 0` : Prisma.sql`COUNT(l."id") > 0 AND COALESCE(SUM(l."totalOverdue"), 0) > 0`;
  const where = Prisma.sql`${scopeSql(opts.scope)} AND ${await searchSql(db, opts.q)}`;
  const agg = Prisma.sql`
    SELECT c."id", c."displayName", c."cif", c."branch",
           COUNT(l."id")::int AS "loans",
           COALESCE(SUM(l."totalOverdue"), 0)::numeric(18,2) AS "totalOverdue",
           COALESCE(MAX(l."dpd"), 0)::int AS "maxDpd"
    FROM "Customer" c
    JOIN "Loan" l ON l."customerId" = c."id" AND l."status" = 'ACTIVE'
    WHERE ${where}
    GROUP BY c."id"
    HAVING ${having}`;
  const page = Math.max(1, opts.page);
  const [countRows, rows] = await Promise.all([
    db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS "total" FROM (${agg}) a`),
    db.$queryRaw<{ id: string; displayName: string; cif: string; branch: string; loans: number; totalOverdue: Prisma.Decimal; maxDpd: number }[]>(
      Prisma.sql`SELECT * FROM (${agg}) a ORDER BY ${Prisma.raw(`${SORT_SQL[sort]} ${dir}`)}, "id" ASC LIMIT ${opts.pageSize} OFFSET ${(page - 1) * opts.pageSize}`,
    ),
  ]);
  const withWork = await attachWork(db, rows.map((r) => ({ id: r.id, displayName: r.displayName, cif: r.cif, branch: r.branch, loans: r.loans, totalOverdue: Number(r.totalOverdue).toFixed(2), maxDpd: r.maxDpd })), opts.now);
  return { rows: withWork, total: countRows[0]?.total ?? 0, page, pageSize: opts.pageSize };
}

/** Everything the detail panel shows for one customer. Read-only: nothing is claimed, reserved or dialled. */
export async function customerOverview(db: Db, customerId: string, now: Date) {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      displayName: true,
      cif: true,
      branch: true,
      language: true,
      specialHandling: true,
      loans: { orderBy: [{ status: "asc" }, { dpd: "desc" }, { coreLoanId: "asc" }], select: { id: true, coreLoanId: true, status: true, product: true, dpd: true, totalOverdue: true, overduePrincipal: true, overdueInterest: true, principalOutstanding: true, nextDueDate: true, nextDueAmount: true, balancesAsOf: true } },
      promises: { where: { status: { in: [...OPEN_PROMISE, "BROKEN"] } }, orderBy: { deadline: "asc" }, select: { id: true, amount: true, paidAmount: true, remainingAmount: true, deadlineDate: true, status: true, coveredLoanIds: true } },
      interactions: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, startedAt: true, channel: true, technicalResult: true, identityStatus: true, businessOutcome: true, status: true, agent: { select: { displayName: true } } } },
      workItems: { where: { status: { in: [...OPEN_WORK_STATUSES] } }, select: { id: true, type: true, status: true, rank: true, priority: true, dueAt: true, createdAt: true, nextEligibleAt: true, deferredReasons: true, reason: true, owner: { select: { displayName: true } }, claimedBy: { select: { displayName: true } } } },
    },
  });
  if (!customer) return null;
  const decision = await db.decisionSnapshot.findFirst({ where: { customerId, isCurrent: true }, select: { actionBucket: true, era: true, rank: true } });
  const active = customer.loans.filter((l) => l.status === "ACTIVE");
  const coreId = new Map(customer.loans.map((l) => [l.id, l.coreLoanId]));
  const work = orderWork(customer.workItems, now);
  const last = customer.interactions[0] ?? null;
  return {
    customer: { id: customer.id, displayName: customer.displayName, cif: customer.cif, branch: customer.branch, language: customer.language, specialHandling: customer.specialHandling },
    summary: {
      loans: active.length,
      totalOverdue: active.reduce((s, l) => s.plus(l.totalOverdue), new Prisma.Decimal(0)).toFixed(2),
      maxDpd: active.reduce((m, l) => Math.max(m, l.dpd), 0),
      principalOutstanding: active.reduce((s, l) => s.plus(l.principalOutstanding), new Prisma.Decimal(0)).toFixed(2),
      balancesAsOf: active.reduce<Date | null>((m, l) => (!m || l.balancesAsOf < m ? l.balancesAsOf : m), null),
    },
    loans: customer.loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, status: l.status, product: l.product, dpd: l.dpd, totalOverdue: l.totalOverdue.toFixed(2), overduePrincipal: l.overduePrincipal.toFixed(2), overdueInterest: l.overdueInterest.toFixed(2), principalOutstanding: l.principalOutstanding.toFixed(2), nextDueDate: fromDbDate(l.nextDueDate), nextDueAmount: l.nextDueAmount?.toFixed(2) ?? null })),
    promises: customer.promises.map((p) => ({ id: p.id, amount: p.amount.toFixed(2), paid: p.paidAmount.toFixed(2), remaining: p.remainingAmount.toFixed(2), deadlineDate: fromDbDate(p.deadlineDate), status: p.status, loans: p.coveredLoanIds.map((id) => ({ id, coreLoanId: coreId.get(id) ?? id })) })),
    lastContact: last ? { at: last.startedAt, channel: last.channel, technicalResult: last.technicalResult, identityStatus: last.identityStatus, businessOutcome: last.businessOutcome, status: last.status, agentName: last.agent?.displayName ?? null } : null,
    work: work.map((w, i) => ({ id: w.id, type: w.type, status: w.status, code: workStatusCode(w, now), next: i === 0, dueAt: w.dueAt, nextEligibleAt: w.nextEligibleAt, reasons: w.deferredReasons, reason: w.reason, owner: w.owner?.displayName ?? w.claimedBy?.displayName ?? null })),
    decision: decision ? { bucket: decision.actionBucket, era: decision.era?.toFixed(2) ?? null, rank: decision.rank } : null,
  };
}

export type CustomerOverview = NonNullable<Awaited<ReturnType<typeof customerOverview>>>;
