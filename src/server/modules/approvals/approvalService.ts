import type { PrismaClient } from "@/generated/prisma/client";
import type { ApprovalType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, forbidden, notFound, unprocessable } from "@/server/errors";
import { setSetting, invalidateSettingsCache } from "@/server/modules/settings/settingsService";
import { validateStrategyConfig } from "@/server/modules/strategy/strategyService";
import { runGoldenCases } from "@/server/modules/models/modelService";
import { runDailyDecision } from "@/server/modules/decisions/decisionRun";
import type { RulePackage } from "@/server/modules/decisions/ruleInterpreter";

/**
 * Maker/checker approvals (S11). The checker must be a different user from the maker; approving applies the
 * effect atomically (activation retires the previous active version with a rollback target), rejecting or
 * requesting information never changes the governed object. Every decision is audited.
 */
export type Decision = "APPROVE" | "REJECT" | "REQUEST_INFO";

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  MODEL_ACTIVATION: "Model activation",
  STRATEGY_ACTIVATION: "Strategy activation",
  POLICY_ACTIVATION: "Policy / parameter change",
  RECONCILIATION_DECISION: "Reconciliation decision",
  WAIVER: "Waiver",
  RESTRUCTURE: "Restructure / arrangement",
  RESTRICTION_OVERRIDE: "Restriction override",
  EXPORT: "Data export",
  TEMPLATE_ACTIVATION: "Template activation",
  CAMPAIGN_RELEASE: "Campaign release",
  HANDOVER: "Recovery handover",
  ROLLBACK: "Rollback",
};

