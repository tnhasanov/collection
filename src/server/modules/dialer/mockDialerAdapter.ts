import type {
  AgentStateCommand,
  CommandReceipt,
  ConfirmedAgentState,
  DialerAdapter,
  DialerCapabilities,
  NormalizedProviderEvent,
  ProviderInteraction,
  ReconciliationResult,
  RoutingTicket,
  SupportedCallControl,
  WithdrawCommand,
  WrapUpCommand,
} from "@/server/modules/dialer/contract";
import { getClockSync } from "@/server/clock";

export const MOCK_PROVIDER = "MOCK_DIALER";

/**
 * Deterministic mock provider. It never places a real call. Routing tickets produce a seeded sequence
 * of provider events (attempt started → ringing → answered/no answer → bridged → ended) that the worker
 * delivers with realistic delays. Behaviour is selected from the dialed number so demos are repeatable:
 *   - numbers ending in 1,2,3,5,7,8,9: answered and bridged
 *   - ending in 4: no answer; ending in 6: busy; ending in 0: unreachable
 *   - "+9945510000**" alternative numbers: machine/voicemail
 * Test hooks (correlation id substrings): "fail-wrapup" → wrap-up acknowledgment UNKNOWN; "reject-dial" → ticket
 * REJECTED; "unknown-withdraw" → withdrawal UNKNOWN; "reject-end" → END REJECTED; "unknown-control" → control UNKNOWN.
 *
 * Its in-memory view is rebuilt from persisted application facts after a restart (hydrate) and exported for
 * reconciliation (snapshot), so a worker restart never leaves calls or agents in an unknown state.
 */
export interface MockScript {
  steps: { delayMs: number; event: NormalizedProviderEvent }[];
  technicalResult: ProviderInteraction["technicalResult"];
}

export interface MockProviderSnapshot {
  interactions: ProviderInteraction[];
  agentStates: ConfirmedAgentState[];
}

export class MockDialerAdapter implements DialerAdapter {
  private receipts = new Map<string, CommandReceipt>();
  private agentStates = new Map<string, ConfirmedAgentState>();
  private interactions = new Map<string, ProviderInteraction>();
  private unknownCommands = new Set<string>();

  constructor(private readonly now: () => Date = () => getClockSync().now()) {}

  async capabilities(): Promise<DialerCapabilities> {
    return {
      provider: MOCK_PROVIDER,
      version: "1.1.0-demo",
      mode: "MOCK",
      eventSubscription: true,
      screenPopMetadata: true,
      agentStateControl: true,
      callControls: { mute: true, hold: true, transfer: false, end: true, manualDial: true },
      wrapUpSubmission: true,
      wrapUpTimeoutConfigurable: true,
      preDialEligibilityHook: true,
      contactWithdrawal: true,
      priorityPreservation: true,
      callbacks: true,
      reconciliation: true,
      activeCallLookupAfterReconnect: true,
      dialingModes: ["PROGRESSIVE", "PREVIEW"],
    };
  }

  private receipt(key: string, status: CommandReceipt["status"], extra: Partial<CommandReceipt> = {}): CommandReceipt {
    const existing = this.receipts.get(key);
    if (existing) return existing; // idempotent: same key → same receipt
    const r: CommandReceipt = { idempotencyKey: key, status, at: this.now().toISOString(), ...extra };
    this.receipts.set(key, r);
    return r;
  }

  async getAgentState(agentRef: string): Promise<ConfirmedAgentState> {
    return this.agentStates.get(agentRef) ?? { agentRef, state: "OFFLINE", since: this.now().toISOString(), activeInteractionRef: null, connectionHealthy: true };
  }

  async setAgentState(command: AgentStateCommand): Promise<CommandReceipt> {
    const current = await this.getAgentState(command.agentRef);
    if (["TALKING", "DIALING", "RESERVED"].includes(current.state) && command.state === "READY") {
      return this.receipt(command.idempotencyKey, "REJECTED", { message: "Agent has an active voice interaction" });
    }
    this.agentStates.set(command.agentRef, { agentRef: command.agentRef, state: command.state, since: this.now().toISOString(), activeInteractionRef: null, connectionHealthy: true });
    return this.receipt(command.idempotencyKey, "CONFIRMED", { providerRef: `mock-state-${command.agentRef}-${command.state}` });
  }

