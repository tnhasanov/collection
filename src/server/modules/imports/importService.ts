import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import { dec, money, toDbMoney } from "@/server/money";
import { addMonthsClamped, bakuBusinessDate, isIsoDate, toDbDate, type IsoDate } from "@/server/dates";
import { buildAnnuitySchedule } from "@/server/modules/finance/annuity";
import { recomputeLoanState } from "@/server/modules/finance/loanState";
import { syncCustomerCase } from "@/server/modules/cases/caseService";
import { ingestIntegrationEvent } from "@/server/modules/payments/paymentService";
import { appendAudit } from "@/server/modules/audit/audit";
import { badRequest, conflict, notFound, unprocessable } from "@/server/errors";
import { parseCsv } from "@/server/modules/imports/csv";
import { DATASETS, datasetSpec, proposeMapping, type ColumnSpec, type DatasetSpec } from "@/server/modules/imports/datasets";

/**
 * Import pipeline (S20): upload → map → validate → dry-run → commit → results, with rollback where the
 * dataset supports it. Batch ids and (dataset, checksum) duplicate protection are mandatory; invalid
 * critical financial rows are quarantined and never enter the active projection. Imported history is kept.
 */
export interface ValidatedRow { rowNumber: number; data: Record<string, string | number | null>; key: string }
export interface RejectedRow { rowNumber: number; code: string; message: string; data: Record<string, string> }
interface Payload { mapping: Record<string, string | null>; accepted: ValidatedRow[]; rejected: RejectedRow[]; warnings: { rowNumber: number; code: string; message: string }[]; dryRun?: unknown; commit?: Record<string, unknown> }

const IMPORT_SOURCE = "CORE_IMPORT";

function parseValue(col: ColumnSpec, raw: string | undefined): { value: string | number | null; error?: string } {
  const v = (raw ?? "").trim();
  if (v === "") return col.required ? { value: null, error: `${col.name} is required` } : { value: null };
  switch (col.type) {
    case "string": return col.pattern && !col.pattern.test(v) ? { value: null, error: `${col.name} contains unsupported characters` } : { value: v.slice(0, 200) };
    case "enum": return col.enum!.includes(v) ? { value: v } : { value: null, error: `${col.name} must be one of ${col.enum!.join("/")}` };
    case "int": return /^-?\d+$/.test(v) ? { value: Number(v) } : { value: null, error: `${col.name} must be an integer` };
    case "number": return /^-?\d*\.?\d+$/.test(v) && Number.isFinite(Number(v)) ? { value: Number(v) } : { value: null, error: `${col.name} must be a number` };
    case "money": return /^\d+(\.\d{1,2})?$/.test(v) ? { value: money(dec(v)).toFixed(2) } : { value: null, error: `${col.name} must be a non-negative amount with at most 2 decimals` };
    case "date": return isIsoDate(v) && !Number.isNaN(Date.parse(v)) ? { value: v } : { value: null, error: `${col.name} is not a valid ISO date (${v})` };
    case "datetime": { const d = new Date(v); return Number.isNaN(d.getTime()) ? { value: null, error: `${col.name} is not a valid timestamp (${v})` } : { value: d.toISOString() }; }
  }
}

