import type { agentDesktopContext, agentMetrics, agentPanels } from "@/server/modules/agent/agentDesktopService";

/** JSON view of the server context (Dates serialized as ISO strings). */
export type JsonOf<T> = T extends Date ? string : T extends (infer U)[] ? JsonOf<U>[] : T extends object ? { [K in keyof T]: JsonOf<T[K]> } : T;
export type AgentContext = JsonOf<Awaited<ReturnType<typeof agentDesktopContext>>> & {
  workerOnline?: boolean;
  metrics?: JsonOf<Awaited<ReturnType<typeof agentMetrics>>>;
  panels?: JsonOf<Awaited<ReturnType<typeof agentPanels>>>;
};
export type OutcomeDraft = {
  identityStatus?: string;
  businessOutcome?: string;
  nonPaymentReason?: string | null;
  note?: string | null;
  ptp?: { amount: string; deadlineDate: string; coveredLoanIds: string[]; customerConfirmed: boolean } | null;
  callback?: { dueAt: string; customerRequested: boolean; ownerMode: "ME" | "POOL" } | null;
  paidClaim?: { amount?: string | null; date?: string | null; channel?: string | null; reference?: string | null } | null;
  wrongNumber?: { contactPointId: string } | null;
  dispute?: { reason: string } | null;
  support?: { type: "HARDSHIP" | "COMPLAINT" | "SPECIAL_HANDLING" | "DECEASED_LEGAL"; reason: string; reporterRelation?: "SPOUSE" | "CHILD" | "PARENT" | "SIBLING" | "RELATIVE" | "EMPLOYER" | "LEGAL_REPRESENTATIVE" | "OTHER" | null; reportSource?: string | null } | null;
  customerStatement?: { indicativePaymentDate?: string | null; indicativeAmount?: string | null; text?: string | null } | null;
  secondaryFlags?: string[];
  returnReady?: boolean;
};