  /** Builds the deterministic event script for a ticket (used by the worker to schedule deliveries). */
  scriptFor(ticket: RoutingTicket): MockScript {
    const ref = `mock-call-${ticket.correlationId}`;
    const last = ticket.dialNumber.slice(-1);
    const alt = ticket.dialNumber.startsWith("+9945510");
    const base = (type: NormalizedProviderEvent["eventType"], delayMs: number, payload: Record<string, unknown> = {}) => ({
      delayMs,
      event: {
        provider: MOCK_PROVIDER,
        providerEventId: `${ref}:${type}`,
        eventType: type,
        occurredAt: new Date(this.now().getTime() + delayMs).toISOString(),
        agentRef: ticket.dialerAgentRef,
        providerInteractionRef: ref,
        correlationId: ticket.correlationId,
        payload: { reservationId: ticket.reservationId, ...payload },
      } satisfies NormalizedProviderEvent,
    });
    let technicalResult: ProviderInteraction["technicalResult"];
    if (alt) technicalResult = "MACHINE";
    else if (last === "4") technicalResult = "NO_ANSWER";
    else if (last === "6") technicalResult = "BUSY";
    else if (last === "0") technicalResult = "UNREACHABLE";
    else technicalResult = "ANSWERED";

    const steps = [base("reservation.assigned", 300), base("attempt.started", 1200), base("customer.ringing", 2200)];
    if (technicalResult === "ANSWERED") {
      steps.push(base("customer.answered", 5200), base("agent.bridged", 5700, { technicalResult: "ANSWERED" }));
    } else {
      const delay = technicalResult === "NO_ANSWER" ? 14000 : technicalResult === "MACHINE" ? 7000 : 4000;
      steps.push(base("call.ended", delay, { technicalResult, reason: technicalResult }));
    }
    this.interactions.set(ref, { providerInteractionRef: ref, correlationId: ticket.correlationId, state: "DIALING", technicalResult: null, startedAt: this.now().toISOString(), answeredAt: null, endedAt: null, agentRef: ticket.dialerAgentRef, muted: false, held: false });
    return { steps, technicalResult };
  }

  async authorizeOrPublishWork(ticket: RoutingTicket): Promise<CommandReceipt> {
    if (ticket.correlationId.includes("reject-dial")) return this.receipt(ticket.idempotencyKey, "REJECTED", { message: "Mock provider rejected the routing ticket" });
    this.agentStates.set(ticket.dialerAgentRef, { agentRef: ticket.dialerAgentRef, state: "RESERVED", since: this.now().toISOString(), activeInteractionRef: `mock-call-${ticket.correlationId}`, connectionHealthy: true });
    return this.receipt(ticket.idempotencyKey, "CONFIRMED", { providerRef: `mock-ticket-${ticket.correlationId}` });
  }

  async withdrawWork(command: WithdrawCommand): Promise<CommandReceipt> {
    const ref = `mock-call-${command.correlationId}`;
    const call = this.interactions.get(ref);
    if (call && call.state === "CONNECTED") return this.receipt(command.idempotencyKey, "REJECTED", { message: "Call already connected; withdrawal not possible" });
    if (call) this.interactions.set(ref, { ...call, state: "ENDED", technicalResult: "CANCELLED", endedAt: this.now().toISOString() });
    if (command.reason.includes("unknown-withdraw")) {
      this.unknownCommands.add(command.idempotencyKey);
      return this.receipt(command.idempotencyKey, "UNKNOWN", { message: "Provider timeout; result unknown until reconciled" });
    }
    return this.receipt(command.idempotencyKey, "CONFIRMED", { providerRef: `mock-withdraw-${command.correlationId}` });
  }

  /** Provider-confirmed call controls: mute/hold flags live on the provider interaction; END ends it. */
  async requestCallControl(command: SupportedCallControl): Promise<CommandReceipt> {
    if (command.action === "TRANSFER") return this.receipt(command.idempotencyKey, "REJECTED", { message: "Transfer is not supported by the mock provider" });
    const call = this.interactions.get(command.providerInteractionRef);
    if (!call) return this.receipt(command.idempotencyKey, "REJECTED", { message: "Unknown interaction at the provider" });
    if (command.correlationId.includes("unknown-control")) {
      this.unknownCommands.add(command.idempotencyKey);
      return this.receipt(command.idempotencyKey, "UNKNOWN", { message: "Provider did not answer the control request (simulated timeout)" });
    }
    if (command.action === "END" && command.correlationId.includes("reject-end")) return this.receipt(command.idempotencyKey, "REJECTED", { message: "Provider refused END (simulated)" });
    if (call.state === "ENDED") return this.receipt(command.idempotencyKey, "REJECTED", { message: "Call already ended" });
    if (call.state !== "CONNECTED" && command.action !== "END") return this.receipt(command.idempotencyKey, "REJECTED", { message: `Control ${command.action} requires a connected call (state ${call.state})` });
    switch (command.action) {
      case "MUTE":
        this.interactions.set(command.providerInteractionRef, { ...call, muted: true });
        break;
      case "UNMUTE":
        this.interactions.set(command.providerInteractionRef, { ...call, muted: false });
        break;
      case "HOLD":
        this.interactions.set(command.providerInteractionRef, { ...call, held: true });
        break;
      case "RESUME":
        this.interactions.set(command.providerInteractionRef, { ...call, held: false });
        break;
      case "END":
        this.interactions.set(command.providerInteractionRef, { ...call, state: "ENDED", endedAt: this.now().toISOString(), technicalResult: call.technicalResult ?? "ANSWERED", muted: false, held: false });
        break;
    }
    return this.receipt(command.idempotencyKey, "CONFIRMED", { providerRef: `mock-ctl-${command.action}-${command.correlationId}` });
  }

