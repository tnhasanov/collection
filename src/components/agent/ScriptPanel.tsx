"use client";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { fmtAzn, fmtDate } from "@/lib/format";
import type { AgentContext } from "@/components/agent/types";

export function ScriptPanel({ ctx, verified, thirdParty, agentName }: { ctx: AgentContext; verified: boolean; thirdParty: boolean; agentName: string }) {
  const s = ctx.script;
  const c = ctx.customer;
  const [step, setStep] = useState(0);
  if (!s || !c) return <p className="text-sm text-muted">No published script for this language.</p>;
  const overdueLoan = c.loans.filter((l) => Number(l.totalOverdue) > 0).sort((a, b) => (a.oldestUnpaidDueDate ?? "") < (b.oldestUnpaidDueDate ?? "") ? -1 : 1)[0];
  const vars: Record<string, string> = {
    agentName,
    customerName: c.customer.displayName,
    overdueAmount: fmtAzn(c.summary.overdueDueNow, false),
    oldestDueDate: fmtDate(overdueLoan?.oldestUnpaidDueDate ?? null),
    dpd: String(c.summary.maxDpd),
    promiseAmount: "…",
    promiseDate: "…",
  };
  const bind = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  const steps = s.body.steps;
  const current = steps[Math.min(step, steps.length - 1)];
  const locked = current.requires === "RPC_VERIFIED" && !verified;
  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Guided conversation / {s.language}</h2>
          <p className="card-subtitle">
            Pinned template {s.code} v{s.version} · bound to this interaction · amounts from the fresh snapshot
          </p>
        </div>
        <Badge tone="neutral">Step {Math.min(step + 1, steps.length)} / {steps.length}</Badge>
      </div>
      <ol className="mb-3 flex flex-wrap gap-1" aria-label="Script steps">
        {steps.map((st, i) => (
          <li key={st.key}>
            <button type="button" className={`rounded px-2 py-0.5 text-xs ${i === step ? "bg-success-bg text-success font-bold" : "bg-canvas text-muted"}`} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
              {i + 1} {st.title}
            </button>
          </li>
        ))}
      </ol>
      {thirdParty ? (
        <div className="callout callout-warning">
          <p className="font-bold">Third-party script (privacy-preserving)</p>
          <p className="mt-1">{bind(s.body.thirdParty)}</p>
          <p className="mt-1 text-xs">No loan details may be disclosed to anyone other than the verified customer.</p>
        </div>
      ) : (
        <div>
          <h3 className="text-base font-bold">{current.title}</h3>
          {locked ? <p className="callout callout-warning mt-2 text-sm">Verify the right party before disclosing any debt information.</p> : <p className="mt-2 text-base leading-relaxed">{bind(current.text)}</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={step === 0} onClick={() => setStep((x) => Math.max(0, x - 1))}>
          Previous
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={step >= steps.length - 1} onClick={() => setStep((x) => Math.min(steps.length - 1, x + 1))}>
          Next step
        </button>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h4 className="text-sm font-bold">Branch based on the customer response</h4>
        <ul className="mt-1 space-y-0.5 text-sm text-muted">
          {s.body.branches.map((b) => (
            <li key={b.route}>
              {b.response} → {b.route.replace(/_/g, " ").toLowerCase()}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Live payment updates appear without ending the call.</p>
      </div>
    </div>
  );
}
