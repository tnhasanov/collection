import { DateTime } from "luxon";
import type { Db } from "@/server/db";
import { BAKU_ZONE } from "@/server/dates";
import { dec, money } from "@/server/money";
import { getOutboundControls, getSetting } from "@/server/modules/settings/settingsService";

/** Supervisor live view and team grid. Metric definitions match the agent dashboard and METRIC_DICTIONARY.md. */
export async function liveSupervision(db: Db, now: Date) {
  const start = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const agents = await db.user.findMany({ where: { isActive: true, agentProfile: { isNot: null } }, include: { agentProfile: true, team: true, agentSessions: { where: { isActive: true }, orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { displayName: "asc" } });
  const rows = [];
  for (const a of agents) {
    const s = a.agentSessions[0] ?? null;
    const reservation = await db.routingReservation.findFirst({ where: { agentUserId: a.id, status: { in: ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED", "WRAP_UP"] } }, include: { customer: { select: { displayName: true } }, dialAttempts: { orderBy: { startedAt: "desc" }, take: 1 }, decisionSnapshot: { select: { actionBucket: true } } } });
    const interaction = reservation ? await db.interaction.findFirst({ where: { reservationId: reservation.id }, orderBy: { startedAt: "desc" } }) : await db.interaction.findFirst({ where: { agentUserId: a.id, OR: [{ status: "DRAFT" }, { wrapUpStatus: { in: ["PENDING", "FAILED"] } }] }, orderBy: { startedAt: "desc" } });
    const attempts = await db.dialAttempt.count({ where: { reservation: { agentUserId: a.id }, startedAt: { gte: start } } });
    const rpc = await db.interaction.count({ where: { agentUserId: a.id, isRpc: true, startedAt: { gte: start } } });
    const ptp = await db.promise.count({ where: { createdByUserId: a.id, createdAt: { gte: start } } });
    const assigned = await db.workItem.count({ where: { OR: [{ ownerUserId: a.id }, { claimedByUserId: a.id }], status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] } } });
    const callbacks = await db.workItem.count({ where: { type: "CALLBACK", ownerUserId: a.id, status: { in: ["ELIGIBLE", "DEFERRED"] }, dueAt: { lte: new Date(now.getTime() + 86400000) } } });
    const outcomeState = interaction ? (interaction.status === "SAVED" || interaction.status === "CORRECTED" ? (interaction.wrapUpStatus === "ACKNOWLEDGED" ? "Completed" : interaction.wrapUpStatus === "FAILED" ? "Wrap-up failed" : "Awaiting provider ack") : interaction.status === "DRAFT" ? (interaction.draftSavedAt ? "Draft saved" : "Required fields") : "Not applicable") : "None pending";
    const state = s?.confirmedState ?? "OFFLINE";
    const operational = !s ? "Signed out / cannot receive calls" : state === "READY" ? "Available for next reservation" : state === "TALKING" ? "Call context loaded / healthy" : state === "ACW" ? "Next voice assignment blocked" : state === "BREAK" || state === "NOT_READY" ? "Unavailable by agent request" : state === "RESERVED" || state === "DIALING" ? "Dialing / no second reservation" : state === "CONNECTION_PROBLEM" ? "Provider state unknown - routing paused" : state;
    rows.push({
      userId: a.id,
      name: a.displayName,
      role: a.role,
      team: a.team?.name ?? null,
      seniority: a.agentProfile?.seniority ?? null,
      languages: a.languages,
      extension: a.agentProfile?.extension ?? null,
      sessionId: s?.id ?? null,
      requestedState: s?.requestedState ?? null,
      confirmedState: state,
      stateSince: s?.stateSince ?? null,
      ctiConnected: s?.ctiConnected ?? false,
      ctiStatus: s?.ctiStatus ?? "OFFLINE",
      heartbeatAgeSec: s?.lastHeartbeatAt ? Math.round((now.getTime() - s.lastHeartbeatAt.getTime()) / 1000) : null,
      currentCustomer: reservation ? { id: reservation.customerId, name: reservation.customer.displayName, correlationId: reservation.correlationId, status: reservation.status, bucket: reservation.decisionSnapshot?.actionBucket ?? null } : null,
      ringSeconds: interaction?.ringSeconds ?? null,
      talkSeconds: interaction && interaction.connectedAt ? (interaction.endedAt ? interaction.talkSeconds : Math.round((now.getTime() - interaction.connectedAt.getTime()) / 1000)) : null,
      acwSeconds: interaction?.acwStartedAt && !interaction.savedAt ? Math.round((now.getTime() - interaction.acwStartedAt.getTime()) / 1000) : interaction?.acwSeconds ?? null,
      interactionId: interaction?.id ?? null,
      outcomeState,
      operational,
      queue: a.agentProfile?.seniority === "SENIOR" ? "Bucket 10 + 8-9" : "Buckets 7-9",
      attemptsToday: attempts,
      rpcToday: rpc,
      ptpToday: ptp,
      assigned,
      callbacksDue: callbacks,
      pendingBreak: s?.pendingBreakAfterWrap ?? false,
    });
  }
  const [eligibleBacklog, seniorBacklog, overdueCallbacks, unsavedWrapUps, failedWrapUps, screenPopDelays, suppressionFailures, withdrawalUnknown, deadLetters, outboxPending] = await Promise.all([
    db.workItem.count({ where: { type: { in: ["CALL", "CALLBACK"] }, status: "ELIGIBLE" } }),
    db.workItem.count({ where: { type: "CALL", status: "ELIGIBLE", requiredSkill: "SENIOR" } }),
    db.workItem.count({ where: { type: "CALLBACK", status: { in: ["ELIGIBLE", "DEFERRED"] }, dueAt: { lt: new Date(now.getTime() - 15 * 60000) } } }),
    db.interaction.count({ where: { status: "DRAFT" } }),
    db.interaction.count({ where: { wrapUpStatus: "FAILED" } }),
    db.exceptionCase.count({ where: { type: "SCREEN_POP_DELAY", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } } }),
    db.exceptionCase.count({ where: { type: "SUPPRESSION_SYNC_FAILURE", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } } }),
    db.exceptionCase.count({ where: { type: "WITHDRAWAL_UNACKNOWLEDGED", status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } } }),
    db.outboxMessage.count({ where: { status: "DEAD" } }),
    db.outboxMessage.count({ where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } } }),
  ]);
  const seniorsOnline = rows.filter((r) => r.seniority === "SENIOR" && ["READY", "RESERVED", "DIALING", "TALKING", "ACW"].includes(r.confirmedState)).length;
  const capacity = (await getSetting<{ successfulContactsPerAgentDay?: number }>("capacity.planning")) ?? {};
  const seniorCapacityRemaining = seniorsOnline * (capacity.successfulContactsPerAgentDay ?? 80);
  const controls = await getOutboundControls(db);
  const worker = await db.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
  const campaigns = await db.campaign.findMany({ where: { kind: "VOICE" }, select: { code: true, name: true, status: true } });
  return {
    now,
    agents: rows,
    summary: {
      signedIn: rows.filter((r) => r.confirmedState !== "OFFLINE").length,
      roster: rows.length,
      ready: rows.filter((r) => r.confirmedState === "READY").length,
      talking: rows.filter((r) => r.confirmedState === "TALKING").length,
      pendingWrapUp: unsavedWrapUps + failedWrapUps,
      eligibleBacklog,
      seniorBacklog,
      seniorsOnline,
      seniorOverflow: Math.max(0, seniorBacklog - seniorCapacityRemaining),
      overdueCallbacks,
      unsavedWrapUps,
      failedWrapUps,
      screenPopDelays,
      suppressionFailures,
      withdrawalUnknown,
      deadLetters,
      outboxPending,
      workerOnline: !!worker && Date.now() - worker.lastSeenAt.getTime() < 60000,
    },
    controls: { ...controls, campaigns },
  };
}