  async submitWrapUp(command: WrapUpCommand): Promise<CommandReceipt> {
    if (command.correlationId.includes("fail-wrapup")) {
      this.unknownCommands.add(command.idempotencyKey);
      return this.receipt(command.idempotencyKey, "UNKNOWN", { message: "Provider did not acknowledge the wrap-up (simulated timeout)" });
    }
    this.agentStates.set(command.agentRef, { agentRef: command.agentRef, state: command.nextState, since: this.now().toISOString(), activeInteractionRef: null, connectionHealthy: true });
    return this.receipt(command.idempotencyKey, "CONFIRMED", { providerRef: `mock-wrapup-${command.correlationId}` });
  }

  async getInteraction(providerInteractionRef: string): Promise<ProviderInteraction> {
    return this.interactions.get(providerInteractionRef) ?? { providerInteractionRef, correlationId: null, state: "UNKNOWN", technicalResult: null, startedAt: null, answeredAt: null, endedAt: null, agentRef: null };
  }

  async reconcile(since: string): Promise<ReconciliationResult> {
    return { since, interactions: [...this.interactions.values()], agentStates: [...this.agentStates.values()], unknownCommands: [...this.unknownCommands] };
  }

  /** Exports the provider's view (tests, diagnostics). */
  snapshot(): MockProviderSnapshot {
    return { interactions: [...this.interactions.values()], agentStates: [...this.agentStates.values()] };
  }

  /** Rebuilds the provider's view from persisted facts after a restart; existing entries win over hydrated ones. */
  hydrate(snapshot: MockProviderSnapshot) {
    for (const i of snapshot.interactions) if (!this.interactions.has(i.providerInteractionRef)) this.interactions.set(i.providerInteractionRef, { muted: false, held: false, ...i });
    for (const a of snapshot.agentStates) if (!this.agentStates.has(a.agentRef)) this.agentStates.set(a.agentRef, a);
  }

  /** Mirrors delivered events into the provider's own view (what a reconcile/getAgentState would report after a reconnect). */
  applyEvent(event: NormalizedProviderEvent) {
    const ref = event.providerInteractionRef;
    if (!ref) return;
    const call = this.interactions.get(ref);
    if (!call) return;
    if (event.eventType === "customer.answered" || event.eventType === "agent.bridged") this.interactions.set(ref, { ...call, state: "CONNECTED", technicalResult: "ANSWERED", answeredAt: call.answeredAt ?? event.occurredAt });
    if (event.eventType === "call.ended") this.interactions.set(ref, { ...call, state: "ENDED", technicalResult: (event.payload.technicalResult as ProviderInteraction["technicalResult"]) ?? call.technicalResult ?? "ANSWERED", endedAt: call.endedAt ?? event.occurredAt, muted: false, held: false });
    const agentRef = event.agentRef ?? call.agentRef;
    if (agentRef) {
      const current = this.agentStates.get(agentRef);
      const set = (state: ConfirmedAgentState["state"], active: string | null) => this.agentStates.set(agentRef, { agentRef, state, since: event.occurredAt, activeInteractionRef: active, connectionHealthy: current?.connectionHealthy ?? true });
      if (event.eventType === "attempt.started") set("DIALING", ref);
      if (event.eventType === "agent.bridged") set("TALKING", ref);
      if (event.eventType === "call.ended") set(this.interactions.get(ref)?.answeredAt ? "ACW" : (current?.state === "DIALING" || current?.state === "RESERVED" ? "READY" : current?.state ?? "READY"), null);
    }
  }
}

let shared: MockDialerAdapter | null = null;
/** The shared adapter stamps every provider event with the domain clock (demo offset aware), never the host clock. */
export function getDialerAdapter(): DialerAdapter & MockDialerAdapter {
  if (process.env.CONNECTOR_DIALER && process.env.CONNECTOR_DIALER !== "mock") {
    throw new Error(`Dialer connector '${process.env.CONNECTOR_DIALER}' is not implemented; only the mock provider exists in this build`);
  }
  if (!shared) shared = new MockDialerAdapter(() => getClockSync().now());
  return shared;
}
