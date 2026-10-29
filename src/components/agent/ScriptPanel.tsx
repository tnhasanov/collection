"use client";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { fmtAzn, fmtDate } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext } from "@/components/agent/types";

/** Guided conversation at reading size (16px); steps that disclose debt stay locked until the right party is verified. */
export function ScriptPanel({ ctx, locale, verified, thirdParty, agentName, showDiagnostics }: { ctx: AgentContext; locale: Locale; verified: boolean; thirdParty: boolean; agentName: string; showDiagnostics: boolean }) {
  const tt = (k: string) => t(locale, k);
  const s = ctx.script;
  const c = ctx.customer;
  const [step, setStep] = useState(0);
  if (!s || !c) return <p className="text-sm text-muted">{tt("agent.script.noScript")}</p>;
  const overdueLoan = c.loans.filter((l) => Number(l.totalOverdue) > 0).sort((a, b) => ((a.oldestUnpaidDueDate ?? "") < (b.oldestUnpaidDueDate ?? "") ? -1 : 1))[0];
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
    <div data-testid="script-panel">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">{tt("agent.script.title")} · {s.language}</h2>
          {showDiagnostics && <p className="card-subtitle">{s.code} v{s.version} · bound to this interaction</p>}
        </div>
        <Badge tone="neutral">{tt("agent.script.step")} {Math.min(step + 1, steps.length)} / {steps.length}</Badge>
      </div>
      <ol className="mb-3 flex flex-wrap gap-1" aria-label="Script steps">
        {steps.map((st, i) => (
          <li key={st.key}>
            <button type="button" className={`rounded-md px-2 py-1 text-xs ${i === step ? "bg-brand-light text-brand-dark font-semibold" : "bg-canvas text-muted"}`} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
              {i + 1} {st.title}
            </button>
          </li>
        ))}
      </ol>
      {thirdParty ? (
        <div className="callout callout-warning">
          <p className="font-semibold">{tt("agent.script.thirdParty")}</p>
          <p className="script-text mt-1">{bind(s.body.thirdParty)}</p>
          <p className="mt-1 text-xs">{tt("agent.script.thirdPartyNote")}</p>
        </div>
      ) : (
        <div>
          <h3 className="text-base font-semibold">{current.title}</h3>
          {locked ? <p className="callout callout-warning mt-2 text-sm">{tt("agent.script.locked")}</p> : <p className="script-text mt-2">{bind(current.text)}</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={step === 0} onClick={() => setStep((x) => Math.max(0, x - 1))}>{tt("agent.script.prev")}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={step >= steps.length - 1} onClick={() => setStep((x) => Math.min(steps.length - 1, x + 1))}>{tt("agent.script.next")}</button>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <h4 className="text-sm font-semibold">{tt("agent.script.branches")}</h4>
        <ul className="mt-1 space-y-0.5 text-sm text-muted">
          {s.body.branches.map((b) => (
            <li key={b.route}>{b.response} → {b.route.replace(/_/g, " ").toLowerCase()}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{tt("agent.script.liveNote")}</p>
      </div>
    </div>
  );
}