async function applyEffect(prisma: PrismaClient, ar: { id: string; type: ApprovalType; objectType: string; objectId: string; afterJson: unknown; rollbackTargetId: string | null; proposedEffectiveAt: Date | null }, checker: SessionUser, now: Date): Promise<Record<string, unknown>> {
  switch (ar.type) {
    case "MODEL_ACTIVATION": {
      const mv = await prisma.modelVersion.findUnique({ where: { id: ar.objectId } });
      if (!mv) throw notFound("Model version no longer exists");
      const golden = runGoldenCases(mv.rulesJson as unknown as RulePackage);
      if (golden.passed !== golden.total) throw unprocessable(`Golden cases fail (${golden.passed}/${golden.total}); activation refused`);
      const previous = await prisma.modelVersion.findFirst({ where: { modelCode: mv.modelCode, status: "ACTIVE", id: { not: mv.id } } });
      await prisma.$transaction([
        ...(previous ? [prisma.modelVersion.update({ where: { id: previous.id }, data: { status: "RETIRED", validTo: now } })] : []),
        prisma.modelVersion.update({ where: { id: mv.id }, data: { status: "ACTIVE", approvedBy: checker.username, approvedAt: now, activatedAt: now, validFrom: ar.proposedEffectiveAt ?? now } }),
      ]);
      return { activated: mv.id, retired: previous?.id ?? null, golden: `${golden.passed}/${golden.total}` };
    }
    case "STRATEGY_ACTIVATION": {
      const sv = await prisma.strategyVersion.findUnique({ where: { id: ar.objectId } });
      if (!sv) throw notFound("Strategy version no longer exists");
      const v = validateStrategyConfig(sv.configJson);
      if (!v.ok) throw unprocessable("Strategy validation errors; activation refused", v.issues);
      const previous = await prisma.strategyVersion.findFirst({ where: { code: sv.code, status: "ACTIVE", id: { not: sv.id } } });
      await prisma.$transaction([
        ...(previous ? [prisma.strategyVersion.update({ where: { id: previous.id }, data: { status: "RETIRED", retiredAt: now } })] : []),
        prisma.strategyVersion.update({ where: { id: sv.id }, data: { status: "ACTIVE", approvedBy: checker.username, activatedAt: now } }),
      ]);
      const run = await runDailyDecision(prisma, { triggeredBy: `approval:${ar.id}`, now });
      return { activated: sv.id, retired: previous?.id ?? null, decisionRun: run.runId, population: run.population };
    }
    case "POLICY_ACTIVATION": {
      if (ar.objectType === "Setting") {
        const row = await setSetting(prisma, ar.objectId, ar.afterJson, checker.id);
        return { setting: ar.objectId, version: row.version };
      }
      if (ar.objectType === "ContactPolicyVersion") {
        const cp = await prisma.contactPolicyVersion.findUnique({ where: { id: ar.objectId } });
        if (!cp) throw notFound("Contact policy version no longer exists");
        const previous = await prisma.contactPolicyVersion.findFirst({ where: { code: cp.code, status: "ACTIVE", id: { not: cp.id } } });
        await prisma.$transaction([
          ...(previous ? [prisma.contactPolicyVersion.update({ where: { id: previous.id }, data: { status: "RETIRED" } })] : []),
          prisma.contactPolicyVersion.update({ where: { id: cp.id }, data: { status: "ACTIVE", approvedBy: checker.username, activatedAt: now } }),
        ]);
        await setSetting(prisma, "contactPolicy.active", cp.configJson, checker.id);
        invalidateSettingsCache();
        return { activated: cp.id, retired: previous?.id ?? null };
      }
      throw unprocessable(`Unsupported policy object ${ar.objectType}`);
    }
    case "TEMPLATE_ACTIVATION": {
      const t = await prisma.template.findUnique({ where: { id: ar.objectId } });
      if (!t) throw notFound("Template no longer exists");
      const previous = await prisma.template.findFirst({ where: { code: t.code, language: t.language, status: "ACTIVE", id: { not: t.id } } });
      await prisma.$transaction([
        ...(previous ? [prisma.template.update({ where: { id: previous.id }, data: { status: "RETIRED" } })] : []),
        prisma.template.update({ where: { id: t.id }, data: { status: "ACTIVE", approvedBy: checker.username, effectiveFrom: ar.proposedEffectiveAt ?? now } }),
      ]);
      return { activated: t.id, retired: previous?.id ?? null };
    }
    case "CAMPAIGN_RELEASE": {
      const c = await prisma.campaign.findUnique({ where: { id: ar.objectId }, include: { template: true, strategyVersion: true } });
      if (!c) throw notFound("Campaign no longer exists");
      if (c.template && c.template.status !== "ACTIVE") throw unprocessable("Campaign template is not ACTIVE");
      if (c.strategyVersion && c.strategyVersion.status !== "ACTIVE") throw unprocessable("Campaign strategy version is not ACTIVE");
      const status = c.scheduledAt && c.scheduledAt > now ? "SCHEDULED" : "RUNNING";
      await prisma.campaign.update({ where: { id: c.id }, data: { status, approverUserId: checker.id, approvalId: ar.id } });
      return { campaign: c.id, status };
    }
    case "RESTRUCTURE":
    case "WAIVER": {
      const a = await prisma.arrangement.findUnique({ where: { id: ar.objectId } });
      if (!a) throw notFound("Arrangement no longer exists");
      await prisma.arrangement.update({ where: { id: a.id }, data: { status: "APPROVED", approvalId: ar.id } });
      return { arrangement: a.id, status: "APPROVED", note: "Core submission is a separate, explicit step (mock core confirmation in demo)" };
    }
    case "HANDOVER": {
      const h = await prisma.handoverPacket.findUnique({ where: { id: ar.objectId } });
      if (!h) throw notFound("Handover packet no longer exists");
      await prisma.handoverPacket.update({ where: { id: h.id }, data: { status: "APPROVED", approvalId: ar.id } });
      return { handover: h.id, status: "APPROVED" };
    }
    case "ROLLBACK": {
      const target = ar.rollbackTargetId;
      if (!target) throw unprocessable("Rollback request has no target version");
      if (ar.objectType === "StrategyVersion") {
        const current = await prisma.strategyVersion.findUnique({ where: { id: ar.objectId } });
        const tgt = await prisma.strategyVersion.findUnique({ where: { id: target } });
        if (!current || !tgt) throw notFound("Version not found");
        await prisma.$transaction([prisma.strategyVersion.update({ where: { id: current.id }, data: { status: "RETIRED", retiredAt: now } }), prisma.strategyVersion.update({ where: { id: tgt.id }, data: { status: "ACTIVE", activatedAt: now, retiredAt: null, approvedBy: checker.username } })]);
        const run = await runDailyDecision(prisma, { triggeredBy: `rollback:${ar.id}`, now });
        return { rolledBackTo: tgt.id, retired: current.id, decisionRun: run.runId };
      }
      if (ar.objectType === "ModelVersion") {
        const current = await prisma.modelVersion.findUnique({ where: { id: ar.objectId } });
        const tgt = await prisma.modelVersion.findUnique({ where: { id: target } });
        if (!current || !tgt) throw notFound("Version not found");
        await prisma.$transaction([prisma.modelVersion.update({ where: { id: current.id }, data: { status: "RETIRED", validTo: now } }), prisma.modelVersion.update({ where: { id: tgt.id }, data: { status: "ACTIVE", activatedAt: now, validTo: null, approvedBy: checker.username } })]);
        return { rolledBackTo: tgt.id, retired: current.id };
      }
      throw unprocessable(`Rollback not supported for ${ar.objectType}`);
    }
    case "RECONCILIATION_DECISION":
    case "RESTRICTION_OVERRIDE":
    case "EXPORT":
      return { recorded: true, note: "Decision recorded; the originating workflow applies it" };
  }
}

