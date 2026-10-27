import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { listDatasets } from "@/server/modules/imports/importService";
import { ImportWizard } from "@/components/imports/ImportWizard";
import { BatchActions } from "@/components/imports/BatchActions";

export const dynamic = "force-dynamic";
const TONE: Record<string, Tone> = { UPLOADED: "neutral", VALIDATED: "info", DRY_RUN: "info", COMMITTED: "success", FAILED: "danger", ROLLED_BACK: "warning" };

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "import.write")) redirect("/access-denied");
  const sp = await searchParams;
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { _count: { select: { issues: true } } } });
  const selected = sp.batch ? await prisma.importBatch.findUnique({ where: { id: sp.batch }, include: { issues: { orderBy: [{ severity: "asc" }, { rowNumber: "asc" }], take: 100 } } }) : null;
  const datasets = listDatasets();
  return (
    <>
      <PageHeader kicker="S20 / imports and data quality" title="Imports & data quality" lead="Wizard: choose file/source → map columns → validate → dry-run → inspect/reconcile → commit → results. Batch ids and deterministic duplicate protection are mandatory; invalid critical financial rows are quarantined and never enter the active projection." />
      <Callout tone="info">Synthetic CSV examples are downloadable per dataset. Error files and exports guard against spreadsheet formula injection. Imported history is retained; rollback reverses payments through reversal events or removes non-financial rows by batch.</Callout>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Import wizard"><ImportWizard datasets={datasets} /></Card>
        <Card title="Datasets" subtitle="Canonical columns, key columns and rollback behaviour">
          <ul className="space-y-2 text-xs">
            {datasets.map((d) => (
              <li key={d.code}>
                <div className="flex items-center justify-between gap-2"><strong>{d.label}</strong><span>{d.critical && <Badge tone="warning">critical</Badge>} <a href={`/api/imports/templates/${d.code}`}>template CSV</a></span></div>
                <div className="text-muted">key: {d.keyColumns.join(" + ")} · rollback: {d.rollback.toLowerCase().replace(/_/g, " ")}</div>
                <div className="text-muted">{d.columns.map((c) => `${c.name}${c.required ? "*" : ""}`).join(", ")}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Batches" subtitle="Most recent first" className="mt-3">
        <table className="table-dense">
          <thead><tr><th>Batch</th><th>Dataset</th><th>File</th><th>Status</th><th className="text-right">Rows</th><th className="text-right">Accepted</th><th className="text-right">Quarantined</th><th className="text-right">Duplicates</th><th>Control totals</th><th>Source as-of</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {batches.map((b) => { const ct = b.controlTotals as { acceptedAmountByCurrency?: Record<string, string>; rejectedAmountByCurrency?: Record<string, string> } | null; return (
              <tr key={b.id} className={selected?.id === b.id ? "bg-brand-light" : ""}>
                <td><a href={`/data/imports?batch=${b.id}`}>{b.id.slice(-8)}</a></td><td>{b.dataset}</td><td className="text-xs">{b.fileName}</td><td><Badge tone={TONE[b.status] ?? "neutral"}>{b.status.toLowerCase().replace("_", " ")}</Badge></td>
                <td className="text-right">{b.rowCount}</td><td className="text-right">{b.acceptedCount}</td><td className="text-right">{b.quarantinedCount}</td><td className="text-right">{b.duplicateCount}</td>
                <td className="text-xs">{ct?.acceptedAmountByCurrency ? Object.entries(ct.acceptedAmountByCurrency).map(([c, v]) => `${c} ${v}`).join(", ") : "—"}{ct?.rejectedAmountByCurrency ? ` (rejected ${Object.values(ct.rejectedAmountByCurrency).join(", ")})` : ""}</td>
                <td className="text-xs">{b.sourceAsOf ? fmtDateTime(b.sourceAsOf) : "—"}</td><td className="text-xs">{fmtDateTime(b.createdAt)}</td>
                <td><BatchActions id={b.id} status={b.status} issues={b._count.issues} /></td>
              </tr>); })}
            {batches.length === 0 && <tr><td colSpan={12} className="text-muted">No batches yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {selected && (
        <Card title={`Batch ${selected.id} · ${selected.dataset} · ${selected.status}`} subtitle={`Checksum ${selected.checksum.slice(0, 23)}… · column mapping ${Object.entries((selected.columnMapping as Record<string, string | null>) ?? {}).filter(([, v]) => v).map(([k, v]) => `${v}→${k}`).join(", ")}`} className="mt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div><p className="text-sm font-medium">Control totals</p><pre className="max-h-64 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.controlTotals, null, 1)}</pre></div>
            <div><p className="text-sm font-medium">Summary / rollback</p><pre className="max-h-64 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(selected.summary ?? (selected.payloadJson as { dryRun?: unknown } | null)?.dryRun ?? null, null, 1)}</pre></div>
          </div>
          <p className="mt-2 text-sm font-medium">Issues ({selected.issues.length}{selected.issues.length === 100 ? "+" : ""}) · <a href={`/api/imports/${selected.id}/issues`}>download error file</a></p>
          <table className="table-dense"><thead><tr><th>Row</th><th>Severity</th><th>Code</th><th>Message</th></tr></thead><tbody>{selected.issues.map((i) => <tr key={i.id}><td>{i.rowNumber ?? "—"}</td><td><Badge tone={i.severity === "CRITICAL" ? "danger" : i.severity === "WARNING" ? "warning" : "info"}>{i.severity.toLowerCase()}</Badge></td><td className="text-xs">{i.code}</td><td className="text-xs">{i.message}</td></tr>)}{selected.issues.length === 0 && <tr><td colSpan={4} className="text-muted">No issues.</td></tr>}</tbody></table>
        </Card>
      )}
    </>
  );
}
