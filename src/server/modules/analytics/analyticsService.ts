import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { dec, money, Decimal } from "@/server/money";
import { BAKU_ZONE, fromDbDate } from "@/server/dates";
import { SEGMENT_LABELS } from "@/server/modules/decisions/segments";
import { ACTION_LABELS, type ActionCode } from "@/server/modules/decisions/treatment";
import { getSetting } from "@/server/modules/settings/settingsService";
import type { DecisionSegment } from "@/generated/prisma/enums";

/**
 * Portfolio and collection analytics (S18). Every ratio carries numerator, denominator, scope, maturation
 * window and data freshness. Counts and exposure are shown separately. Unadjusted comparisons are never
 * labelled as treatment uplift.
 */
export const ANALYTICS_TABS = [
  { key: "dpd", label: "DPD distribution" },
  { key: "roll", label: "Roll / cure" },
  { key: "cohorts", label: "Entry cohorts" },
  { key: "cash", label: "Cash collected" },
  { key: "ptp", label: "Promises" },
  { key: "contacts", label: "RPC / contact outcomes" },
  { key: "cost", label: "Cost" },
  { key: "buckets", label: "Action buckets" },
  { key: "classes", label: "Model classes" },
  { key: "strategies", label: "Strategies" },
  { key: "agents", label: "Agent / team" },
  { key: "vintage", label: "Vintage" },
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];

export interface AnalyticsFilters { from?: string; to?: string; branch?: string; segment?: string; riskClass?: number; bucket?: number; owner?: string; strategyVersionId?: string; arm?: string }

export interface RatioDef { code: string; name: string; numerator: string; denominator: string; scope: string; unit: string; version: string; maturation?: string }
export interface TabResult {
  tab: AnalyticsTab;
  asOf: string;
  freshness: { source: string; asOf: string | null; health: string }[];
  columns: { key: string; label: string; kind?: "count" | "money" | "ratio" | "text" | "link" }[];
  rows: Record<string, string | number | null>[];
  ratios: RatioDef[];
  notes: string[];
  drill: { label: string; href: string }[];
}

const f2 = (d: Decimal.Value) => money(dec(d)).toFixed(2);
const ratio = (n: number, d: number) => (d > 0 ? (n / d).toFixed(3) : null);

async function freshness(db: Db) {
  const w = await db.sourceWatermark.findMany({ select: { sourceSystem: true, sourceAsOf: true, health: true } });
  return w.map((x) => ({ source: x.sourceSystem, asOf: x.sourceAsOf?.toISOString() ?? null, health: x.health }));
}

async function metricDefs(db: Db, codes: string[]): Promise<RatioDef[]> {
  const defs = await db.metricDefinition.findMany({ where: { code: { in: codes } } });
  return codes.map((c) => { const d = defs.find((x) => x.code === c); return d ? { code: d.code, name: d.name, numerator: d.numerator, denominator: d.denominator, scope: d.scope, unit: d.unit, version: d.version } : { code: c, name: c, numerator: "—", denominator: "—", scope: "—", unit: "—", version: "n/a" }; });
}

function window(filters: AnalyticsFilters, now: Date) {
  const to = filters.to ? DateTime.fromISO(filters.to, { zone: BAKU_ZONE }).endOf("day") : DateTime.fromJSDate(now, { zone: BAKU_ZONE }).endOf("day");
  const from = filters.from ? DateTime.fromISO(filters.from, { zone: BAKU_ZONE }).startOf("day") : to.minus({ days: 30 }).startOf("day");
  return { from: from.toJSDate(), to: to.toJSDate(), label: `${from.toISODate()} → ${to.toISODate()}` };
}

function snapshotWhere(filters: AnalyticsFilters) {
  return {
    isCurrent: true,
    ...(filters.segment ? { segment: filters.segment as DecisionSegment } : {}),
    ...(filters.riskClass ? { riskClass: filters.riskClass } : {}),
    ...(filters.bucket ? { actionBucket: filters.bucket } : {}),
    ...(filters.strategyVersionId ? { strategyVersionId: filters.strategyVersionId } : {}),
    ...(filters.branch ? { customer: { branch: filters.branch } } : {}),
    ...(filters.owner ? { case: { ownerUserId: filters.owner } } : {}),
    ...(filters.arm ? { customer: { experimentAssignments: { some: { arm: filters.arm } } } } : {}),
  };
}

