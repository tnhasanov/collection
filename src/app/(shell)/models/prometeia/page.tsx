import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { Badge, Callout, Card, Dl, type Tone } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { PROMETEIA_DRAFT_TREE, DRAFT_ROLL_RATES } from "@/server/modules/decisions/prometeiaDraftModel";
import { DEMO_ONLY_DPD_1_3_POLICY } from "@/server/modules/decisions/DEMO_ONLY_dpd1to3_policy";
import type { RulePackage, Condition } from "@/server/modules/decisions/ruleInterpreter";
import { compareRulePackages, runGoldenCases, sampleScores } from "@/server/modules/models/modelService";
import { TestScorePanel } from "@/components/models/TestScorePanel";
import { ModelImportForm } from "@/components/models/ModelImportForm";

export const dynamic = "force-dynamic";
const STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", TESTED: "info", APPROVED: "brand", ACTIVE: "success", RETIRED: "neutral", REJECTED: "danger" };

function condText(c: Condition): string {
  if ("all" in c) return c.all.map(condText).join(" AND ");
  if ("any" in c) return "(" + c.any.map(condText).join(" OR ") + ")";
  return `${c.feature} ${c.cmp} ${c.value}`;
}
type TreeNode = { node?: string; yes?: TreeNode; no?: TreeNode; leaf?: number; note?: string };
function Tree({ n, pkg, depth = 0 }: { n: TreeNode; pkg: RulePackage; depth?: number }) {
  if (n.leaf) {
    const leaf = pkg.leaves.find((l) => l.riskClass === n.leaf);
    return <li className="ml-3 list-none"><span className="rounded bg-brand-light px-1.5 py-0.5 text-xs font-medium">Class {n.leaf} · p={leaf?.probability ?? "?"}</span>{n.note && <span className="ml-1 text-xs text-warning">({n.note})</span>}</li>;
  }
  return (
    <li className={depth ? "ml-3 list-none" : "list-none"}>
      <span className="font-mono text-xs">{n.node}?</span>
      <ul className="border-l border-line pl-2">
        <li className="list-none text-xs text-muted">yes →<ul>{n.yes && <Tree n={n.yes} pkg={pkg} depth={depth + 1} />}</ul></li>
        <li className="list-none text-xs text-muted">no →<ul>{n.no && <Tree n={n.no} pkg={pkg} depth={depth + 1} />}</ul></li>
      </ul>
    </li>
  );
}

