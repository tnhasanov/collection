/**
 * Provider-neutral dialer / CTI adapter contract (proposed application interface, not a vendor API).
 * The bank's actual dialer (currently an unidentified local "Orange" voice application) is mapped later;
 * the MockDialerAdapter implements this contract deterministically for the demo.
 */
export type ReceiptStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "UNKNOWN";

export interface CommandReceipt {
  idempotencyKey: string;
  status: ReceiptStatus;
  providerRef?: string;
  message?: string;
  at: string; // ISO instant
}

export interface DialerCapabilities {
  provider: string;
  version: string;
  mode: "MOCK" | "REAL";
  eventSubscription: boolean;
  screenPopMetadata: boolean;
  agentStateControl: boolean;
  callControls: { mute: boolean; hold: boolean; transfer: boolean; end: boolean; manualDial: boolean };
  wrapUpSubmission: boolean;
  wrapUpTimeoutConfigurable: boolean;
  preDialEligibilityHook: boolean;
  contactWithdrawal: boolean;
  priorityPreservation: boolean;
  callbacks: boolean;
  reconciliation: boolean;
  activeCallLookupAfterReconnect: boolean;
  dialingModes: ("PROGRESSIVE" | "PREVIEW" | "PREDICTIVE")[];
}

export type AgentStateCommandState = "READY" | "NOT_READY" | "BREAK" | "OFFLINE";

export interface AgentStateCommand {
  idempotencyKey: string;
  agentRef: string;
  state: AgentStateCommandState;
  reason?: string;
  requestedBy: string;
}

export interface ConfirmedAgentState {
  agentRef: string;
  state: "OFFLINE" | "NOT_READY" | "READY" | "RESERVED" | "DIALING" | "TALKING" | "ACW" | "BREAK" | "UNKNOWN";
  since: string;
  activeInteractionRef: string | null;
  connectionHealthy: boolean;
}

export interface RoutingTicket {
  idempotencyKey: string;
  correlationId: string;
  reservationId: string;
  workItemId: string;
  collectionCaseId: string;
  customerRef: string; // internal customer id (no identity details)
  campaignId: string;
  dialerAgentRef: string;
  contactPointRef: string;
  dialNumber: string; // masked in logs
  requiredSkills: string[];
  expiresAt: string;
  policyVersion: string;
  strategyVersion: string | null;
  decisionSnapshotId: string | null;
  authorizationRef: string;
}

export interface WithdrawCommand {
  idempotencyKey: string;
  correlationId: string;
  reservationId: string;
  reason: string;
}

export type CallControlAction = "MUTE" | "UNMUTE" | "HOLD" | "RESUME" | "TRANSFER" | "END";

export interface SupportedCallControl {
  idempotencyKey: string;
  correlationId: string;
  providerInteractionRef: string;
  action: CallControlAction;
  agentRef: string;
  transferTarget?: string;
}

export interface WrapUpCommand {
  idempotencyKey: string;
  correlationId: string;
  providerInteractionRef: string | null;
  agentRef: string;
  dispositionCode: string; // provider-level single code mapped from the business outcome
  nextState: "READY" | "NOT_READY";
}

export interface ProviderInteraction {
  providerInteractionRef: string;
  correlationId: string | null;
  state: "DIALING" | "RINGING" | "CONNECTED" | "ENDED" | "UNKNOWN";
  technicalResult: "ANSWERED" | "NO_ANSWER" | "BUSY" | "UNREACHABLE" | "FAILED" | "MACHINE" | "CANCELLED" | "UNKNOWN" | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  agentRef: string | null;
  /** Provider-confirmed call-control flags (undefined when the provider does not report them). */
  muted?: boolean;
  held?: boolean;
}

/** Application-side view of provider-confirmed call controls, stored on the interaction and shown to the agent. */
export interface CallControlState {
  muted: boolean;
  held: boolean;
  pending: { action: CallControlAction; key: string; requestedAt: string }[];
  lastError: string | null;
  lastErrorAt: string | null;
  endRequestedAt: string | null;
  providerState: ProviderInteraction["state"] | null;
  updatedAt: string | null;
}

export const EMPTY_CONTROL_STATE: CallControlState = { muted: false, held: false, pending: [], lastError: null, lastErrorAt: null, endRequestedAt: null, providerState: null, updatedAt: null };

export function readControlState(value: unknown): CallControlState {
  if (!value || typeof value !== "object") return { ...EMPTY_CONTROL_STATE, pending: [] };
  const v = value as Partial<CallControlState>;
  return { ...EMPTY_CONTROL_STATE, ...v, pending: Array.isArray(v.pending) ? v.pending : [] };
}

export interface ReconciliationResult {
  since: string;
  interactions: ProviderInteraction[];
  agentStates: ConfirmedAgentState[];
  unknownCommands: string[];
}

export type ProviderEventType =
  | "agent.state.changed"
  | "reservation.assigned"
  | "reservation.released"
  | "attempt.started"
  | "customer.ringing"
  | "customer.answered"
  | "agent.bridged"
  | "call.ended"
  | "wrapup.started"
  | "wrapup.completed"
  | "command.rejected"
  | "provider.connectivity.lost"
  | "provider.connectivity.recovered";

export interface NormalizedProviderEvent {
  provider: string;
  providerEventId: string;
  eventType: ProviderEventType;
  occurredAt: string;
  sequence?: number;
  agentRef?: string | null;
  providerInteractionRef?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
}

export interface DialerAdapter {
  capabilities(): Promise<DialerCapabilities>;
  getAgentState(agentRef: string): Promise<ConfirmedAgentState>;
  setAgentState(command: AgentStateCommand): Promise<CommandReceipt>;
  authorizeOrPublishWork(ticket: RoutingTicket): Promise<CommandReceipt>;
  withdrawWork(command: WithdrawCommand): Promise<CommandReceipt>;
  requestCallControl(command: SupportedCallControl): Promise<CommandReceipt>;
  submitWrapUp(command: WrapUpCommand): Promise<CommandReceipt>;
  getInteraction(providerInteractionRef: string): Promise<ProviderInteraction>;
  reconcile(since: string): Promise<ReconciliationResult>;
}

/** Provider disposition mapping (single provider code ⇐ richer business outcome). */
export const PROVIDER_DISPOSITION_MAP: Record<string, string> = {
  PTP: "RPC_PTP",
  PARTIAL_COMMITMENT: "RPC_PTP",
  NO_COMMITMENT: "RPC_NO_COMMIT",
  CALLBACK_REQUESTED: "RPC_CALLBACK",
  ALREADY_PAID_CLAIM: "RPC_CLAIM",
  DISPUTE: "RPC_DISPUTE",
  SUPPORT_NEEDED: "RPC_SUPPORT",
  REFUSED: "RPC_REFUSED",
  SPECIAL_REFERRAL: "SPECIAL",
  NO_CONVERSATION: "NO_RPC",
};

export function maskNumber(value: string): string {
  if (value.length < 6) return "***";
  return `${value.slice(0, 5)}***${value.slice(-2)}`;
}
