import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import type { CustomerScope } from "@/server/auth/scope";
import { listCustomers, customerOverview } from "@/server/modules/customers/customerListService";
import { listWorkQueue, queueHeader } from "@/server/modules/work/queueService";
import { DEMO_SEED_INSTANT } from "@/server/clock";

/**
 * One customer = one row: a customer with two active loans (and a closed one, three open work items and a promise)
 * appears once with each active loan counted once; customers with the same name stay separate; totals and pagination
 * count distinct customers; scope is applied before aggregation; the work queue groups work items by customer before
 * paging; the detail overview is read-only.
 */
let prisma: PrismaClient;
const now = new Date(DEMO_SEED_INSTANT.getTime() + 2 * 3600_000);
const BRANCH = "TST-ROWS";
const SAME = "Eyni Ad Testov";
const all: CustomerScope = { kind: "ALL", branches: [], customerIds: [], historyDays: 14, evaluatedAt: now };
const branch: CustomerScope = { ...all, kind: "BRANCHES", branches: [BRANCH] };
let lead: SessionUser;

async function customer(id: string, name: string, loans: { id: string; overdue: string; dpd: number; status?: "ACTIVE" | "CLOSED" }[]) {
  await prisma.customer.create({ data: { id, cif: `CIF-${id}`, displayName: name, branch: BRANCH, sourceAsOf: now } });
  const c = await prisma.collectionCase.create({ data: { customerId: id, openedAt: now, maxDpd: Math.max(...loans.map((l) => l.dpd)) } });
  for (const l of loans) {
    await prisma.loan.create({
      data: { id: l.id, coreLoanId: `CORE-${l.id}`, customerId: id, originationDate: new Date("2026-01-10"), maturityDate: new Date("2027-01-10"), firstDueDate: new Date("2026-02-10"), principalOriginal: "5000.00", nominalAnnualRate: "0.180000", tenorMonths: 12, branch: BRANCH, principalOutstanding: "3000.00", totalOverdue: l.overdue, overduePrincipal: l.overdue, dpd: l.dpd, status: l.status ?? "ACTIVE", balancesAsOf: now },
    });
  }
  return c.id;
}