export default async function ModelsPage({ searchParams }: { searchParams: Promise<{ v?: string; cmp?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "model.read")) redirect("/access-denied");
  const sp = await searchParams;
  const versions = await prisma.modelVersion.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  const active = versions.find((v) => v.status === "ACTIVE") ?? null;
  const selected = versions.find((v) => v.id === sp.v) ?? active ?? versions[0] ?? null;
  const compareTo = versions.find((v) => v.id === sp.cmp) ?? (selected && active && selected.id !== active.id ? active : versions.find((v) => v.id !== selected?.id) ?? null);
  const pkg = selected ? (selected.rulesJson as unknown as RulePackage) : null;
  const golden = pkg ? runGoldenCases(pkg) : null;
  const comparison = pkg && compareTo ? compareRulePackages(compareTo.rulesJson as unknown as RulePackage, pkg) : null;
  const samples = pkg ? await sampleScores(prisma, pkg, ["C-DEMO-001", "C-DEMO-002", "C-DEMO-010", "C-DEMO-019", "C-DEMO-012", "C-DEMO-007"]) : [];
  const scoreStats = await prisma.score.groupBy({ by: ["riskClass", "status"], _count: { _all: true }, where: { modelVersionId: active?.id ?? undefined } });
  const latestRun = await prisma.decisionRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
  const approvals = await prisma.approvalRequest.findMany({ where: { objectType: "ModelVersion", status: { in: ["PENDING", "INFO_REQUESTED"] } }, select: { id: true, objectId: true, status: true } });
  const features = (selected?.featureDictionary as unknown as (RulePackage["features"][number] & { sourceColumn?: string | null })[]) ?? [];
  const issues = (selected?.unresolvedIssues as unknown as string[]) ?? [];

  return (
    <>
      <PageHeader kicker="S13 / Prometeia model and feature mapping" title="Prometeia early-arrears roll model" lead="Register, validated rule package, feature mapping, readable tree, test-case scoring and version comparison. Probabilities are a transcription of the provider's draft rule table; nothing is inferred from OCR alone." />
      <Callout tone="warning"><strong>Unresolved source issues are open.</strong> The active version is a DRAFT transcription activated for the synthetic demo only. Production activation requires a signed executable artifact, golden cases and independent approval (S11).</Callout>

      <div className="mt-3 grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card title="Model register" subtitle="Provider · model · version · status">
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id}>
                  <a href={`/models/prometeia?v=${v.id}`} className={`block rounded border px-2 py-1.5 text-sm hover:bg-canvas ${v.id === selected?.id ? "border-brand bg-brand-light" : "border-line"}`} aria-current={v.id === selected?.id ? "page" : undefined}>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{v.version}</span><Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status.toLowerCase()}</Badge></div>
                    <div className="text-xs text-muted">{v.provider} · {v.modelCode}</div>
                    {approvals.find((a) => a.objectId === v.id) && <div className="text-xs text-info">approval {approvals.find((a) => a.objectId === v.id)!.status.toLowerCase().replace("_", " ")}</div>}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          {hasPermission(user.role, "model.draft") && <Card title="Import rule package" subtitle="Validated JSON; rules are data, never executed code"><ModelImportForm /></Card>}
          <Card title="Other probability sources" subtitle="Not part of the Prometeia model">
            <Dl items={[
              { label: "DPD 1–3", value: <span>{DEMO_ONLY_DPD_1_3_POLICY.code} <Badge tone="warning">DEMO ONLY</Badge><br /><span className="text-xs text-muted">{DEMO_ONLY_DPD_1_3_POLICY.bands.map((b) => `≤${Number.isFinite(b.maxDpdL3mUpTo) ? b.maxDpdL3mUpTo : "∞"} → ${b.probability}`).join(" · ")}; not production-activatable</span></span> },
              { label: "DPD 11–30", value: <span>Draft empirical roll rates: {Object.entries(DRAFT_ROLL_RATES).map(([k, v]) => `${k.replace("DPD_", "").replace("_", "–")}: ${v}`).join(" · ")}</span> },
              { label: "DPD 31+", value: "No approved early-arrears probability → later-stage review (Unscored)" },
            ]} />
          </Card>
        </div>

        <div className="space-y-3">
          {selected && pkg ? (
            <>
              <Card title={`${selected.provider} · ${selected.modelCode} · ${selected.version}`} actions={<Badge tone={STATUS_TONE[selected.status] ?? "neutral"}>{selected.status.toLowerCase()}</Badge>}>
                <Dl items={[
                  { label: "Checksum", value: <code className="text-xs">{selected.checksum ?? "—"}</code> },
                  { label: "Owner", value: selected.owner },
                  { label: "Source", value: selected.source },
                  { label: "Observation frequency", value: selected.observationFrequency },
                  { label: "Target population", value: selected.targetPopulation },
                  { label: "Target event / horizon", value: `${selected.targetEvent} · ${selected.horizon}` },
                  { label: "Approval", value: selected.approvedBy ? `${selected.approvedBy} · ${fmtDateTime(selected.approvedAt)}` : "Not approved" },
                  { label: "Validity", value: selected.validFrom ? `${fmtDate(selected.validFrom)} → ${selected.validTo ? fmtDate(selected.validTo) : "open"}` : "—" },
                  { label: "Notes", value: selected.notes ?? "—" },
                ]} />
              </Card>

              <Card title="Unresolved issues (source conflicts)" subtitle="Preserved verbatim from the model documentation; must be resolved before production activation" className="border-warning">
                {issues.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{issues.map((i, idx) => <li key={idx}>{i}</li>)}</ol> : <p className="text-sm text-muted">None recorded.</p>}
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card title="Rule table (eight leaves)" subtitle="Page 10 of the deck; probabilities per class">
                  <table className="table-dense"><thead><tr><th>Class</th><th>Rule</th><th className="text-right">p(roll)</th></tr></thead>
                    <tbody>{pkg.leaves.map((l) => <tr key={l.riskClass}><td className="font-medium">{l.riskClass}</td><td className="font-mono text-xs">{condText(l.rule)}</td><td className="text-right">{l.probability}</td></tr>)}</tbody></table>
                </Card>
                <Card title="Readable tree" subtitle="Structure from page 11; the Class 7 leaf label conflict is flagged">
                  <ul className="text-sm"><Tree n={PROMETEIA_DRAFT_TREE as TreeNode} pkg={pkg} /></ul>
                </Card>
              </div>

              <Card title="Feature mapping" subtitle="Source columns → canonical features; units, transforms and null rules">
                <table className="table-dense"><thead><tr><th>Canonical feature</th><th>Source column / aliases</th><th>Unit</th><th>Null rule</th><th>Description</th></tr></thead>
                  <tbody>{features.map((f) => <tr key={f.name}><td className="font-mono text-xs">{f.name}</td><td className="text-xs">{f.sourceColumn ?? "—"}{f.aliases?.length ? ` · aliases: ${f.aliases.join(", ")}` : ""}</td><td className="text-xs">{f.unit ?? "—"}</td><td className="text-xs">null/NaN → UNKNOWN (never zero) → Unscored if on the path</td><td className="text-xs text-muted">{f.description}</td></tr>)}</tbody></table>
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card title={`Golden cases · ${golden!.passed}/${golden!.total} pass`} subtitle="Every leaf, boundaries, missing input and alias handling">
                  <table className="table-dense"><thead><tr><th>Case</th><th>Expected</th><th>Got</th><th></th></tr></thead>
                    <tbody>{golden!.results.map((r) => <tr key={r.name}><td className="text-xs">{r.name}</td><td className="text-xs">{String(r.expected)}</td><td className="text-xs">{String(r.got)}</td><td>{r.pass ? <Badge tone="success">pass</Badge> : <Badge tone="danger">fail</Badge>}</td></tr>)}</tbody></table>
                </Card>
                <Card title="Sample score preview" subtitle="Latest complete monthly feature snapshots through this package (read-only)">
                  <table className="table-dense"><thead><tr><th>Customer</th><th>As of</th><th>Result</th></tr></thead>
                    <tbody>{samples.map((s) => <tr key={s.customerId}><td><a href={`/customers/${s.customerId}`}>{s.customerId}</a></td><td className="text-xs">{s.asOf}</td><td className="text-xs">{s.status === "SCORED" ? `Class ${s.riskClass} · p=${s.probability}` : <span className="text-danger">Unscored: {s.reasons.join(", ")}</span>}</td></tr>)}{samples.length === 0 && <tr><td colSpan={3} className="text-muted">No feature snapshots for the sample customers.</td></tr>}</tbody></table>
                  {active && (
                    <p className="mt-2 text-xs text-muted">Live class distribution (active version, run {latestRun?.id.slice(-6) ?? "—"}): {scoreStats.filter((s) => s.status === "SCORED").sort((a, b) => (a.riskClass ?? 0) - (b.riskClass ?? 0)).map((s) => `C${s.riskClass}: ${s._count._all}`).join(" · ") || "no scores"}; unscored {scoreStats.filter((s) => s.status === "UNSCORED").reduce((a, s) => a + s._count._all, 0)}.</p>
                  )}
                </Card>
              </div>

              {comparison && compareTo && (
                <Card title={`Compare versions · ${compareTo.version} (A) vs ${selected.version} (B)`} subtitle="Leaf-level differences of rules and probabilities">
                  <table className="table-dense"><thead><tr><th>Class</th><th>p (A)</th><th>p (B)</th><th>Rule</th></tr></thead>
                    <tbody>{comparison.map((c) => <tr key={c.riskClass}><td>{c.riskClass}</td><td>{c.probabilityA ?? "—"}</td><td className={c.probabilityChanged ? "font-medium text-warning" : ""}>{c.probabilityB ?? "—"}</td><td>{c.missingInA ? <Badge tone="info">new in B</Badge> : c.missingInB ? <Badge tone="danger">removed in B</Badge> : c.ruleChanged ? <Badge tone="warning">rule changed</Badge> : <Badge tone="neutral">identical</Badge>}</td></tr>)}</tbody></table>
                  <p className="mt-1 text-xs text-muted">Compare against: {versions.filter((v) => v.id !== selected.id).map((v) => <a key={v.id} className="mr-2" href={`/models/prometeia?v=${selected.id}&cmp=${v.id}`}>{v.version}</a>)}</p>
                </Card>
              )}

              <Card title="Test case" subtitle="Features, as-of date, decision path, class, probability, ERA, bucket, chosen action and reason codes">
                <TestScorePanel modelVersionId={selected.id} featureNames={pkg.features.map((f) => f.name)} />
              </Card>
            </>
          ) : <Card><p className="text-sm text-muted">No model version registered.</p></Card>}
        </div>
      </div>
    </>
  );
}