export async function validateImport(db: Db, input: { dataset: string; fileName: string; csvText: string; mapping?: Record<string, string | null>; createdBy: string; now: Date }) {
  const spec = datasetSpec(input.dataset);
  if (!spec) throw badRequest(`Unknown dataset ${input.dataset}`);
  if (input.csvText.length > 5_000_000) throw badRequest("File exceeds the 5 MB demo limit");
  const checksum = "sha256:" + createHash("sha256").update(input.csvText).digest("hex");
  const existing = await db.importBatch.findUnique({ where: { dataset_checksum: { dataset: spec.code, checksum } } });
  if (existing) throw conflict(`This file was already uploaded as batch ${existing.id} (${existing.status}); duplicate batches are rejected`, { batchId: existing.id });
  const { headers, rows } = parseCsv(input.csvText);
  if (headers.length === 0 || rows.length === 0) throw unprocessable("The file has no header or no data rows");
  const mapping = { ...proposeMapping(spec, headers), ...(input.mapping ?? {}) };
  const unmappedRequired = spec.columns.filter((c) => c.required && !mapping[c.name]);
  if (unmappedRequired.length) throw unprocessable(`Required columns not mapped: ${unmappedRequired.map((c) => c.name).join(", ")}`, { headers, mapping });
  const idx = (name: string) => headers.indexOf(mapping[name] ?? "");

  const accepted: ValidatedRow[] = [];
  const rejected: RejectedRow[] = [];
  const warnings: Payload["warnings"] = [];
  const seenKeys = new Set<string>();
  const customerRefs = new Set<string>();
  const loanRefs = new Set<string>();
  for (let r = 0; r < rows.length; r++) {
    const rowNumber = r + 2;
    const raw: Record<string, string> = {};
    const data: Record<string, string | number | null> = {};
    const errors: string[] = [];
    for (const col of spec.columns) {
      const i = idx(col.name);
      const cell = i >= 0 ? rows[r][i] : undefined;
      raw[col.name] = cell ?? "";
      const p = parseValue(col, cell);
      if (p.error) errors.push(p.error);
      data[col.name] = p.value;
    }
    if (spec.code === "payments" && data.kind === "REVERSAL" && !data.reversal_of) errors.push("reversal_of is required for REVERSAL rows");
    if (spec.code === "payments" && data.amount !== null && dec(String(data.amount)).lessThanOrEqualTo(0)) errors.push("amount must be positive");
    if (spec.code === "scores" && typeof data.risk_class === "number" && (data.risk_class < 1 || data.risk_class > 8)) errors.push("risk_class must be 1–8");
    if (spec.code === "scores" && typeof data.probability === "number" && !(data.probability > 0 && data.probability < 1)) errors.push("probability must be in (0,1)");
    if (spec.code === "features" && typeof data.observation_month === "string" && !/^\d{4}-\d{2}$/.test(data.observation_month)) errors.push("observation_month must be YYYY-MM");
    const key = spec.keyColumns.map((k) => String(data[k] ?? "")).join("|");
    if (errors.length) { rejected.push({ rowNumber, code: errors.some((e) => e.includes("date") || e.includes("timestamp")) ? "INVALID_DATE" : errors.some((e) => e.includes("amount") || e.includes("number") || e.includes("integer")) ? "INVALID_AMOUNT" : "SCHEMA_MISMATCH", message: errors.join("; "), data: raw }); continue; }
    if (seenKeys.has(key)) { rejected.push({ rowNumber, code: "DUPLICATE_IN_FILE", message: `Duplicate key ${key} within the file`, data: raw }); continue; }
    seenKeys.add(key);
    if (typeof data.customer_id === "string") customerRefs.add(data.customer_id);
    if (typeof data.core_loan_id === "string") loanRefs.add(data.core_loan_id);
    accepted.push({ rowNumber, data, key });
  }

  // Reference checks (bulk) and duplicate-against-store checks.
  const customers = new Set((await db.customer.findMany({ where: { id: { in: [...customerRefs] } }, select: { id: true } })).map((c) => c.id));
  const loans = new Map((await db.loan.findMany({ where: { coreLoanId: { in: [...loanRefs] } }, select: { coreLoanId: true, id: true } })).map((l) => [l.coreLoanId, l.id]));
  const existingTxns = spec.code === "payments" ? new Set((await db.payment.findMany({ where: { sourceTransactionId: { in: accepted.map((a) => String(a.data.transaction_id)) } }, select: { sourceTransactionId: true } })).map((p) => p.sourceTransactionId)) : new Set<string>();
  const existingModels = spec.code === "scores" ? new Set((await db.modelVersion.findMany({ select: { version: true } })).map((m) => m.version)) : new Set<string>();
  const stillAccepted: ValidatedRow[] = [];
  for (const row of accepted) {
    const d = row.data;
    const raw = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === null ? "" : String(v)]));
    if (spec.code !== "customers" && typeof d.customer_id === "string" && !customers.has(d.customer_id)) { rejected.push({ rowNumber: row.rowNumber, code: "MISSING_CUSTOMER_REFERENCE", message: `customer_id ${d.customer_id} not found`, data: raw }); continue; }
    if (spec.code !== "loans" && typeof d.core_loan_id === "string" && !loans.has(d.core_loan_id)) { rejected.push({ rowNumber: row.rowNumber, code: "MISSING_LOAN_REFERENCE", message: `core_loan_id ${d.core_loan_id} not found`, data: raw }); continue; }
    if (spec.code === "loans" && loans.has(String(d.core_loan_id))) { warnings.push({ rowNumber: row.rowNumber, code: "EXISTING_LOAN", message: `core_loan_id ${d.core_loan_id} already exists; row will update descriptive fields only` }); }
    if (spec.code === "payments" && existingTxns.has(String(d.transaction_id))) { warnings.push({ rowNumber: row.rowNumber, code: "DUPLICATE_SOURCE_ID", message: `transaction_id ${d.transaction_id} already processed; row will be ignored (idempotent)` }); }
    if (spec.code === "scores" && !existingModels.has(String(d.model_version))) { rejected.push({ rowNumber: row.rowNumber, code: "UNKNOWN_MODEL_VERSION", message: `model_version ${d.model_version} is not registered on S13`, data: raw }); continue; }
    stillAccepted.push(row);
  }

  const amountCol = spec.columns.find((c) => c.type === "money" && ["amount", "principal_original", "principal_outstanding", "principal_due"].includes(c.name))?.name ?? null;
  const total = amountCol ? stillAccepted.reduce((s, r) => s.plus(String(r.data[amountCol] ?? "0")), dec(0)) : null;
  const rejectedTotal = amountCol ? rejected.reduce((s, r) => (/^\d+(\.\d{1,2})?$/.test(r.data[amountCol] ?? "") ? s.plus(r.data[amountCol]) : s), dec(0)) : null;
  const asOfCol = spec.columns.find((c) => ["source_as_of", "balances_as_of", "posted_at", "as_of"].includes(c.name))?.name ?? null;
  const sourceAsOf = asOfCol ? stillAccepted.map((r) => r.data[asOfCol]).filter((v): v is string => typeof v === "string").sort().at(-1) ?? null : null;
  const controlTotals = { rows: rows.length, accepted: stillAccepted.length, rejected: rejected.length, duplicatesInFile: rejected.filter((r) => r.code === "DUPLICATE_IN_FILE").length, duplicatesInStore: warnings.filter((w) => w.code === "DUPLICATE_SOURCE_ID").length, missingReferences: rejected.filter((r) => r.code.startsWith("MISSING_")).length, invalidDates: rejected.filter((r) => r.code === "INVALID_DATE").length, invalidAmounts: rejected.filter((r) => r.code === "INVALID_AMOUNT").length, schemaMismatch: rejected.filter((r) => r.code === "SCHEMA_MISMATCH").length, amountColumn: amountCol, acceptedAmountByCurrency: total ? { AZN: money(total).toFixed(2) } : null, rejectedAmountByCurrency: rejectedTotal ? { AZN: money(rejectedTotal).toFixed(2) } : null, sourceAsOf };

  const batch = await db.importBatch.create({
    data: { dataset: spec.code, fileName: input.fileName.slice(0, 200), checksum, status: "VALIDATED", rowCount: rows.length, acceptedCount: stillAccepted.length, quarantinedCount: rejected.length, duplicateCount: controlTotals.duplicatesInFile + controlTotals.duplicatesInStore, controlTotals: controlTotals as never, columnMapping: mapping as never, sourceAsOf: sourceAsOf ? new Date(sourceAsOf) : null, createdBy: input.createdBy, payloadJson: { mapping, accepted: stillAccepted, rejected, warnings } as never },
  });
  if (rejected.length || warnings.length) {
    await db.dataIssue.createMany({ data: [
      ...rejected.map((r) => ({ importBatchId: batch.id, severity: (spec.critical ? "CRITICAL" : "WARNING") as "CRITICAL" | "WARNING", code: r.code, rowNumber: r.rowNumber, message: r.message, rowJson: r.data as never })),
      ...warnings.map((w) => ({ importBatchId: batch.id, severity: "WARNING" as const, code: w.code, rowNumber: w.rowNumber, message: w.message })),
    ] });
  }
  await appendAudit(db, { actorUserId: input.createdBy, action: "import.validated", objectType: "ImportBatch", objectId: batch.id, changes: controlTotals });
  return { batchId: batch.id, mapping, headers, controlTotals, rejected: rejected.slice(0, 50), warnings: warnings.slice(0, 50), spec: { code: spec.code, label: spec.label, critical: spec.critical, rollback: spec.rollback } };
}

