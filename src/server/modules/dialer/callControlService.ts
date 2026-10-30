import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import {
  COMMAND_REQUESTED_STALE_MS,
  END_ACCEPTED_STALE_MS,
  isOpenCommand,
  normalizeControlState,
  readControlState,
  type CallControlAction,
  type CallControlState,
  type CommandReceipt,
  type ControlCommand,
  type ControlCommandAction,
  type ProviderInteraction,
} from "@/server/modules/dialer/contract";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, forbidden, notFound } from "@/server/errors";

/**
 * Call-control command lifecycle. Every change to an interaction's control state goes through `withControlState`,
 * which locks the interaction row, so the web request that asks for a command, the worker that executes it and the
 * event ingestion that observes its effect never overwrite each other.
 *
 * Rules:
 *  - each attempt gets its own idempotency key (`ctl:<ACTION>:<interactionId>:<attempt>`); a retry is a new attempt,
 *    a double click is the same attempt (no second command while one is open and not stale);
 *  - REQUESTED → ACCEPTED (provider receipt) → COMPLETED (effect observed: flags for mute/hold, call.ended for END)
 *    or FAILED (rejected, dead-lettered, never dispatched);
 *  - nothing here ends a call: only a provider call.ended event (or a supervisor force-end) does.
 */

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function withControlState<T>(prisma: PrismaClient, interactionId: string, fn: (state: CallControlState, interaction: { id: string; status: string; agentUserId: string | null; customerId: string; correlationId: string; providerInteractionRef: string | null; caseId: string | null }, tx: Tx) => Promise<{ state: CallControlState | null; result: T }>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Interaction" WHERE id = ${interactionId} FOR UPDATE`;
    const interaction = await tx.interaction.findUnique({ where: { id: interactionId }, select: { id: true, status: true, agentUserId: true, customerId: true, correlationId: true, providerInteractionRef: true, caseId: true, controlState: true } });
    if (!interaction) throw notFound("Interaction not found");
    const { state, result } = await fn(readControlState(interaction.controlState), interaction, tx);
    if (state) await tx.interaction.update({ where: { id: interactionId }, data: { controlState: normalizeControlState(state) as never } });
    return result;
  });
}

const familyOf = (a: ControlCommandAction) => (a === "MUTE" || a === "UNMUTE" ? "MUTE" : a === "HOLD" || a === "RESUME" ? "HOLD" : a);

function isStale(c: ControlCommand, now: Date) {
  const age = (iso: string | null | undefined) => (iso ? now.getTime() - new Date(iso).getTime() : 0);
  return (c.status === "REQUESTED" && age(c.requestedAt) > COMMAND_REQUESTED_STALE_MS) || (c.action === "END" && c.status === "ACCEPTED" && age(c.acceptedAt ?? c.requestedAt) > END_ACCEPTED_STALE_MS);
}