beforeAll(async () => {
  prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const u = await prisma.user.findUniqueOrThrow({ where: { username: "lead" }, include: { team: true } });
  lead = { id: u.id, username: u.username, displayName: u.displayName, role: u.role, teamId: u.teamId, teamName: u.team?.name ?? null, languages: u.languages, skills: u.skills, branchScopes: u.branchScopes, seniority: null, extension: null, providerAgentRef: null, mustChangePassword: false, sessionId: "test-lead", sessionExpiresAt: new Date(now.getTime() + 3600_000) };
  await customer("C-TST-SAME-1", SAME, [{ id: "L-TST-S1", overdue: "80.00", dpd: 9 }]);
  await customer("C-TST-SAME-2", SAME, [{ id: "L-TST-S2", overdue: "35.50", dpd: 4 }]);
  const caseId = await customer("C-TST-TWO", "İki Kreditli Müştəri", [
    { id: "L-TST-A", overdue: "100.10", dpd: 12 },
    { id: "L-TST-B", overdue: "50.25", dpd: 40 },
    { id: "L-TST-C", overdue: "999.00", dpd: 99, status: "CLOSED" },
  ]);
  await prisma.workItem.createMany({
    data: [
      { customerId: "C-TST-TWO", caseId, type: "CALL", status: "ELIGIBLE", rank: 1, priority: "9.00", campaignCode: "SOFT_COLLECTIONS_VOICE" },
      { customerId: "C-TST-TWO", caseId, type: "CALLBACK", status: "ELIGIBLE", rank: 50, priority: "1.00", dueAt: new Date(now.getTime() - 3600_000), reason: "CUSTOMER_REQUESTED: test" },
      { customerId: "C-TST-TWO", caseId, type: "PTP_FOLLOWUP", status: "ELIGIBLE", dueAt: now, reason: "Broken promise follow-up" },
    ],
  });
  await prisma.promise.create({ data: { customerId: "C-TST-TWO", caseId, amount: "120.00", remainingAmount: "120.00", deadlineDate: new Date("2026-11-05"), deadline: new Date("2026-11-05T19:59:59Z"), qualifyingWindowStart: now, qualifyingWindowEnd: new Date("2026-11-06T19:59:59Z"), coveredLoanIds: ["L-TST-A", "L-TST-B"], customerConfirmed: true, status: "ACTIVE" } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("customer list: one row per customer", () => {
  it("shows a customer with two active loans once, counting each active loan once (closed loan excluded)", async () => {
    const r = await listCustomers(prisma, { scope: all, q: "C-TST-TWO", page: 1, pageSize: 25, now });
    expect(r.total).toBe(1);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.id).toBe("C-TST-TWO");
    expect(row.loans).toBe(2);
    expect(row.totalOverdue).toBe("150.35"); // 100.10 + 50.25, not multiplied by 3 work items or the promise
    expect(row.maxDpd).toBe(40); // the closed loan's 99 DPD is not a relevant loan
    // Next work in workflow order: the due callback before the rank-1 call; all three items stay separate.
    expect(row.next?.type).toBe("CALLBACK");
    expect(row.next?.code).toBe("CALLBACK_DUE");
    expect(row.openWork).toBe(3);
    expect(row.promise?.status).toBe("ACTIVE");
  });

  it("keeps customers with the same name separate (grouped by customer id)", async () => {
    const r = await listCustomers(prisma, { scope: all, q: SAME, page: 1, pageSize: 25, now });
    expect(r.total).toBe(2);
    expect(r.rows.map((x) => x.id).sort()).toEqual(["C-TST-SAME-1", "C-TST-SAME-2"]);
    expect(r.rows.map((x) => x.totalOverdue).sort()).toEqual(["35.50", "80.00"]);
  });

  it("counts and pages distinct customers; pages neither overlap nor skip", async () => {
    const first = await listCustomers(prisma, { scope: branch, page: 1, pageSize: 1, now });
    expect(first.total).toBe(3);
    const seen: string[] = [];
    for (let p = 1; p <= 4; p++) seen.push(...(await listCustomers(prisma, { scope: branch, page: p, pageSize: 1, now })).rows.map((x) => x.id));
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    // Over the whole portfolio: one row per distinct customer with an active loan.
    const full = await listCustomers(prisma, { scope: all, filter: "active", page: 1, pageSize: 5000, now });
    const ids = full.rows.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const distinct = await prisma.loan.findMany({ where: { status: "ACTIVE" }, distinct: ["customerId"], select: { customerId: true } });
    expect(full.total).toBe(distinct.length);
    // The portfolio total equals the sum of active loans (no double counting anywhere).
    const sum = await prisma.loan.aggregate({ where: { status: "ACTIVE" }, _sum: { totalOverdue: true } });
    expect(full.rows.reduce((s, x) => s + Math.round(Number(x.totalOverdue) * 100), 0)).toBe(Math.round(Number(sum._sum.totalOverdue) * 100));
  });

  it("sorting follows the displayed values", async () => {
    const r = await listCustomers(prisma, { scope: branch, sort: "dpd", dir: "desc", page: 1, pageSize: 25, now });
    expect(r.rows.map((x) => x.maxDpd)).toEqual([40, 9, 4]);
    const byName = await listCustomers(prisma, { scope: branch, sort: "name", dir: "asc", page: 1, pageSize: 25, now });
    expect(byName.rows.map((x) => x.displayName)).toEqual([...byName.rows.map((x) => x.displayName)].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("applies the caller's scope before aggregation and paging", async () => {
    const scoped: CustomerScope = { ...all, kind: "CUSTOMERS", customerIds: ["C-TST-SAME-1"] };
    const r = await listCustomers(prisma, { scope: scoped, q: SAME, page: 1, pageSize: 25, now });
    expect(r.total).toBe(1);
    expect(r.rows.map((x) => x.id)).toEqual(["C-TST-SAME-1"]);
    const none = await listCustomers(prisma, { scope: { ...all, kind: "NONE" }, page: 1, pageSize: 25, now });
    expect(none.total).toBe(0);
  });
});

describe("work queue: work items grouped by customer before paging", () => {
  it("lists a customer with a call and a callback once, with distinct-customer totals and stable pages", async () => {
    const q = await listWorkQueue(prisma, lead, { queue: "all", page: 1, pageSize: 1000 }, all, now);
    const ids = q.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "C-TST-TWO")).toHaveLength(1);
    const voice = await prisma.workItem.findMany({ where: { type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } }, distinct: ["customerId"], select: { customerId: true } });
    expect(q.total).toBe(voice.length);
    const two = q.rows.find((r) => r.id === "C-TST-TWO")!;
    expect(two.next?.type).toBe("CALLBACK");
    expect(two.loans).toBe(2);
    expect(two.totalOverdue).toBe("150.35");
    // Paging through the grouped queue returns every customer exactly once.
    const paged: string[] = [];
    for (let p = 1; p <= Math.ceil(q.total / 7); p++) paged.push(...(await listWorkQueue(prisma, lead, { queue: "all", page: p, pageSize: 7 }, all, now)).rows.map((r) => r.id));
    expect(paged).toHaveLength(q.total);
    expect(new Set(paged).size).toBe(q.total);
    // The seeded customer with both a call and a callback is also listed once in the blocked view.
    const blocked = await listWorkQueue(prisma, lead, { queue: "blocked", page: 1, pageSize: 1000 }, all, now);
    const blockedIds = blocked.rows.map((r) => r.id);
    expect(new Set(blockedIds).size).toBe(blockedIds.length);
    // Header counts distinct customers, never more than the work items behind them.
    const header = await queueHeader(prisma, lead, all, now);
    expect(header.assigned).toBe(q.total);
  });
});

describe("detail overview", () => {
  it("lists every loan, open promises with their loans and the open work in workflow order without changing anything", async () => {
    const before = await prisma.workItem.findMany({ where: { customerId: "C-TST-TWO" }, select: { id: true, status: true, claimedByUserId: true, version: true }, orderBy: { id: "asc" } });
    const o = (await customerOverview(prisma, "C-TST-TWO", now))!;
    expect(o.summary.loans).toBe(2);
    expect(o.summary.totalOverdue).toBe("150.35");
    expect(o.loans.map((l) => l.coreLoanId).sort()).toEqual(["CORE-L-TST-A", "CORE-L-TST-B", "CORE-L-TST-C"]);
    expect(o.promises[0].loans.map((l) => l.coreLoanId).sort()).toEqual(["CORE-L-TST-A", "CORE-L-TST-B"]);
    expect(o.work.map((w) => w.type)).toEqual(["CALLBACK", "CALL", "PTP_FOLLOWUP"]);
    expect(o.work.filter((w) => w.next)).toHaveLength(1);
    const after = await prisma.workItem.findMany({ where: { customerId: "C-TST-TWO" }, select: { id: true, status: true, claimedByUserId: true, version: true }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
    expect(await prisma.routingReservation.count({ where: { customerId: "C-TST-TWO" } })).toBe(0);
  });
});
