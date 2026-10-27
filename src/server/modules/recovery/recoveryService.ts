import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";
import { maskNumber } from "@/server/modules/dialer/contract";

/**
 * Later-stage handover (S26). A packet freezes what the receiving team needs (customer, loans, balances,
 * contact history summary, promises, support flags, decision context) and is governed by an approval.
 * Export marks the case HANDOVER and cancels routine early-arrears work; return re-opens it with a reason.
 */
export async function buildHandoverPacket(db: Db, caseId: string, now: Date) {
  const c = await db.collectionCase.findUnique({ where: { id: caseId }, include: { customer: { include: { contactPoints: true, loans: { include: { scheduleVersions: { where: { isCurrent: true, source: "CORE_IMPORT" }, select: { versionNo: true, sourceRef: true } } } }, supportCases: { where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }, promises: { orderBy: { createdAt: "desc" }, take: 10 }, interactions: { orderBy: { startedAt: "desc" }, take: 50, select: { startedAt: true, channel: true, identityStatus: true, businessOutcome: true, isRpc: true, note: true, agentUserId: true } } } }, decisions: { where: { isCurrent: true }, take: 1 }, exceptions: { where: { status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, select: { type: true, title: true, severity: true } } } });
  if (!c) throw notFound("Case not found");
  const cu = c.customer;
  const d = c.decisions[0];
  return {
    generatedAt: now.toISOString(),
    case: { id: c.id, episodeNo: c.episodeNo, status: c.status, openedAt: c.openedAt.toISOString(), maxDpd: c.maxDpd, totalOverdue: c.totalOverdue.toString(), modelExposure: c.modelExposure.toString(), ownerUserId: c.ownerUserId },
    customer: { id: cu.id, cif: cu.cif, displayName: cu.displayName, branch: cu.branch, language: cu.language, status: cu.status, specialHandling: cu.specialHandling, specialHandlingReason: cu.specialHandlingReason },
    contacts: cu.contactPoints.map((p) => ({ type: p.type, value: p.type === "MOBILE" || p.type === "LANDLINE" ? maskNumber(p.value) : p.value, verification: p.verification, restricted: p.restricted, invalidReason: p.invalidReason })),
    loans: cu.loans.map((l) => ({ id: l.id, coreLoanId: l.coreLoanId, status: l.status, principalOutstanding: l.principalOutstanding.toString(), totalOverdue: l.totalOverdue.toString(), overduePrincipal: l.overduePrincipal.toString(), overdueInterest: l.overdueInterest.toString(), dpd: l.dpd, oldestUnpaidDueDate: l.oldestUnpaidDueDate?.toISOString().slice(0, 10) ?? null, balancesAsOf: l.balancesAsOf.toISOString(), schedule: l.scheduleVersions[0] ?? null, lastPaymentAt: l.lastPaymentAt?.toISOString() ?? null, lastPaymentAmount: l.lastPaymentAmount?.toString() ?? null })),
    decision: d ? { businessDate: d.businessDate.toISOString().slice(0, 10), segment: d.segment, probability: d.probability?.toString() ?? null, probabilitySource: d.probabilitySource, era: d.era?.toString() ?? null, bucket: d.actionBucket, effectiveAction: d.effectiveAction, reasonCodes: d.reasonCodes } : null,
    contactHistory: { attempts: cu.interactions.length, rpc: cu.interactions.filter((i) => i.isRpc).length, lastRpcAt: cu.interactions.find((i) => i.isRpc)?.startedAt.toISOString() ?? null, outcomes: cu.interactions.slice(0, 15).map((i) => ({ at: i.startedAt.toISOString(), channel: i.channel, identity: i.identityStatus, outcome: i.businessOutcome, note: i.note ? i.note.slice(0, 200) : null })) },
    promises: cu.promises.map((p) => ({ id: p.id, amount: p.amount.toString(), deadline: p.deadlineDate.toISOString().slice(0, 10), status: p.status, paid: p.paidAmount.toString() })),
    supportFlags: cu.supportCases.map((s) => ({ id: s.id, type: s.type, status: s.status, reason: s.reason, restrictsCalls: s.restrictsCalls, restrictionUntil: s.restrictionUntil?.toISOString() ?? null })),
    openExceptions: c.exceptions,
    note: "Restricted support details are excluded from the packet; the receiving team requests them through the support case owner.",
  };
}

export const HANDOVER_ACTIONS = ["REQUEST_REVIEW", "EXPORT", "ACCEPT", "RETURN"] as const;
export type HandoverAction = (typeof HANDOVER_ACTIONS)[number];

export async function createHandover(db: Db, caseId: string, receivingTeam: string, deadline: Date | null, user: SessionUser, now: Date) {
  const existing = await db.handoverPacket.findFirst({ where: { caseId, status: { in: ["DRAFT", "REVIEW_REQUESTED", "APPROVED", "EXPORTED"] } } });
  if (existing) throw conflict(`Handover ${existing.id} is already in progress for this case`);
  const packet = await buildHandoverPacket(db, caseId, now);
  const h = await db.handoverPacket.create({ data: { caseId, status: "DRAFT", packet: packet as never, receivingTeam, deadline, ownerUserId: user.id, createdBy: user.id } });
  await appendAudit(db, { actorUserId: user.id, action: "handover.created", objectType: "HandoverPacket", objectId: h.id, caseId, customerId: packet.customer.id });
  return h;
}

export async function transitionHandover(prisma: PrismaClient, id: string, action: HandoverAction, user: SessionUser, note: string, now: Date) {
  const h = await prisma.handoverPacket.findUnique({ where: { id }, include: { case: true } });
  if (!h) throw notFound("Handover not found");
  const expect = (s: string[]) => { if (!s.includes(h.status)) throw conflict(`${action} not allowed from ${h.status}`); };
  let effect: Record<string, unknown> = {};
  switch (action) {
    case "REQUEST_REVIEW": {
      expect(["DRAFT", "RETURNED"]);
      const packet = await buildHandoverPacket(prisma, h.caseId, now);
      const ar = await prisma.approvalRequest.create({ data: { type: "HANDOVER", makerUserId: user.id, objectType: "HandoverPacket", objectId: id, title: `Handover ${packet.customer.displayName} to ${h.receivingTeam}`, rationale: note, afterJson: { receivingTeam: h.receivingTeam, deadline: h.deadline } as never, impactJson: { loans: packet.loans.length, totalOverdue: packet.case.totalOverdue, maxDpd: packet.case.maxDpd, openSupportFlags: packet.supportFlags.length } as never, evidenceJson: packet as never } });
      await prisma.handoverPacket.update({ where: { id }, data: { status: "REVIEW_REQUESTED", packet: packet as never, approvalId: ar.id } });
      effect = { approvalId: ar.id };
      break;
    }
    case "EXPORT": {
      expect(["APPROVED"]);
      const cancelled = await prisma.workItem.updateMany({ where: { caseId: h.caseId, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] }, type: { in: ["CALL", "DIGITAL_REMINDER", "LATER_STAGE_REVIEW", "MANUAL_REVIEW"] } }, data: { status: "CANCELLED", cancelReason: `Handover ${id} exported` } });
      await prisma.collectionCase.update({ where: { id: h.caseId }, data: { status: "HANDOVER" } });
      await prisma.handoverPacket.update({ where: { id }, data: { status: "EXPORTED" } });
      effect = { cancelledWorkItems: cancelled.count, caseStatus: "HANDOVER" };
      break;
    }
    case "ACCEPT": expect(["EXPORTED"]); await prisma.handoverPacket.update({ where: { id }, data: { status: "ACCEPTED", acknowledgedBy: user.username, acknowledgedAt: now } }); break;
    case "RETURN": {
      expect(["EXPORTED", "ACCEPTED", "REVIEW_REQUESTED", "APPROVED"]);
      await prisma.handoverPacket.update({ where: { id }, data: { status: "RETURNED", returnReason: note } });
      if (h.case.status === "HANDOVER") await prisma.collectionCase.update({ where: { id: h.caseId }, data: { status: "OPEN" } });
      effect = { caseStatus: "OPEN", reason: note };
      break;
    }
  }
  await appendAudit(prisma, { actorUserId: user.id, action: `handover.${action.toLowerCase()}`, objectType: "HandoverPacket", objectId: id, caseId: h.caseId, reason: note, changes: effect });
  return effect;
}
