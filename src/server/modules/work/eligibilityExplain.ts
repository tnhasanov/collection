import type { Db } from "@/server/db";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";

/**
 * Live explanation of why a follow-up item can or cannot be worked now. The contact policy is evaluated again at the
 * current business clock (never read from reasons stored at an earlier refresh), so a callback whose due time has
 * passed no longer shows "not yet due", and the blocker that applies now is shown with the time it ends. Nothing here
 * changes eligibility or bypasses a restriction.
 */
export interface Blocker {
  code: string;
  until: Date | null;
}

export interface WorkItemExplanation {
  eligible: boolean;
  blockers: Blocker[];
  /** When every timed blocker known now has ended (null if a blocker has no end, e.g. stale data or an open dispute). */
  nextEligibleAt: Date | null;
  /** True when at least one blocker has no known end time. */
  openEnded: boolean;
  due: "OVERDUE" | "TODAY" | "LATER" | "NONE";
}

const VOICE_TYPES = ["CALL", "CALLBACK"];

export async function explainWorkItem(db: Db, wi: { type: string; customerId: string; dueAt: Date | null; reason: string | null; campaignCode: string | null }, now: Date, todayEnd: Date): Promise<WorkItemExplanation> {
  const due = !wi.dueAt ? "NONE" : wi.dueAt.getTime() < now.getTime() ? "OVERDUE" : wi.dueAt.getTime() <= todayEnd.getTime() ? "TODAY" : "LATER";
  if (!VOICE_TYPES.includes(wi.type)) return { eligible: true, blockers: [], nextEligibleAt: wi.dueAt, openEnded: false, due };
  const dueCallback = wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? now, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null;
  const { decision } = await evaluateCustomerEligibility(db, wi.customerId, { channel: "VOICE", now, dueCallback, campaignCode: wi.campaignCode });
  const failed = decision.checks.filter((c) => !c.passed);
  const blockers = failed.map((c) => ({ code: c.code, until: c.blockedUntil ?? null }));
  const openEnded = blockers.some((b) => !b.until);
  return { eligible: decision.eligible, blockers, nextEligibleAt: openEnded ? null : decision.nextAllowedAt, openEnded, due };
}

/** Parses the stored callback reason prefix ("CUSTOMER_REQUESTED: …" / "AGENT_PROPOSED: …"). */
export function parseCallbackReason(reason: string | null | undefined): { origin: "CUSTOMER_REQUESTED" | "AGENT_PROPOSED" | null; text: string } {
  if (!reason) return { origin: null, text: "" };
  const m = /^(CUSTOMER_REQUESTED|AGENT_PROPOSED):\s*(.*)$/s.exec(reason.trim());
  if (!m) return { origin: null, text: reason.replace(/\s*MANUAL:.*$/, "").trim() };
  return { origin: m[1] as "CUSTOMER_REQUESTED" | "AGENT_PROPOSED", text: m[2].replace(/\s*MANUAL:.*$/, "").trim() };
}