export async function analyticsTab(db: Db, tab: AnalyticsTab, filters: AnalyticsFilters, now: Date): Promise<TabResult> {
  const asOf = now.toISOString();
  const fresh = await freshness(db);
  const w = window(filters, now);
  const base = { tab, asOf, freshness: fresh, drill: [] as { label: string; href: string }[] };

  switch (tab) {
    case "dpd": {
      const snaps = await db.decisionSnapshot.findMany({ where: snapshotWhere(filters), select: { segment: true, exposure: true, totalOverdue: true, customerId: true } });
      const bySeg = new Map<string, { customers: number; exposure: Decimal; overdue: Decimal }>();
      for (const s of snaps) { const e = bySeg.get(s.segment) ?? { customers: 0, exposure: dec(0), overdue: dec(0) }; e.customers++; e.exposure = e.exposure.plus(s.exposure.toString()); e.overdue = e.overdue.plus(s.totalOverdue.toString()); bySeg.set(s.segment, e); }
      const current = await db.loan.count({ where: { status: "ACTIVE", dpd: 0, ...(filters.branch ? { branch: filters.branch } : {}) } });
      const total = snaps.length;
      const rows = Object.keys(SEGMENT_LABELS).filter((k) => bySeg.has(k)).map((k) => { const e = bySeg.get(k)!; return { segment: SEGMENT_LABELS[k as DecisionSegment], customers: e.customers, shareOfCustomers: ratio(e.customers, total), exposure: f2(e.exposure), totalOverdue: f2(e.overdue), drill: `/customers?segment=${k}` }; });
      return { ...base, columns: [{ key: "segment", label: "DPD segment" }, { key: "customers", label: "Customers (open cases)", kind: "count" }, { key: "shareOfCustomers", label: "Share", kind: "ratio" }, { key: "exposure", label: "Exposure AZN", kind: "money" }, { key: "totalOverdue", label: "Overdue AZN", kind: "money" }, { key: "drill", label: "Drill", kind: "link" }], rows, ratios: [], notes: [`Open-case customers in the current daily snapshot; ${current} active loans are current (DPD 0) and outside the collections population.`, "Counts are customers (one case per customer); exposure uses the demo exposure definition."], drill: [{ label: "Work queue", href: "/work-queue" }] };
    }
    case "roll": {
      const runs = await db.decisionRun.findMany({ where: { status: "COMPLETED" }, orderBy: { startedAt: "asc" }, select: { id: true, businessDate: true } });
      const notes: string[] = [];
      const rows: Record<string, string | number | null>[] = [];
      if (runs.length >= 2) {
        const first = runs[0], last = runs[runs.length - 1];
        const a = await db.decisionSnapshot.findMany({ where: { runId: first.id }, select: { customerId: true, segment: true } });
        const b = await db.decisionSnapshot.findMany({ where: { runId: last.id }, select: { customerId: true, segment: true } });
        const bMap = new Map(b.map((x) => [x.customerId, x.segment]));
        const matrix = new Map<string, Map<string, number>>();
        for (const x of a) { const to = bMap.get(x.customerId) ?? "CURED_OR_CLOSED"; const m = matrix.get(x.segment) ?? new Map(); m.set(to, (m.get(to) ?? 0) + 1); matrix.set(x.segment, m); }
        for (const [from, m] of matrix) for (const [to, n] of m) rows.push({ from: SEGMENT_LABELS[from as DecisionSegment] ?? from, to: to === "CURED_OR_CLOSED" ? "Cured / closed" : SEGMENT_LABELS[to as DecisionSegment] ?? to, customers: n, share: ratio(n, a.filter((x) => x.segment === from).length) });
        notes.push(`Transition between runs ${fromDbDate(first.businessDate)} and ${fromDbDate(last.businessDate)} (${runs.length} runs).`);
      } else notes.push("Insufficient matured observations: roll/cure matrices need at least two daily snapshots. Shown as unavailable rather than estimated.");
      const cured = await db.collectionCase.count({ where: { status: "CURED", closedAt: { gte: w.from, lte: w.to } } });
      const opened = await db.collectionCase.count({ where: { openedAt: { gte: w.from, lte: w.to } } });
      rows.push({ from: "Cases opened in window", to: "Cured in window", customers: cured, share: ratio(cured, opened) });
      return { ...base, columns: [{ key: "from", label: "From" }, { key: "to", label: "To" }, { key: "customers", label: "Customers", kind: "count" }, { key: "share", label: "Share of origin", kind: "ratio" }], rows, ratios: await metricDefs(db, ["CURE", "ROLL_FORWARD"]), notes: [...notes, `Window ${w.label}. Cure = zero overdue confirmed by verified core postings; partial payments never cure.`], drill: [{ label: "Customers", href: "/customers" }] };
    }
    case "cohorts": {
      const cases = await db.collectionCase.findMany({ where: { openedAt: { gte: w.from, lte: w.to }, ...(filters.owner ? { ownerUserId: filters.owner } : {}), ...(filters.branch ? { customer: { branch: filters.branch } } : {}) }, select: { openedAt: true, status: true, entryExposure: true, modelExposure: true, entryDpd: true } });
      const byWeek = new Map<string, { entered: number; exposure: Decimal; cured: number; open: number; handover: number; avgEntryDpd: number[] }>();
      for (const c of cases) { const k = DateTime.fromJSDate(c.openedAt, { zone: BAKU_ZONE }).startOf("week").toISODate()!; const e = byWeek.get(k) ?? { entered: 0, exposure: dec(0), cured: 0, open: 0, handover: 0, avgEntryDpd: [] }; e.entered++; e.exposure = e.exposure.plus((c.entryExposure ?? c.modelExposure).toString()); if (c.status === "CURED") e.cured++; if (c.status === "OPEN") e.open++; if (c.status === "HANDOVER") e.handover++; if (c.entryDpd !== null) e.avgEntryDpd.push(c.entryDpd); byWeek.set(k, e); }
      const rows = [...byWeek.entries()].sort().map(([week, e]) => ({ entryWeek: week, entered: e.entered, entryExposure: f2(e.exposure), avgEntryDpd: e.avgEntryDpd.length ? (e.avgEntryDpd.reduce((a, b) => a + b, 0) / e.avgEntryDpd.length).toFixed(1) : null, cured: e.cured, cureRate: ratio(e.cured, e.entered), stillOpen: e.open, handover: e.handover }));
      return { ...base, columns: [{ key: "entryWeek", label: "Entry week (Mon)" }, { key: "entered", label: "Entered", kind: "count" }, { key: "entryExposure", label: "Entry exposure AZN", kind: "money" }, { key: "avgEntryDpd", label: "Avg entry DPD" }, { key: "cured", label: "Cured", kind: "count" }, { key: "cureRate", label: "Cure rate", kind: "ratio" }, { key: "stillOpen", label: "Open", kind: "count" }, { key: "handover", label: "Handover", kind: "count" }], rows, ratios: await metricDefs(db, ["CURE"]), notes: [`Fixed entry cohorts by case open date, window ${w.label}. Cure rates of recent cohorts are immature (maturation 30 days) and will change.`], drill: [] };
    }
    case "cash": {
      const payments = await db.payment.findMany({ where: { status: { in: ["POSTED", "REVERSED"] }, valueDate: { gte: w.from, lte: w.to }, reversalOfId: null, ...(filters.branch ? { loan: { branch: filters.branch } } : {}) }, select: { valueDate: true, amount: true, status: true, promiseLinks: { select: { amount: true, reversed: true } }, reversedBy: { select: { amount: true } } } });
      const byDay = new Map<string, { posted: Decimal; reversed: Decimal; count: number; promiseAttributed: Decimal }>();
      for (const p of payments) { const k = fromDbDate(p.valueDate)!; const e = byDay.get(k) ?? { posted: dec(0), reversed: dec(0), count: 0, promiseAttributed: dec(0) }; e.posted = e.posted.plus(p.amount.toString()); e.count++; if (p.reversedBy) e.reversed = e.reversed.plus(p.reversedBy.amount.toString()); for (const l of p.promiseLinks) if (!l.reversed) e.promiseAttributed = e.promiseAttributed.plus(l.amount.toString()); byDay.set(k, e); }
      const rows = [...byDay.entries()].sort().map(([day, e]) => ({ valueDate: day, payments: e.count, posted: f2(e.posted), reversed: f2(e.reversed), net: f2(e.posted.minus(e.reversed)), promiseAttributed: f2(e.promiseAttributed), drill: `/payments?tab=posted` }));
      const quarantined = await db.payment.count({ where: { status: { in: ["QUARANTINED", "UNMATCHED"] } } });
      return { ...base, columns: [{ key: "valueDate", label: "Value date" }, { key: "payments", label: "Postings", kind: "count" }, { key: "posted", label: "Posted AZN", kind: "money" }, { key: "reversed", label: "Reversed AZN", kind: "money" }, { key: "net", label: "Net AZN", kind: "money" }, { key: "promiseAttributed", label: "PTP-attributed AZN", kind: "money" }, { key: "drill", label: "Drill", kind: "link" }], rows, ratios: await metricDefs(db, ["CASH_RECEIVED"]), notes: [`Verified core postings by value date, window ${w.label}; ${quarantined} quarantined/unmatched payments are excluded until reconciled.`], drill: [{ label: "Payments", href: "/payments" }] };
    }
    case "ptp": {
      const promises = await db.promise.findMany({ where: { createdAt: { gte: w.from, lte: w.to }, ...(filters.owner ? { ownerUserId: filters.owner } : {}) }, select: { status: true, amount: true, paidAmount: true, deadline: true, qualifyingWindowEnd: true } });
      const byStatus = new Map<string, { n: number; amount: Decimal; paid: Decimal }>();
      for (const p of promises) { const e = byStatus.get(p.status) ?? { n: 0, amount: dec(0), paid: dec(0) }; e.n++; e.amount = e.amount.plus(p.amount.toString()); e.paid = e.paid.plus(p.paidAmount.toString()); byStatus.set(p.status, e); }
      const matured = promises.filter((p) => p.qualifyingWindowEnd <= now && p.status !== "CANCELLED" && p.status !== "PENDING_RECONCILIATION");
      const kept = matured.filter((p) => p.status === "KEPT").length;
      const rows = [...byStatus.entries()].map(([status, e]) => ({ status, promises: e.n, promised: f2(e.amount), paid: f2(e.paid), drill: `/promises?status=${status}` }));
      rows.push({ status: "Kept rate (matured only)", promises: matured.length, promised: ratio(kept, matured.length) ?? "n/a", paid: `${kept} kept`, drill: "/promises" });
      return { ...base, columns: [{ key: "status", label: "Status" }, { key: "promises", label: "Promises", kind: "count" }, { key: "promised", label: "Promised AZN / rate", kind: "text" }, { key: "paid", label: "Paid AZN", kind: "text" }, { key: "drill", label: "Drill", kind: "link" }], rows, ratios: await metricDefs(db, ["PTP_CONVERSION", "KEPT_PTP_RATE"]), notes: [`Promises created in ${w.label}. Kept rate excludes not-yet-matured promises (qualifying window still open) and shows pending reconciliation separately.`], drill: [{ label: "Promises", href: "/promises" }] };
    }
    case "contacts": {
      const where = { startedAt: { gte: w.from, lte: w.to }, ...(filters.owner ? { agentUserId: filters.owner } : {}) };
      const [attempts, interactions] = await Promise.all([
        db.dialAttempt.findMany({ where: { startedAt: { gte: w.from, lte: w.to } }, select: { technicalResult: true, reservation: { select: { customerId: true } } } }),
        db.interaction.findMany({ where, select: { channel: true, identityStatus: true, businessOutcome: true, isRpc: true, customerId: true, status: true } }),
      ]);
      const rows: Record<string, string | number | null>[] = [];
      const byTech = new Map<string, number>(); for (const a of attempts) byTech.set(a.technicalResult, (byTech.get(a.technicalResult) ?? 0) + 1);
      for (const [k, n] of byTech) rows.push({ group: "Technical result", value: k, count: n, share: ratio(n, attempts.length) });
      const byId = new Map<string, number>(); for (const i of interactions) if (i.identityStatus) byId.set(i.identityStatus, (byId.get(i.identityStatus) ?? 0) + 1);
      for (const [k, n] of byId) rows.push({ group: "Identity", value: k, count: n, share: ratio(n, interactions.length) });
      const byOut = new Map<string, number>(); for (const i of interactions) if (i.businessOutcome) byOut.set(i.businessOutcome, (byOut.get(i.businessOutcome) ?? 0) + 1);
      for (const [k, n] of byOut) rows.push({ group: "Business outcome", value: k, count: n, share: ratio(n, interactions.filter((i) => i.businessOutcome).length) });
      const distinctAttempted = new Set(attempts.map((a) => a.reservation.customerId)).size;
      const rpcCustomers = new Set(interactions.filter((i) => i.isRpc).map((i) => i.customerId)).size;
      rows.push({ group: "Ratio", value: "RPC rate (attempt-based)", count: interactions.filter((i) => i.isRpc).length, share: ratio(interactions.filter((i) => i.isRpc).length, attempts.length) });
      rows.push({ group: "Ratio", value: "RPC rate (distinct customers)", count: rpcCustomers, share: ratio(rpcCustomers, distinctAttempted) });
      return { ...base, columns: [{ key: "group", label: "Group" }, { key: "value", label: "Value" }, { key: "count", label: "Count", kind: "count" }, { key: "share", label: "Share / rate", kind: "ratio" }], rows, ratios: await metricDefs(db, ["ATTEMPTS", "DISTINCT_CUSTOMERS_ATTEMPTED", "RPC_RATE_ATTEMPT", "RPC_RATE_CUSTOMER"]), notes: [`${attempts.length} attempts on ${distinctAttempted} distinct customers in ${w.label}; provider callbacks are deduplicated per attempt.`], drill: [{ label: "Interactions (customers)", href: "/customers" }] };
    }
    case "cost": {
      const unit = (await getSetting<{ sms: { cost: string }; agent: { cost: string } }>("economics.unitCosts", db)) ?? { sms: { cost: "0.031" }, agent: { cost: "1.75" } };
      const sms = await db.outboundMessage.groupBy({ by: ["status"], _count: { _all: true }, where: { requestedAt: { gte: w.from, lte: w.to } } });
      const voice = await db.interaction.findMany({ where: { channel: "VOICE_OUTBOUND", startedAt: { gte: w.from, lte: w.to } }, select: { customerId: true, agentUserId: true, startedAt: true } });
      const customerDays = new Set(voice.map((v) => `${v.customerId}|${DateTime.fromJSDate(v.startedAt, { zone: BAKU_ZONE }).toISODate()}`)).size;
      const smsTotal = sms.reduce((a, s) => a + s._count._all, 0);
      const rows = [
        ...sms.map((s) => ({ item: `SMS · ${s.status}`, units: s._count._all, unitCost: unit.sms.cost, cost: f2(dec(unit.sms.cost).times(s._count._all)), basis: "per SMS (segment count assumed 1)" })),
        { item: "SMS total", units: smsTotal, unitCost: unit.sms.cost, cost: f2(dec(unit.sms.cost).times(smsTotal)), basis: "local outbound log" },
        { item: "Agent customer-days", units: customerDays, unitCost: unit.agent.cost, cost: f2(dec(unit.agent.cost).times(customerDays)), basis: "distinct customer × day with a voice interaction" },
      ];
      return { ...base, columns: [{ key: "item", label: "Item" }, { key: "units", label: "Units", kind: "count" }, { key: "unitCost", label: "Unit cost AZN", kind: "money" }, { key: "cost", label: "Cost AZN", kind: "money" }, { key: "basis", label: "Basis" }], rows, ratios: await metricDefs(db, ["COST"]), notes: [`Window ${w.label}. Unit costs are dated settings (see S14/S24); costs are scenario figures, not accounting actuals.`], drill: [{ label: "Economics", href: "/strategy/economics" }] };
    }
    case "buckets": {
      const snaps = await db.decisionSnapshot.findMany({ where: snapshotWhere(filters), select: { actionBucket: true, era: true, exposure: true, effectiveAction: true } });
      const by = new Map<string, { n: number; exposure: Decimal; era: Decimal; min: Decimal | null; max: Decimal | null; actions: Map<string, number> }>();
      for (const s of snaps) { const k = s.actionBucket ? String(s.actionBucket) : "Unscored"; const e = by.get(k) ?? { n: 0, exposure: dec(0), era: dec(0), min: null, max: null, actions: new Map() }; e.n++; e.exposure = e.exposure.plus(s.exposure.toString()); if (s.era) { const v = dec(s.era.toString()); e.era = e.era.plus(v); e.min = e.min === null || v.lessThan(e.min) ? v : e.min; e.max = e.max === null || v.greaterThan(e.max) ? v : e.max; } e.actions.set(s.effectiveAction, (e.actions.get(s.effectiveAction) ?? 0) + 1); by.set(k, e); }
      const rows = [...by.entries()].sort((a, b) => (a[0] === "Unscored" ? 99 : Number(a[0])) - (b[0] === "Unscored" ? 99 : Number(b[0]))).map(([bucket, e]) => ({ bucket, customers: e.n, exposure: f2(e.exposure), eraTotal: f2(e.era), eraMin: e.min ? f2(e.min) : null, eraMax: e.max ? f2(e.max) : null, effectiveAction: [...e.actions.entries()].map(([a, n]) => `${ACTION_LABELS[a as ActionCode] ?? a} (${n})`).join("; "), drill: bucket === "Unscored" ? "/work-queue?type=MANUAL_REVIEW" : `/work-queue?bucket=${bucket}` }));
      return { ...base, columns: [{ key: "bucket", label: "Action bucket" }, { key: "customers", label: "Customers", kind: "count" }, { key: "exposure", label: "Exposure AZN", kind: "money" }, { key: "eraTotal", label: "ERA total AZN", kind: "money" }, { key: "eraMin", label: "ERA min", kind: "money" }, { key: "eraMax", label: "ERA max", kind: "money" }, { key: "effectiveAction", label: "Effective action" }, { key: "drill", label: "Drill", kind: "link" }], rows, ratios: [], notes: ["Deciles are computed once per daily snapshot; identical ERA values share a bucket (ties to the lower bucket). ERA ranks risk and is not expected recovery."], drill: [] };
    }
    case "classes": {
      const snaps = await db.decisionSnapshot.findMany({ where: snapshotWhere(filters), select: { riskClass: true, probability: true, probabilitySource: true, exposure: true, era: true, reasonCodes: true, segment: true } });
      const by = new Map<string, { n: number; exposure: Decimal; era: Decimal; p: string | null }>();
      const unscored = new Map<string, number>();
      for (const s of snaps) {
        const k = s.riskClass ? `Class ${s.riskClass}` : s.probability ? `${s.probabilitySource}` : "Unscored";
        const e = by.get(k) ?? { n: 0, exposure: dec(0), era: dec(0), p: s.probability?.toString() ?? null }; e.n++; e.exposure = e.exposure.plus(s.exposure.toString()); e.era = e.era.plus((s.era ?? 0).toString()); by.set(k, e);
        if (!s.probability) for (const r of s.reasonCodes.filter((c) => !c.startsWith("BUCKET") && c !== "UNSCORED_MANUAL_REVIEW")) unscored.set(r, (unscored.get(r) ?? 0) + 1);
      }
      const rows = [...by.entries()].sort().map(([k, e]) => ({ class: k, customers: e.n, probability: e.p ?? (k === "Unscored" ? "—" : "band"), exposure: f2(e.exposure), eraTotal: f2(e.era) }));
      for (const [r, n] of unscored) rows.push({ class: `Unscored reason · ${r}`, customers: n, probability: "—", exposure: "—", eraTotal: "—" });
      return { ...base, columns: [{ key: "class", label: "Model class / source" }, { key: "customers", label: "Customers", kind: "count" }, { key: "probability", label: "p(roll)" }, { key: "exposure", label: "Exposure AZN", kind: "money" }, { key: "eraTotal", label: "ERA total AZN", kind: "money" }], rows, ratios: [], notes: ["Classes 1–8 are the Prometeia draft tree (DPD 4–10). Other sources: DEMO-only 1–3 rule and draft band roll rates 11–30. Observed-versus-assigned comparisons belong to S19 and need matured monthly targets."], drill: [{ label: "Model", href: "/models/prometeia" }] };
    }
    case "strategies": {
      const snaps = await db.decisionSnapshot.findMany({ where: snapshotWhere(filters), select: { strategyVersionId: true, effectiveAction: true, exposure: true, strategyVersion: { select: { code: true, version: true, status: true } } } });
      const by = new Map<string, { label: string; n: number; exposure: Decimal; actions: Map<string, number> }>();
      for (const s of snaps) { const k = s.strategyVersionId ?? "none"; const e = by.get(k) ?? { label: s.strategyVersion ? `${s.strategyVersion.code} ${s.strategyVersion.version} (${s.strategyVersion.status.toLowerCase()})` : "No strategy", n: 0, exposure: dec(0), actions: new Map() }; e.n++; e.exposure = e.exposure.plus(s.exposure.toString()); e.actions.set(s.effectiveAction, (e.actions.get(s.effectiveAction) ?? 0) + 1); by.set(k, e); }
      const rows: Record<string, string | number | null>[] = [];
      for (const [id, e] of by) for (const [a, n] of e.actions) rows.push({ strategy: e.label, treatment: ACTION_LABELS[a as ActionCode] ?? a, customers: n, share: ratio(n, e.n), drill: `/strategies?v=${id}` });
      const arms = await db.experimentAssignment.groupBy({ by: ["experiment", "arm"], _count: { _all: true } });
      for (const a of arms) rows.push({ strategy: `Experiment ${a.experiment}`, treatment: `arm ${a.arm}`, customers: a._count._all, share: null, drill: `/analytics?tab=strategies&arm=${a.arm}` });
      return { ...base, columns: [{ key: "strategy", label: "Strategy version" }, { key: "treatment", label: "Treatment" }, { key: "customers", label: "Customers", kind: "count" }, { key: "share", label: "Share", kind: "ratio" }, { key: "drill", label: "Drill", kind: "link" }], rows, ratios: [], notes: ["Differences between strategies or experiment arms are unadjusted comparisons, not treatment uplift."], drill: [] };
    }
    case "agents": {
      const agents = await db.user.findMany({ where: { role: { in: ["AGENT", "SENIOR_AGENT"] }, isActive: true }, select: { id: true, displayName: true, role: true, team: { select: { name: true } } } });
      const rows: Record<string, string | number | null>[] = [];
      for (const a of agents) {
        const [attempts, rpc, ptp, backlog] = await Promise.all([
          db.dialAttempt.count({ where: { startedAt: { gte: w.from, lte: w.to }, reservation: { agentUserId: a.id } } }),
          db.interaction.findMany({ where: { agentUserId: a.id, startedAt: { gte: w.from, lte: w.to } }, select: { isRpc: true, customerId: true } }),
          db.promise.count({ where: { createdByUserId: a.id, createdAt: { gte: w.from, lte: w.to } } }),
          db.workItem.count({ where: { ownerUserId: a.id, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } }),
        ]);
        const cash = await db.promisePaymentLink.findMany({ where: { reversed: false, promise: { createdByUserId: a.id }, createdAt: { gte: w.from, lte: w.to } }, select: { amount: true } });
        const rpcN = rpc.filter((r) => r.isRpc).length;
        rows.push({ agent: a.displayName, role: a.role, team: a.team?.name ?? "—", attempts, distinctCustomers: new Set(rpc.map((r) => r.customerId)).size, rpc: rpcN, rpcRate: ratio(rpcN, attempts), ptp: ptp, ptpConversion: ratio(ptp, rpcN), attributedCash: f2(cash.reduce((s, c) => s.plus(c.amount.toString()), dec(0))), backlog });
      }
      return { ...base, columns: [{ key: "agent", label: "Agent" }, { key: "role", label: "Role" }, { key: "team", label: "Team" }, { key: "attempts", label: "Attempts", kind: "count" }, { key: "distinctCustomers", label: "Distinct customers", kind: "count" }, { key: "rpc", label: "RPC", kind: "count" }, { key: "rpcRate", label: "RPC rate", kind: "ratio" }, { key: "ptp", label: "PTP", kind: "count" }, { key: "ptpConversion", label: "PTP conversion", kind: "ratio" }, { key: "attributedCash", label: "Attributed cash AZN", kind: "money" }, { key: "backlog", label: "Backlog", kind: "count" }], rows, ratios: await metricDefs(db, ["RPC_RATE_ATTEMPT", "PTP_CONVERSION", "AGENT_ATTRIBUTED_CASH"]), notes: [`Window ${w.label}. Attributed cash counts each verified payment once (promise attribution); duplicate attempts are not rewarded. Compare with case mix and exposure (S17) before judging productivity.`], drill: [{ label: "Operations", href: "/operations" }] };
    }
    case "vintage": {
      const loans = await db.loan.findMany({ where: { ...(filters.branch ? { branch: filters.branch } : {}) }, select: { originationDate: true, principalOriginal: true, principalOutstanding: true, dpd: true, status: true } });
      const by = new Map<string, { n: number; original: Decimal; outstanding: Decimal; arrears: number; dpdSum: number; paidOff: number }>();
      for (const l of loans) { const k = fromDbDate(l.originationDate)!.slice(0, 7); const e = by.get(k) ?? { n: 0, original: dec(0), outstanding: dec(0), arrears: 0, dpdSum: 0, paidOff: 0 }; e.n++; e.original = e.original.plus(l.principalOriginal.toString()); e.outstanding = e.outstanding.plus(l.principalOutstanding.toString()); if (l.dpd > 0) e.arrears++; e.dpdSum += l.dpd; if (l.status === "PAID_OFF") e.paidOff++; by.set(k, e); }
      const rows = [...by.entries()].sort().map(([month, e]) => ({ vintage: month, loans: e.n, principalOriginal: f2(e.original), principalOutstanding: f2(e.outstanding), inArrears: e.arrears, arrearsShare: ratio(e.arrears, e.n), avgDpd: (e.dpdSum / e.n).toFixed(1), paidOff: e.paidOff }));
      return { ...base, columns: [{ key: "vintage", label: "Origination month" }, { key: "loans", label: "Loans", kind: "count" }, { key: "principalOriginal", label: "Original principal AZN", kind: "money" }, { key: "principalOutstanding", label: "Outstanding AZN", kind: "money" }, { key: "inArrears", label: "In arrears", kind: "count" }, { key: "arrearsShare", label: "Arrears share", kind: "ratio" }, { key: "avgDpd", label: "Avg DPD" }, { key: "paidOff", label: "Paid off", kind: "count" }], rows, ratios: [], notes: ["Vintage view of the synthetic portfolio by origination month; arrears share is a point-in-time count ratio, not a cumulative default rate."], drill: [] };
    }
  }
}

/** CSV with spreadsheet formula-injection guard and an as-of/definition header. */
export function toCsv(result: TabResult): string {
  const guard = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [
    `# ATB Collections analytics export · tab=${result.tab} · asOf=${result.asOf} · definitions=${result.ratios.map((r) => `${r.code}@${r.version}`).join(";") || "n/a"}`,
    result.columns.map((c) => guard(c.label)).join(","),
    ...result.rows.map((r) => result.columns.map((c) => guard(r[c.key] ?? null)).join(",")),
  ];
  return lines.join("\n") + "\n";
}
