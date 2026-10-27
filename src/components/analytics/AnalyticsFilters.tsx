"use client";
import { Button, Field, Input, Select } from "@/components/ui";

export function AnalyticsFilters({ tab, values, branches, owners, strategies }: { tab: string; values: Record<string, string | undefined>; branches: string[]; owners: { id: string; displayName: string }[]; strategies: { id: string; code: string; version: string }[] }) {
  return (
    <form method="get" action="/analytics" className="space-y-2">
      <input type="hidden" name="tab" value={tab} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="From (snapshot/entry)" htmlFor="af-from"><Input id="af-from" name="from" type="date" defaultValue={values.from ?? ""} /></Field>
        <Field label="To" htmlFor="af-to"><Input id="af-to" name="to" type="date" defaultValue={values.to ?? ""} /></Field>
      </div>
      <Field label="Branch" htmlFor="af-branch"><Select id="af-branch" name="branch" defaultValue={values.branch ?? ""}><option value="">All</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</Select></Field>
      <Field label="DPD segment" htmlFor="af-seg"><Select id="af-seg" name="segment" defaultValue={values.segment ?? ""}><option value="">All</option>{["DPD_1_3", "DPD_4_10", "DPD_11_16", "DPD_17_23", "DPD_24_30", "DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS"].map((s) => <option key={s} value={s}>{s.replace("DPD_", "DPD ").replace("_PLUS", "+").replace("_", "–")}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Risk class" htmlFor="af-class"><Select id="af-class" name="riskClass" defaultValue={values.riskClass ?? ""}><option value="">All</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        <Field label="Action bucket" htmlFor="af-bucket"><Select id="af-bucket" name="bucket" defaultValue={values.bucket ?? ""}><option value="">All</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
      </div>
      <Field label="Owner" htmlFor="af-owner"><Select id="af-owner" name="owner" defaultValue={values.owner ?? ""}><option value="">All</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}</Select></Field>
      <Field label="Strategy version" htmlFor="af-strategy"><Select id="af-strategy" name="strategyVersionId" defaultValue={values.strategyVersionId ?? ""}><option value="">All</option>{strategies.map((s) => <option key={s.id} value={s.id}>{s.code} {s.version}</option>)}</Select></Field>
      <Field label="Experiment arm" htmlFor="af-arm"><Input id="af-arm" name="arm" defaultValue={values.arm ?? ""} placeholder="e.g. A" /></Field>
      <div className="flex gap-2"><Button type="submit" variant="primary" size="sm">Apply</Button><a className="btn btn-secondary btn-sm" href={`/analytics?tab=${tab}`}>Reset</a></div>
    </form>
  );
}