async function loadBatch(db: Db, id: string) {
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) throw notFound("Import batch not found");
  const spec = datasetSpec(batch.dataset)!;
  const payload = (batch.payloadJson ?? { mapping: {}, accepted: [], rejected: [], warnings: [] }) as unknown as Payload;
  return { batch, spec, payload };
}

/** Dry run: what a commit would change, without writing business data. */
export async function dryRunImport(db: Db, batchId: string, userId: string) {
  const { batch, spec, payload } = await loadBatch(db, batchId);
  if (!["VALIDATED", "DRY_RUN"].includes(batch.status)) throw conflict(`Batch is ${batch.status}; dry run needs a VALIDATED batch`);
  const rows = payload.accepted;
  const plan: Record<string, unknown> = { dataset: spec.code, accepted: rows.length, quarantined: payload.rejected.length, skippedDuplicates: payload.warnings.filter((w) => w.code === "DUPLICATE_SOURCE_ID").length };
  switch (spec.code) {
    case "payments": {
      const byLoan = new Map<string, { n: number; amount: ReturnType<typeof dec> }>();
      for (const r of rows) { const k = String(r.data.core_loan_id); const e = byLoan.get(k) ?? { n: 0, amount: dec(0) }; e.n++; e.amount = e.amount.plus(String(r.data.amount)); byLoan.set(k, e); }
      const loans = await db.loan.findMany({ where: { coreLoanId: { in: [...byLoan.keys()] } }, select: { coreLoanId: true, customerId: true, totalOverdue: true, dpd: true } });
      plan.affectedLoans = loans.map((l) => ({ coreLoanId: l.coreLoanId, customerId: l.customerId, currentOverdue: l.totalOverdue.toString(), dpd: l.dpd, postings: byLoan.get(l.coreLoanId)!.n, amount: money(byLoan.get(l.coreLoanId)!.amount).toFixed(2), wouldCure: dec(l.totalOverdue).lessThanOrEqualTo(byLoan.get(l.coreLoanId)!.amount) }));
      plan.postedTotal = money(rows.reduce((s, r) => s.plus(String(r.data.amount)), dec(0))).toFixed(2);
      plan.note = "Each row becomes an idempotent payment.posted / payment.reversed integration event; allocations follow the demo policy; promises are attributed once; cases cure only at zero overdue.";
      break;
    }
    case "loans": plan.newLoans = rows.length - payload.warnings.filter((w) => w.code === "EXISTING_LOAN").length; plan.updatedLoans = payload.warnings.filter((w) => w.code === "EXISTING_LOAN").length; plan.note = "New loans get a core schedule generated by the annuity engine (until a schedule import supersedes it) and a recomputed projection."; break;
    case "schedules": { const versions = new Set(rows.map((r) => `${r.data.core_loan_id}|${r.data.schedule_version}`)); plan.scheduleVersions = versions.size; plan.installments = rows.length; plan.note = "Each (loan, version) becomes a new current CORE_IMPORT schedule version; previous versions are retained; projections are restated."; break; }
    case "arrears": plan.snapshots = rows.length; plan.note = "Snapshots are stored with provenance and compared with the local projection; mismatches raise reconciliation issues rather than silently overwriting balances."; break;
    case "features": { const months = new Set(rows.map((r) => String(r.data.observation_month))); plan.customers = new Set(rows.map((r) => String(r.data.customer_id))).size; plan.observationMonths = [...months]; plan.note = "Feature snapshots become the latest complete observation for scoring at the next daily run."; break; }
    case "scores": plan.scores = rows.length; plan.note = "External scores are retained for comparison (S19) and are not used for routing unless a strategy selects them."; break;
    case "contacts": plan.contacts = rows.length; plan.note = "Contact points are added as UNVERIFIED unless the file says otherwise; existing numbers are not changed."; break;
    case "customers": plan.customers = rows.length; plan.note = "Customers are created or updated; no financial state changes."; break;
  }
  await db.importBatch.update({ where: { id: batchId }, data: { status: "DRY_RUN", payloadJson: { ...payload, dryRun: plan } as never } });
  await appendAudit(db, { actorUserId: userId, action: "import.dry_run", objectType: "ImportBatch", objectId: batchId, changes: plan });
  return plan;
}

