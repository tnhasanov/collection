/**
 * Import dataset catalogue (S20): canonical columns, synonyms for auto-mapping, key columns for duplicate
 * protection and the synthetic example files. Financial datasets are critical: invalid rows are quarantined
 * and never enter the active projection.
 */
export type DatasetCode = "customers" | "contacts" | "loans" | "schedules" | "payments" | "arrears" | "features" | "scores";

export interface ColumnSpec { name: string; required: boolean; type: "string" | "number" | "money" | "date" | "datetime" | "int" | "enum"; enum?: string[]; synonyms?: string[]; description: string; pattern?: RegExp }
/** Identifier columns: safe characters only (no spreadsheet formula triggers, no control characters). */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
export interface DatasetSpec { code: DatasetCode; label: string; critical: boolean; keyColumns: string[]; columns: ColumnSpec[]; rollback: "DELETE_BY_BATCH" | "REVERSAL_EVENTS" | "RETAINED_REVERSE_IMPORT"; example: string[][] }

export const DATASETS: DatasetSpec[] = [
  {
    code: "customers", label: "Customers", critical: false, keyColumns: ["customer_id"], rollback: "RETAINED_REVERSE_IMPORT",
    columns: [
      { name: "customer_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cust_id", "customerid", "id"], description: "Collections customer id" },
      { name: "cif", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cif_no", "cif_number"], description: "Core banking CIF" },
      { name: "display_name", required: true, type: "string", synonyms: ["name", "full_name"], description: "Display name" },
      { name: "branch", required: true, type: "string", synonyms: ["branch_code"], description: "Branch" },
      { name: "language", required: false, type: "enum", enum: ["AZ", "EN", "RU"], synonyms: ["lang"], description: "Preferred language" },
      { name: "status", required: false, type: "enum", enum: ["ACTIVE", "INACTIVE", "DECEASED_NOTIFIED", "LEGAL"], description: "Customer status" },
      { name: "source_as_of", required: true, type: "datetime", synonyms: ["as_of", "asof"], description: "Source as-of timestamp" },
    ],
    example: [["customer_id", "cif", "display_name", "branch", "language", "status", "source_as_of"], ["C-IMP-001", "CIF-IMP-001", "Import Test Customer", "Baku-Central", "AZ", "ACTIVE", "2026-10-27T05:30:00+04:00"]],
  },
  {
    code: "contacts", label: "Contacts / preferences", critical: false, keyColumns: ["customer_id", "type", "value"], rollback: "DELETE_BY_BATCH",
    columns: [
      { name: "customer_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cust_id"], description: "Customer id (must exist)" },
      { name: "type", required: true, type: "enum", enum: ["MOBILE", "LANDLINE", "EMAIL", "ADDRESS"], synonyms: ["contact_type"], description: "Contact type" },
      { name: "value", required: true, type: "string", synonyms: ["phone", "number", "contact_value"], description: "Phone/e-mail value" },
      { name: "is_primary", required: false, type: "enum", enum: ["true", "false", "1", "0"], synonyms: ["primary"], description: "Primary flag" },
      { name: "verification", required: false, type: "enum", enum: ["VERIFIED", "UNVERIFIED", "INVALID"], description: "Verification status" },
      { name: "preferred_window", required: false, type: "string", description: "Preferred contact window (HH:MM-HH:MM)" },
      { name: "source_as_of", required: true, type: "datetime", synonyms: ["as_of"], description: "Source as-of timestamp" },
    ],
    example: [["customer_id", "type", "value", "is_primary", "verification", "preferred_window", "source_as_of"], ["C-DEMO-001", "MOBILE", "+994501234999", "false", "UNVERIFIED", "18:00-20:00", "2026-10-27T05:30:00+04:00"]],
  },
  {
    code: "loans", label: "Loans", critical: true, keyColumns: ["core_loan_id"], rollback: "RETAINED_REVERSE_IMPORT",
    columns: [
      { name: "core_loan_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["loan_no", "loan_id", "contract_no"], description: "Core contract id" },
      { name: "customer_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cust_id"], description: "Customer id (must exist)" },
      { name: "principal_original", required: true, type: "money", synonyms: ["principal", "amount"], description: "Original principal AZN" },
      { name: "nominal_annual_rate", required: true, type: "number", synonyms: ["rate", "interest_rate"], description: "Nominal annual rate (0.18 = 18%)" },
      { name: "tenor_months", required: true, type: "int", synonyms: ["tenor", "term"], description: "Tenor in months" },
      { name: "origination_date", required: true, type: "date", synonyms: ["disbursement_date", "start_date"], description: "Origination date" },
      { name: "first_due_date", required: true, type: "date", synonyms: ["first_installment_date"], description: "First due date" },
      { name: "branch", required: true, type: "string", description: "Branch" },
      { name: "currency", required: false, type: "enum", enum: ["AZN"], description: "Currency (AZN only)" },
      { name: "balances_as_of", required: true, type: "datetime", synonyms: ["as_of"], description: "Balance as-of timestamp" },
    ],
    example: [["core_loan_id", "customer_id", "principal_original", "nominal_annual_rate", "tenor_months", "origination_date", "first_due_date", "branch", "currency", "balances_as_of"], ["CORE-L-IMP-001", "C-DEMO-030", "3000.00", "0.18", "12", "2026-09-15", "2026-10-15", "Baku-Central", "AZN", "2026-10-27T05:30:00+04:00"]],
  },
  {
    code: "schedules", label: "Schedule versions / installments", critical: true, keyColumns: ["core_loan_id", "schedule_version", "seq"], rollback: "RETAINED_REVERSE_IMPORT",
    columns: [
      { name: "core_loan_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["loan_no", "loan_id"], description: "Core contract id (must exist)" },
      { name: "schedule_version", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["version", "schedule_ref"], description: "Core schedule version reference" },
      { name: "seq", required: true, type: "int", synonyms: ["installment_no", "no"], description: "Installment sequence" },
      { name: "due_date", required: true, type: "date", synonyms: ["due_dt"], description: "Due date" },
      { name: "principal_due", required: true, type: "money", synonyms: ["principal"], description: "Principal due AZN" },
      { name: "interest_due", required: true, type: "money", synonyms: ["interest"], description: "Interest due AZN" },
      { name: "fee_due", required: false, type: "money", synonyms: ["fee"], description: "Fee due AZN (0 unless core says otherwise)" },
      { name: "effective_from", required: true, type: "date", description: "Version effective date" },
    ],
    example: [["core_loan_id", "schedule_version", "seq", "due_date", "principal_due", "interest_due", "fee_due", "effective_from"], ["CORE-L-DEMO-001", "v2", "1", "2026-10-20", "349.24", "150.00", "0.00", "2026-10-01"]],
  },
  {
    code: "payments", label: "Payments / allocations / reversals", critical: true, keyColumns: ["transaction_id"], rollback: "REVERSAL_EVENTS",
    columns: [
      { name: "transaction_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["txn_id", "tx_id", "reference"], description: "Core transaction id (idempotency key)" },
      { name: "core_loan_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["loan_no", "loan_id"], description: "Core contract id" },
      { name: "amount", required: true, type: "money", synonyms: ["amt"], description: "Amount AZN (positive)" },
      { name: "currency", required: false, type: "enum", enum: ["AZN"], description: "Currency" },
      { name: "value_date", required: true, type: "date", synonyms: ["value_dt", "valuedate"], description: "Value date" },
      { name: "posted_at", required: true, type: "datetime", synonyms: ["posting_ts", "event_at"], description: "Posting timestamp" },
      { name: "kind", required: false, type: "enum", enum: ["POSTED", "REVERSAL"], synonyms: ["type"], description: "POSTED or REVERSAL" },
      { name: "reversal_of", required: false, type: "string", pattern: ID_PATTERN, description: "Original transaction id for reversals" },
    ],
    example: [["transaction_id", "core_loan_id", "amount", "currency", "value_date", "posted_at", "kind", "reversal_of"], ["IMP-TXN-0001", "CORE-L-DEMO-012", "120.00", "AZN", "2026-10-27", "2026-10-27T09:15:00+04:00", "POSTED", ""], ["IMP-TXN-0002", "CORE-L-DEMO-013", "80.00", "AZN", "2026-10-27", "2026-10-27T09:20:00+04:00", "POSTED", ""]],
  },
  {
    code: "arrears", label: "Arrears / balance snapshots", critical: true, keyColumns: ["core_loan_id", "as_of"], rollback: "RETAINED_REVERSE_IMPORT",
    columns: [
      { name: "core_loan_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["loan_no", "loan_id"], description: "Core contract id (must exist)" },
      { name: "as_of", required: true, type: "datetime", synonyms: ["balances_as_of", "snapshot_ts"], description: "Snapshot timestamp" },
      { name: "principal_outstanding", required: true, type: "money", description: "Principal outstanding AZN" },
      { name: "overdue_principal", required: true, type: "money", description: "Overdue principal AZN" },
      { name: "overdue_interest", required: true, type: "money", description: "Overdue interest AZN" },
      { name: "dpd", required: true, type: "int", description: "Days past due" },
      { name: "balance_version", required: true, type: "int", synonyms: ["version"], description: "Monotonic balance version" },
    ],
    example: [["core_loan_id", "as_of", "principal_outstanding", "overdue_principal", "overdue_interest", "dpd", "balance_version"], ["CORE-L-DEMO-018", "2026-10-27T05:30:00+04:00", "4100.00", "190.00", "61.50", "9", "7"]],
  },
  {
    code: "features", label: "Model features (monthly)", critical: false, keyColumns: ["customer_id", "observation_month"], rollback: "DELETE_BY_BATCH",
    columns: [
      { name: "customer_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cust_id"], description: "Customer id (must exist)" },
      { name: "observation_month", required: true, type: "string", synonyms: ["month", "obs_month"], description: "YYYY-MM" },
      { name: "as_of", required: true, type: "date", synonyms: ["asof", "snapshot_date"], description: "Snapshot date" },
      { name: "DPD_MAX_MAX12", required: true, type: "number", description: "Max DPD last 12 months" },
      { name: "DPD_RATIO_ADJ_MAX12", required: true, type: "number", description: "Max adjusted ratio last 12 months" },
      { name: "DPD_RATIO_ADJ_V3LM", required: true, type: "number", description: "Latest minus max of previous 3 months" },
      { name: "DPD30_ADJ100_CNT_L6M", required: true, type: "number", synonyms: ["DPD_30_ADJ100_CNT_L6M"], description: "Months with 30+ in last 6" },
      { name: "DPD_RATIO_ADJ_VLM", required: true, type: "number", description: "Latest month ratio" },
      { name: "MAX_DPD_L3M", required: false, type: "number", description: "Max DPD last 3 months (DEMO-only 1–3 rule input)" },
    ],
    example: [["customer_id", "observation_month", "as_of", "DPD_MAX_MAX12", "DPD_RATIO_ADJ_MAX12", "DPD_RATIO_ADJ_V3LM", "DPD30_ADJ100_CNT_L6M", "DPD_RATIO_ADJ_VLM", "MAX_DPD_L3M"], ["C-DEMO-019", "2026-10", "2026-10-31", "45", "0.05", "-0.5", "0", "0.1", "9"]],
  },
  {
    code: "scores", label: "Externally supplied scores (optional)", critical: false, keyColumns: ["customer_id", "score_as_of", "model_version"], rollback: "DELETE_BY_BATCH",
    columns: [
      { name: "customer_id", required: true, type: "string", pattern: ID_PATTERN, synonyms: ["cust_id"], description: "Customer id (must exist)" },
      { name: "model_version", required: true, type: "string", pattern: ID_PATTERN, description: "Provider model version (must be registered)" },
      { name: "risk_class", required: true, type: "int", synonyms: ["class"], description: "Risk class 1–8" },
      { name: "probability", required: true, type: "number", synonyms: ["p", "pd"], description: "Probability (0,1)" },
      { name: "score_as_of", required: true, type: "date", synonyms: ["as_of"], description: "Score date" },
    ],
    example: [["customer_id", "model_version", "risk_class", "probability", "score_as_of"], ["C-DEMO-002", "DRAFT-2026-06-19-p10", "3", "0.14", "2026-10-27"]],
  },
];

export function datasetSpec(code: string): DatasetSpec | null {
  return DATASETS.find((d) => d.code === code) ?? null;
}

/** Propose a column mapping from source headers using names and synonyms (case-insensitive). */
export function proposeMapping(spec: DatasetSpec, headers: string[]): Record<string, string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: Record<string, string | null> = {};
  for (const col of spec.columns) {
    const candidates = [col.name, ...(col.synonyms ?? [])].map(norm);
    const hit = headers.find((h) => candidates.includes(norm(h)));
    out[col.name] = hit ?? null;
  }
  return out;
}