function patchCommand(state: CallControlState, key: string, patch: Partial<ControlCommand>): CallControlState {
  return { ...state, commands: state.commands.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

export interface RequestControlResult {
  status: "REQUESTED" | "DUPLICATE" | "ALREADY_IN_STATE";
  command: ControlCommand | null;
}

/**
 * Agent request for a call control. RECONCILE asks the worker to compare the call with the provider's view now
 * (recovery for an unresolved command); it never ends the call by itself.
 */
export async function requestCallControl(prisma: PrismaClient, params: { interactionId: string; userId: string; action: ControlCommandAction; agentRef: string | null; now: Date }): Promise<RequestControlResult> {
  const { interactionId, action, now } = params;
  return withControlState<RequestControlResult>(prisma, interactionId, async (current, interaction, tx) => {
    if (interaction.agentUserId !== params.userId) throw forbidden("Not your interaction");
    if (interaction.status !== "OPEN") throw conflict("The call is not active", { code: "CALL_NOT_ACTIVE" });
    let state = await syncCommandsWithOutbox(tx, interactionId, current, now);
    if ((action === "MUTE" && state.muted) || (action === "UNMUTE" && !state.muted) || (action === "HOLD" && state.held) || (action === "RESUME" && !state.held)) {
      return { state, result: { status: "ALREADY_IN_STATE", command: null } };
    }
    const open = state.commands.filter((c) => familyOf(c.action) === familyOf(action) && isOpenCommand(c));
    const fresh = open.find((c) => !isStale(c, now));
    if (fresh) return { state, result: { status: "DUPLICATE", command: fresh } };
    // A stale open attempt is superseded by the new one: it is marked FAILED (the call itself is untouched).
    for (const c of open) state = patchCommand(state, c.key, { status: "FAILED", failedAt: now.toISOString(), error: c.error ?? "No provider confirmation in time; superseded by a new attempt" });
    const attempt = state.commands.filter((c) => c.action === action).length + 1;
    const key = `ctl:${action}:${interactionId}:${attempt}`;
    const command: ControlCommand = { key, action, attempt, status: "REQUESTED", requestedAt: now.toISOString(), requestedBy: params.userId, providerAttempts: 0 };
    state = { ...state, commands: [...state.commands, command], lastError: null, lastErrorAt: null, endRequestedAt: action === "END" ? now.toISOString() : state.endRequestedAt, updatedAt: now.toISOString() };
    const topic = action === "RECONCILE" ? "dialer.reconcileInteraction" : "dialer.callControl";
    const queued = await enqueueOutbox(tx, topic, { interactionId, action, agentRef: params.agentRef, key }, key, interaction.correlationId);
    if (queued.duplicate) {
      // Never leave a command pending that no worker will pick up.
      state = patchCommand(state, key, { status: "FAILED", failedAt: now.toISOString(), error: "Command was not dispatched (duplicate key); retry" });
    }
    await appendAudit(tx, { actorUserId: params.userId, action: `call.control.${action.toLowerCase()}.requested`, objectType: "Interaction", objectId: interactionId, customerId: interaction.customerId, correlationId: interaction.correlationId, changes: { key, attempt } });
    return { state, result: { status: "REQUESTED", command: queued.duplicate ? { ...command, status: "FAILED" } : command } };
  });
}

/**
 * Brings open commands in line with what the outbox and the receipt log know: a command whose message was
 * dead-lettered, never created, or answered while the state update was lost is resolved here (page reload, reconnect,
 * worker restart). Used inside a locked transaction.
 */
export async function syncCommandsWithOutbox(db: Db, interactionId: string, state: CallControlState, now: Date): Promise<CallControlState> {
  let next = state;
  for (const c of state.commands.filter(isOpenCommand)) {
    const message = await db.outboxMessage.findUnique({ where: { idempotencyKey: c.key } });
    if (!message) {
      next = patchCommand(next, c.key, { status: "FAILED", failedAt: now.toISOString(), error: "Command was not dispatched to the provider; retry" });
      continue;
    }
    if (message.status === "DEAD") {
      next = patchCommand(next, c.key, { status: "FAILED", failedAt: now.toISOString(), error: `Provider did not answer after ${message.attempts} attempts${message.lastError ? `: ${message.lastError}` : ""}` });
      continue;
    }
    if (message.status === "DONE" && c.status === "REQUESTED") {
      const receipt = await db.commandReceipt.findUnique({ where: { idempotencyKey: c.key } });
      if (receipt?.status === "REJECTED") next = patchCommand(next, c.key, { status: "FAILED", failedAt: now.toISOString(), error: ((receipt.responseJson as { message?: string } | null)?.message) ?? "Rejected by the provider" });
      else if (receipt?.status === "CONFIRMED") next = patchCommand(next, c.key, c.action === "END" ? { status: "ACCEPTED", acceptedAt: receipt.resolvedAt?.toISOString() ?? now.toISOString() } : { status: "COMPLETED", completedAt: now.toISOString() });
    }
  }
  if (next !== state) {
    const lastFailed = [...next.commands].reverse().find((c) => c.status === "FAILED" && c.failedAt === now.toISOString());
    if (lastFailed) next = { ...next, lastError: lastFailed.error ?? "Command failed", lastErrorAt: now.toISOString(), updatedAt: now.toISOString() };
  }
  void interactionId;
  return next;
}

/** Refreshes open commands of one interaction (context load, reconciliation job). No-op without open commands. */
export async function refreshInteractionCommands(prisma: PrismaClient, interactionId: string, now: Date) {
  const row = await prisma.interaction.findUnique({ where: { id: interactionId }, select: { controlState: true } });
  if (!row || !readControlState(row.controlState).commands.some(isOpenCommand)) return false;
  return withControlState(prisma, interactionId, async (state, _i, tx) => {
    const next = await syncCommandsWithOutbox(tx, interactionId, state, now);
    return { state: next === state ? null : next, result: next !== state };
  });
}

/**
 * Applies a provider receipt to its command. CONFIRMED mute/hold complete at once (flags follow the provider);
 * CONFIRMED END is only ACCEPTED until call.ended arrives. REJECTED fails the command; UNKNOWN keeps it REQUESTED
 * (the outbox retries with the same key) and counts the attempt.
 */
export async function applyCommandReceipt(prisma: PrismaClient, params: { interactionId: string; key: string; action: CallControlAction; receipt: CommandReceipt; provider: ProviderInteraction; now: Date }) {
  const { key, receipt, provider, now, action } = params;
  return withControlState(prisma, params.interactionId, async (state, interaction, tx) => {
    const iso = now.toISOString();
    let next = state.commands.some((c) => c.key === key) ? state : { ...state, commands: [...state.commands, { key, action, attempt: state.commands.filter((c) => c.action === action).length + 1, status: "REQUESTED" as const, requestedAt: iso }] };
    const cmd = next.commands.find((c) => c.key === key)!;
    if (receipt.status === "CONFIRMED") {
      if (action === "END") {
        next = patchCommand(next, key, { status: provider.state === "ENDED" && interaction.status !== "OPEN" ? "COMPLETED" : "ACCEPTED", acceptedAt: iso, providerAttempts: (cmd.providerAttempts ?? 0) + 1, error: null });
      } else {
        next = patchCommand(next, key, { status: "COMPLETED", acceptedAt: iso, completedAt: iso, providerAttempts: (cmd.providerAttempts ?? 0) + 1, error: null });
      }
      next = { ...next, muted: action === "MUTE" ? true : action === "UNMUTE" ? false : provider.muted ?? next.muted, held: action === "HOLD" ? true : action === "RESUME" ? false : provider.held ?? next.held, providerState: provider.state, lastError: null, lastErrorAt: null, updatedAt: iso };
      return { state: next, result: "ACCEPTED" as const };
    }
    if (receipt.status === "REJECTED") {
      const detail = `${action} rejected by the provider${receipt.message ? `: ${receipt.message}` : ""}`;
      next = patchCommand(next, key, { status: "FAILED", failedAt: iso, error: detail, providerAttempts: (cmd.providerAttempts ?? 0) + 1 });
      next = { ...next, providerState: provider.state, lastError: detail, lastErrorAt: iso, updatedAt: iso };
      if (action === "END" && interaction.status === "OPEN") await raiseControlFailure(tx, interaction, receipt, now);
      return { state: next, result: "FAILED" as const };
    }
    next = patchCommand(next, key, { providerAttempts: (cmd.providerAttempts ?? 0) + 1, note: receipt.message ?? "Provider did not answer; retrying" });
    next = { ...next, providerState: provider.state, updatedAt: iso };
    return { state: next, result: "UNKNOWN" as const };
  });
}

/** Marks a command FAILED (outbox dead-letter, missing interaction reference, …). */
export async function failCommand(prisma: PrismaClient, interactionId: string, key: string, error: string, now: Date) {
  return withControlState(prisma, interactionId, async (state, interaction, tx) => {
    const cmd = state.commands.find((c) => c.key === key);
    if (!cmd || !isOpenCommand(cmd)) return { state: null, result: false };
    const next = { ...patchCommand(state, key, { status: "FAILED", failedAt: now.toISOString(), error }), lastError: error, lastErrorAt: now.toISOString(), updatedAt: now.toISOString() };
    if (cmd.action === "END" && interaction.status === "OPEN") await raiseControlFailure(tx, interaction, { idempotencyKey: key, status: "UNKNOWN", message: error, at: now.toISOString() }, now);
    return { state: next, result: true };
  });
}

/** Records the result of a RECONCILE request. */
export async function completeReconcile(prisma: PrismaClient, interactionId: string, key: string, note: string, providerState: ProviderInteraction["state"], now: Date, failEndWith?: string | null) {
  return withControlState(prisma, interactionId, async (state) => {
    let next = state.commands.some((c) => c.key === key) ? patchCommand(state, key, { status: "COMPLETED", completedAt: now.toISOString(), note }) : state;
    if (failEndWith) for (const c of next.commands.filter((x) => x.action === "END" && isOpenCommand(x))) next = patchCommand(next, c.key, { status: "FAILED", failedAt: now.toISOString(), error: failEndWith });
    next = { ...next, providerState, ...(failEndWith ? { lastError: failEndWith, lastErrorAt: now.toISOString() } : {}), updatedAt: now.toISOString() };
    return { state: next, result: true };
  });
}

/**
 * Called when the provider reports that the call ended (or a supervisor force-ends it): every open END completes,
 * mute/hold flags clear and any earlier error is resolved. Commands are closed, never deleted (history stays).
 */
export async function completeEndCommands(prisma: PrismaClient, interactionId: string, now: Date, source: "PROVIDER" | "SUPERVISOR") {
  return withControlState(prisma, interactionId, async (state) => {
    let next = state;
    for (const c of state.commands.filter(isOpenCommand)) {
      next = patchCommand(next, c.key, c.action === "END" ? { status: "COMPLETED", completedAt: now.toISOString(), note: source === "SUPERVISOR" ? "Ended by supervisor force-end" : "Provider reported the call as ended" } : { status: "FAILED", failedAt: now.toISOString(), error: "Call ended before the command completed" });
    }
    next = { ...next, muted: false, held: false, providerState: "ENDED", lastError: null, lastErrorAt: null, updatedAt: now.toISOString() };
    return { state: next, result: true };
  });
}

async function raiseControlFailure(db: Db, interaction: { id: string; customerId: string; caseId: string | null; correlationId: string; agentUserId: string | null }, receipt: CommandReceipt, now: Date) {
  await db.exceptionCase.upsert({
    where: { dedupKey: `CALL_CONTROL_FAILURE:${interaction.id}` },
    create: { dedupKey: `CALL_CONTROL_FAILURE:${interaction.id}`, type: "CALL_CONTROL_FAILURE", severity: "CRITICAL", customerId: interaction.customerId, caseId: interaction.caseId, title: `Provider ${receipt.status === "REJECTED" ? "rejected" : "did not answer"} END for an open call; the agent cannot wrap up until it is resolved`, evidence: { interactionId: interaction.id, correlationId: interaction.correlationId, receipt, agentUserId: interaction.agentUserId } as never },
    update: { lastSeenAt: now, occurrences: { increment: 1 }, status: "OPEN" },
  });
  await appendAudit(db, { actorService: "cti-adapter", action: "call.control.end_failed", objectType: "Interaction", objectId: interaction.id, customerId: interaction.customerId, correlationId: interaction.correlationId, blocked: true, changes: { receipt } });
}