/** Commit the accepted rows. Quarantined rows never enter; duplicates are skipped idempotently. */
export async function commitImport(prisma: PrismaClient, batchId: string, userId: string, now: Date) {
  const { batch, spec, payload } = await loadBatch(prisma, batchId);
  if (!["VALIDATED", "DRY_RUN"].includes(batch.status)) throw conflict(`Batch is ${batch.status}; only VALIDATED/DRY_RUN batches can be committed`);
  const rows = payload.accepted;
  const businessDate = bakuBusinessDate(now);
  const result: Record<string, unknown> = { created: 0, updated: 0, skipped: 0, quarantined: payload.rejected.length, ids: [] as string[], events: [] as { txn: string; status: string }[] };
  const ids = result.ids as string[];
  const touchedCustomers = new Set<string>();
  switch (spec.code) {
    case "customers":
      for (const r of rows) {
        const d = r.data;
        const existing = await prisma.customer.findUnique({ where: { id: String(d.customer_id) } });
        await prisma.customer.upsert({ where: { id: String(d.customer_id) }, create: { id: String(d.customer_id), cif: String(d.cif), displayName: String(d.display_name), branch: String(d.branch), language: (d.language as "AZ" | "EN" | "RU") ?? "AZ", status: (d.status as "ACTIVE") ?? "ACTIVE", sourceSystem: `${IMPORT_SOURCE}:${batchId}`, sourceAsOf: new Date(String(d.source_as_of)) }, update: { displayName: String(d.display_name), branch: String(d.branch), ...(d.language ? { language: d.language as "AZ" | "EN" | "RU" } : {}), ...(d.status ? { status: d.status as "ACTIVE" } : {}), sourceAsOf: new Date(String(d.source_as_of)) } });
        if (existing) result.updated = (result.updated as number) + 1;
        else result.created = (result.created as number) + 1;
      }
      break;
    case "contacts":
      for (const r of rows) {
        const d = r.data;
        const cp = await prisma.contactPoint.create({ data: { customerId: String(d.customer_id), type: d.type as "MOBILE", value: String(d.value), isPrimary: ["true", "1"].includes(String(d.is_primary ?? "false")), verification: (d.verification as "VERIFIED") ?? "UNVERIFIED", preferredWindow: d.preferred_window ? String(d.preferred_window) : null, sourceSystem: `${IMPORT_SOURCE}:${batchId}`, sourceAsOf: new Date(String(d.source_as_of)) } });
        ids.push(cp.id); result.created = (result.created as number) + 1;
      }
      break;
    case "loans":
      for (const r of rows) {
        const d = r.data;
        const coreLoanId = String(d.core_loan_id);
        const existing = await prisma.loan.findUnique({ where: { coreLoanId } });
        if (existing) { await prisma.loan.update({ where: { id: existing.id }, data: { branch: String(d.branch), balancesAsOf: new Date(String(d.balances_as_of)) } }); result.updated = (result.updated as number) + 1; continue; }
        const firstDue = String(d.first_due_date) as IsoDate;
        const schedule = buildAnnuitySchedule({ principal: String(d.principal_original), nominalAnnualRate: Number(d.nominal_annual_rate), months: Number(d.tenor_months), firstDueDate: firstDue });
        const id = `L-IMP-${coreLoanId.replace(/[^A-Za-z0-9]/g, "").slice(-12)}-${batchId.slice(-4)}`;
        const loan = await prisma.loan.create({ data: { id, coreLoanId, customerId: String(d.customer_id), branch: String(d.branch), originationDate: toDbDate(String(d.origination_date) as IsoDate), maturityDate: toDbDate(schedule.installments.at(-1)!.dueDate), firstDueDate: toDbDate(firstDue), principalOriginal: toDbMoney(String(d.principal_original)), nominalAnnualRate: dec(Number(d.nominal_annual_rate)).toFixed(6), tenorMonths: Number(d.tenor_months), principalOutstanding: toDbMoney(String(d.principal_original)), balancesAsOf: new Date(String(d.balances_as_of)), sourceSystem: `${IMPORT_SOURCE}:${batchId}`, status: "ACTIVE" } });
        const version = await prisma.scheduleVersion.create({ data: { loanId: loan.id, versionNo: 1, source: "CORE_IMPORT", sourceRef: `IMPORT-${batchId}`, effectiveFrom: toDbDate(addMonthsClamped(firstDue, -1)), isCurrent: true, importBatchId: batchId, checksum: batch.checksum, basis: { note: "Generated by the annuity engine from the imported loan terms; superseded by a schedule import if the core schedule differs" } as never } });
        await prisma.installment.createMany({ data: schedule.installments.map((i) => ({ scheduleVersionId: version.id, seq: i.seq, dueDate: toDbDate(i.dueDate), openingPrincipal: toDbMoney(i.openingPrincipal), principalDue: toDbMoney(i.principalDue), interestDue: toDbMoney(i.interestDue), feeDue: "0.00", totalDue: toDbMoney(i.totalDue), closingPrincipal: toDbMoney(i.closingPrincipal) })) });
        await recomputeLoanState(prisma, loan.id, businessDate, { reason: `import:${batchId}` });
        touchedCustomers.add(loan.customerId);
        ids.push(loan.id); result.created = (result.created as number) + 1;
      }
      break;
    case "schedules": {
      const groups = new Map<string, ValidatedRow[]>();
      for (const r of rows) { const k = `${r.data.core_loan_id}|${r.data.schedule_version}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
      for (const [k, grp] of groups) {
        const [coreLoanId, versionRef] = k.split("|");
        const loan = await prisma.loan.findUniqueOrThrow({ where: { coreLoanId } });
        const dup = await prisma.scheduleVersion.findFirst({ where: { loanId: loan.id, sourceRef: versionRef } });
        if (dup) { result.skipped = (result.skipped as number) + grp.length; continue; }
        const maxNo = await prisma.scheduleVersion.aggregate({ where: { loanId: loan.id, source: "CORE_IMPORT" }, _max: { versionNo: true } });
        const sorted = [...grp].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
        let opening = dec(loan.principalOriginal.toString());
        await prisma.$transaction(async (tx) => {
          await tx.scheduleVersion.updateMany({ where: { loanId: loan.id, isCurrent: true, source: "CORE_IMPORT" }, data: { isCurrent: false } });
          const version = await tx.scheduleVersion.create({ data: { loanId: loan.id, versionNo: (maxNo._max.versionNo ?? 0) + 1, source: "CORE_IMPORT", sourceRef: versionRef, effectiveFrom: toDbDate(String(sorted[0].data.effective_from) as IsoDate), isCurrent: true, importBatchId: batchId, checksum: batch.checksum, basis: { note: `Imported core schedule ${versionRef}` } as never } });
          await tx.installment.createMany({ data: sorted.map((i) => { const principal = dec(String(i.data.principal_due)); const interest = dec(String(i.data.interest_due)); const fee = dec(String(i.data.fee_due ?? "0")); const row = { scheduleVersionId: version.id, seq: Number(i.data.seq), dueDate: toDbDate(String(i.data.due_date) as IsoDate), openingPrincipal: toDbMoney(opening), principalDue: toDbMoney(principal), interestDue: toDbMoney(interest), feeDue: toDbMoney(fee), totalDue: toDbMoney(principal.plus(interest).plus(fee)), closingPrincipal: toDbMoney(opening.minus(principal)) }; opening = opening.minus(principal); return row; }) });
          ids.push(version.id);
        });
        await recomputeLoanState(prisma, loan.id, businessDate, { reason: `schedule-import:${batchId}` });
        touchedCustomers.add(loan.customerId);
        result.created = (result.created as number) + grp.length;
      }
      break;
    }
    case "payments":
      const duplicateRows = new Set(payload.warnings.filter((w) => w.code === "DUPLICATE_SOURCE_ID").map((w) => w.rowNumber));
      for (const r of rows) {
        const d = r.data;
        const txn = String(d.transaction_id);
        if (duplicateRows.has(r.rowNumber)) { result.skipped = (result.skipped as number) + 1; (result.events as { txn: string; status: string }[]).push({ txn, status: "SKIPPED_EXISTING_TRANSACTION" }); continue; }
        const isReversal = d.kind === "REVERSAL";
        const event = { schemaVersion: "1.0", eventId: `import-${batchId}-${txn}`, eventType: isReversal ? "payment.reversed" : "payment.posted", sourceSystem: IMPORT_SOURCE, sourceEventId: txn, occurredAt: String(d.posted_at), businessDate: String(d.value_date), loanId: String(d.core_loan_id), correlationId: batchId, payload: isReversal ? { originalTransactionId: String(d.reversal_of), transactionId: txn, amount: String(d.amount), currency: "AZN", valueDate: String(d.value_date), loanRef: String(d.core_loan_id) } : { transactionId: txn, amount: String(d.amount), currency: "AZN", valueDate: String(d.value_date), loanRef: String(d.core_loan_id), importBatchId: batchId } };
        const res = await ingestIntegrationEvent(prisma, event, now);
        (result.events as { txn: string; status: string }[]).push({ txn, status: res.status });
        if (res.status === "PROCESSED") { result.created = (result.created as number) + 1; if (res.paymentId) { ids.push(res.paymentId); await prisma.payment.update({ where: { id: res.paymentId }, data: { importBatchId: batchId } }); } }
        else if (res.status === "DUPLICATE") result.skipped = (result.skipped as number) + 1;
        else result.quarantined = (result.quarantined as number) + 1;
      }
      break;
    case "arrears":
      for (const r of rows) {
        const d = r.data;
        const loan = await prisma.loan.findUniqueOrThrow({ where: { coreLoanId: String(d.core_loan_id) } });
        const snap = await prisma.loanSnapshot.create({ data: { loanId: loan.id, asOf: new Date(String(d.as_of)), balanceVersion: Number(d.balance_version), principalOutstanding: String(d.principal_outstanding), overduePrincipal: String(d.overdue_principal), overdueInterest: String(d.overdue_interest), accruedInterestNotDue: "0.00", feesDue: "0.00", unappliedFunds: "0.00", totalOverdue: money(dec(String(d.overdue_principal)).plus(String(d.overdue_interest))).toFixed(2), dpd: Number(d.dpd), status: loan.status, reason: `import:${batchId}` } });
        ids.push(snap.id);
        const mismatch = !dec(loan.totalOverdue.toString()).equals(snap.totalOverdue.toString()) || loan.dpd !== Number(d.dpd);
        if (mismatch) await prisma.dataIssue.create({ data: { importBatchId: batchId, severity: "WARNING", code: "PROJECTION_MISMATCH", rowNumber: r.rowNumber, message: `Core snapshot (overdue ${snap.totalOverdue.toString()}, DPD ${d.dpd}) differs from the local projection (overdue ${loan.totalOverdue.toString()}, DPD ${loan.dpd}); reconciliation required`, rowJson: d as never } });
        if (Number(d.balance_version) >= Number(loan.sourceVersion)) await prisma.loan.update({ where: { id: loan.id }, data: { balancesAsOf: new Date(String(d.as_of)), sourceVersion: String(d.balance_version) } });
        result.created = (result.created as number) + 1;
      }
      break;
    case "features":
      for (const r of rows) {
        const d = r.data;
        const customerId = String(d.customer_id);
        const features = Object.fromEntries(Object.entries(d).filter(([k]) => /^[A-Z]/.test(k)).map(([k, v]) => [k, v === null ? null : Number(v)]));
        const existing = await prisma.featureSnapshot.findUnique({ where: { customerId_observationMonth: { customerId, observationMonth: String(d.observation_month) } } });
        if (existing) { result.skipped = (result.skipped as number) + 1; continue; }
        await prisma.featureSnapshot.updateMany({ where: { customerId, isLatestComplete: true, asOf: { lte: toDbDate(String(d.as_of) as IsoDate) } }, data: { isLatestComplete: false } });
        const fs = await prisma.featureSnapshot.create({ data: { customerId, asOf: toDbDate(String(d.as_of) as IsoDate), observationMonth: String(d.observation_month), features: features as never, isLatestComplete: true, source: `${IMPORT_SOURCE}:${batchId}`, importBatchId: batchId, qualityFlags: Object.values(features).some((v) => v === null) ? ["MISSING_FEATURES"] : [] } });
        ids.push(fs.id); result.created = (result.created as number) + 1;
      }
      break;
    case "scores":
      for (const r of rows) {
        const d = r.data;
        const mv = await prisma.modelVersion.findFirst({ where: { version: String(d.model_version) } });
        const loans = await prisma.loan.findMany({ where: { customerId: String(d.customer_id), status: "ACTIVE" }, select: { dpd: true } });
        const dpd = loans.reduce((m, l) => Math.max(m, l.dpd), 0);
        const { segmentForDpd } = await import("@/server/modules/decisions/segments");
        const sc = await prisma.score.create({ data: { customerId: String(d.customer_id), modelVersionId: mv?.id, segment: segmentForDpd(dpd), status: "SCORED", riskClass: Number(d.risk_class), probability: dec(Number(d.probability)).toFixed(6), probabilitySource: "EXTERNAL_SUPPLIED", tracePath: { importBatchId: batchId } as never, reasonCodes: ["EXTERNAL_SUPPLIED_SCORE"], featuresAsOf: new Date(String(d.score_as_of)) } });
        ids.push(sc.id); result.created = (result.created as number) + 1;
      }
      break;
  }
  for (const customerId of touchedCustomers) await syncCustomerCase(prisma, customerId, now, { actorService: "import" });
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "COMMITTED", committedAt: now, acceptedCount: (result.created as number) + (result.updated as number), duplicateCount: batch.duplicateCount + (result.skipped as number), quarantinedCount: result.quarantined as number, summary: result as never, payloadJson: { ...payload, commit: result } as never } });
  await appendAudit(prisma, { actorUserId: userId, action: "import.committed", objectType: "ImportBatch", objectId: batchId, changes: { created: result.created, updated: result.updated, skipped: result.skipped, quarantined: result.quarantined } });
  return result;
}

/** Rollback where supported; imported history stays visible (status ROLLED_BACK, rows retained or reversed). */
export async function rollbackImport(prisma: PrismaClient, batchId: string, userId: string, now: Date, reason: string) {
  const { batch, spec, payload } = await loadBatch(prisma, batchId);
  if (batch.status !== "COMMITTED") throw conflict(`Batch is ${batch.status}; only COMMITTED batches can be rolled back`);
  const ids = ((payload.commit?.ids as string[] | undefined) ?? []);
  const out: Record<string, unknown> = { mode: spec.rollback };
  switch (spec.rollback) {
    case "DELETE_BY_BATCH":
      if (spec.code === "contacts") out.deleted = (await prisma.contactPoint.deleteMany({ where: { id: { in: ids }, reservations: { none: {} }, dialAttempts: { none: {} }, interactions: { none: {} } } })).count;
      if (spec.code === "features") { out.deleted = (await prisma.featureSnapshot.deleteMany({ where: { importBatchId: batchId, scores: { none: {} } } })).count; for (const c of new Set(payload.accepted.map((r) => String(r.data.customer_id)))) { const latest = await prisma.featureSnapshot.findFirst({ where: { customerId: c }, orderBy: { asOf: "desc" } }); if (latest) await prisma.featureSnapshot.update({ where: { id: latest.id }, data: { isLatestComplete: true } }); } }
      if (spec.code === "scores") out.deleted = (await prisma.score.deleteMany({ where: { id: { in: ids }, decisions: { none: {} } } })).count;
      break;
    case "REVERSAL_EVENTS": {
      const events: { txn: string; status: string }[] = [];
      for (const e of (payload.commit?.events as { txn: string; status: string }[] | undefined) ?? []) {
        if (e.status !== "PROCESSED") continue;
        const payment = await prisma.payment.findFirst({ where: { sourceSystem: IMPORT_SOURCE, sourceTransactionId: e.txn, status: "POSTED" } });
        if (!payment) continue;
        const res = await ingestIntegrationEvent(prisma, { schemaVersion: "1.0", eventId: `rollback-${batchId}-${e.txn}`, eventType: "payment.reversed", sourceSystem: IMPORT_SOURCE, sourceEventId: `ROLLBACK-${e.txn}`, occurredAt: now.toISOString(), loanId: payment.loanId, correlationId: batchId, payload: { originalTransactionId: e.txn, transactionId: `ROLLBACK-${e.txn}`, amount: payment.amount.toString(), currency: "AZN", valueDate: now.toISOString().slice(0, 10), reason: `Import rollback: ${reason}` } }, now);
        events.push({ txn: e.txn, status: res.status });
      }
      out.reversals = events;
      break;
    }
    case "RETAINED_REVERSE_IMPORT":
      throw unprocessable(`${spec.label} imports are retained as history; a corrective reverse import (new versions/snapshots) is required instead of deletion`);
  }
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "ROLLED_BACK", rolledBackAt: now, summary: { ...(batch.summary as object), rollback: out, reason } as never } });
  await appendAudit(prisma, { actorUserId: userId, action: "import.rolled_back", objectType: "ImportBatch", objectId: batchId, reason, changes: out });
  return out;
}

export function listDatasets() {
  return DATASETS.map((d) => ({ code: d.code, label: d.label, critical: d.critical, keyColumns: d.keyColumns, rollback: d.rollback, columns: d.columns.map((c) => ({ name: c.name, required: c.required, type: c.type, description: c.description, synonyms: c.synonyms ?? [], enum: c.enum ?? null })) }));
}
export type { DatasetSpec };