export async function teamGrid(db: Db, now: Date) {
  const live = await liveSupervision(db, now);
  const start = DateTime.fromJSDate(now, { zone: BAKU_ZONE }).startOf("day").toJSDate();
  const rows = [];
  for (const a of live.agents) {
    const payments = await db.payment.findMany({ where: { status: "POSTED", eventAt: { gte: start }, customer: { interactions: { some: { agentUserId: a.userId, isRpc: true, startedAt: { gte: new Date(now.getTime() - 10 * 86400000) } } } } }, select: { amount: true } });
    const backlog = await db.workItem.count({ where: { ownerUserId: a.userId, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } });
    rows.push({ ...a, attributedCash: money(payments.reduce((s, p) => s.plus(p.amount), dec(0))).toFixed(2), backlog });
  }
  return { ...live, agents: rows };
}

/** Read-only rebalance simulation: distributes eligible voice work across available agents by skill and language. */
export async function simulateRebalance(db: Db) {
  const items = await db.workItem.findMany({ where: { type: { in: ["CALL", "CALLBACK"] }, status: { in: ["ELIGIBLE", "DEFERRED", "QUEUED"] } }, select: { id: true, requiredSkill: true, language: true, ownerUserId: true, customerId: true } });
  const agents = await db.user.findMany({ where: { isActive: true, agentProfile: { isNot: null } }, include: { agentProfile: true, agentSessions: { where: { isActive: true, confirmedState: { in: ["READY", "RESERVED", "DIALING", "TALKING", "ACW"] } } } } });
  const online = agents.filter((a) => a.agentSessions.length > 0);
  const pool = online.length ? online : agents;
  const load = new Map(pool.map((a) => [a.id, 0]));
  const unassignable: string[] = [];
  for (const wi of items) {
    if (wi.ownerUserId) continue;
    const candidates = pool.filter((a) => (wi.requiredSkill !== "SENIOR" || a.agentProfile?.seniority === "SENIOR") && (!wi.language || a.languages.includes(wi.language)));
    if (!candidates.length) {
      unassignable.push(wi.id);
      continue;
    }
    const best = candidates.sort((x, y) => (load.get(x.id) ?? 0) - (load.get(y.id) ?? 0))[0];
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
  }
  return { basis: online.length ? "agents currently online" : "full roster (nobody online)", items: items.length, unassignable: unassignable.length, distribution: pool.map((a) => ({ userId: a.id, name: a.displayName, seniority: a.agentProfile?.seniority, languages: a.languages, suggested: load.get(a.id) ?? 0 })), note: "Simulation only: customer grouping is preserved (one item per customer); no reassignment is applied without a reason." };
}