export async function decideApproval(prisma: PrismaClient, id: string, checker: SessionUser, decision: Decision, note: string, now: Date) {
  const ar = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!ar) throw notFound("Approval request not found");
  if (ar.makerUserId === checker.id) {
    await appendAudit(prisma, { actorUserId: checker.id, action: "approval.self_decision_blocked", objectType: "ApprovalRequest", objectId: id, blocked: true, reason: "Maker cannot decide their own request" });
    throw forbidden("No self-approval: the checker must be a different user from the maker");
  }
  if (!["PENDING", "INFO_REQUESTED"].includes(ar.status)) throw conflict(`Request is already ${ar.status}`);
  let effect: Record<string, unknown> | null = null;
  if (decision === "APPROVE") effect = await applyEffect(prisma, ar, checker, now);
  const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "INFO_REQUESTED";
  const updated = await prisma.approvalRequest.update({ where: { id }, data: { status, checkerUserId: checker.id, decisionNote: note, decidedAt: decision === "REQUEST_INFO" ? null : now, evidenceJson: effect ? ({ ...(ar.evidenceJson as object | null), effect } as never) : undefined } });
  if (decision === "REJECT" && ar.objectType === "Arrangement") await prisma.arrangement.update({ where: { id: ar.objectId }, data: { status: "REJECTED" } });
  if (decision === "REJECT" && ar.objectType === "StrategyVersion") await prisma.strategyVersion.update({ where: { id: ar.objectId }, data: { status: "REJECTED" } });
  if (decision === "REJECT" && ar.objectType === "ModelVersion") await prisma.modelVersion.update({ where: { id: ar.objectId }, data: { status: "REJECTED" } });
  await appendAudit(prisma, { actorUserId: checker.id, action: `approval.${status.toLowerCase()}`, objectType: "ApprovalRequest", objectId: id, reason: note, changes: { type: ar.type, objectType: ar.objectType, objectId: ar.objectId, effect }, versionIds: { rollbackTargetId: ar.rollbackTargetId } });
  return { status: updated.status, effect };
}

export async function cancelApproval(prisma: PrismaClient, id: string, user: SessionUser, reason: string, now: Date) {
  const ar = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!ar) throw notFound("Approval request not found");
  if (ar.makerUserId !== user.id) throw forbidden("Only the maker can cancel a request");
  if (!["PENDING", "INFO_REQUESTED"].includes(ar.status)) throw conflict(`Request is already ${ar.status}`);
  await prisma.approvalRequest.update({ where: { id }, data: { status: "CANCELLED", decisionNote: reason, decidedAt: now } });
  await appendAudit(prisma, { actorUserId: user.id, action: "approval.cancelled", objectType: "ApprovalRequest", objectId: id, reason });
}

/** Rollback request for the currently active strategy/model: target = the most recently retired version of the same code. */
export async function requestRollback(prisma: PrismaClient, input: { objectType: "StrategyVersion" | "ModelVersion"; objectId: string; rationale: string }, maker: SessionUser) {
  let targetId: string | null = null;
  let title = "";
  if (input.objectType === "StrategyVersion") {
    const cur = await prisma.strategyVersion.findUnique({ where: { id: input.objectId } });
    if (!cur || cur.status !== "ACTIVE") throw unprocessable("Only the active strategy version can be rolled back");
    const prev = await prisma.strategyVersion.findFirst({ where: { code: cur.code, status: "RETIRED" }, orderBy: { retiredAt: "desc" } });
    if (!prev) throw unprocessable("No retired version to roll back to");
    targetId = prev.id; title = `Roll back strategy ${cur.code} ${cur.version} → ${prev.version}`;
  } else {
    const cur = await prisma.modelVersion.findUnique({ where: { id: input.objectId } });
    if (!cur || cur.status !== "ACTIVE") throw unprocessable("Only the active model version can be rolled back");
    const prev = await prisma.modelVersion.findFirst({ where: { modelCode: cur.modelCode, status: "RETIRED" }, orderBy: { validTo: "desc" } });
    if (!prev) throw unprocessable("No retired version to roll back to");
    targetId = prev.id; title = `Roll back model ${cur.modelCode} ${cur.version} → ${prev.version}`;
  }
  const open = await prisma.approvalRequest.findFirst({ where: { type: "ROLLBACK", objectId: input.objectId, status: { in: ["PENDING", "INFO_REQUESTED"] } } });
  if (open) throw conflict(`Rollback request ${open.id} is already open`);
  const ar = await prisma.approvalRequest.create({ data: { type: "ROLLBACK", makerUserId: maker.id, objectType: input.objectType, objectId: input.objectId, title, rationale: input.rationale, rollbackTargetId: targetId, beforeJson: { active: input.objectId } as never, afterJson: { active: targetId } as never } });
  await appendAudit(prisma, { actorUserId: maker.id, action: "approval.requested", objectType: "ApprovalRequest", objectId: ar.id, reason: input.rationale, changes: { type: "ROLLBACK", target: targetId } });
  return ar;
}
