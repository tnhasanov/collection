import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

export interface AuditInput {
  actorUserId?: string | null;
  actorService?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  customerId?: string | null;
  caseId?: string | null;
  reason?: string | null;
  changes?: unknown;
  versionIds?: unknown;
  sourceEventId?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  blocked?: boolean;
}

/** Append-only audit trail. Corrections add new events; rows are never updated (DB trigger). */
export async function appendAudit(db: Db, input: AuditInput) {
  return db.auditEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      actorService: input.actorService ?? null,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      customerId: input.customerId ?? null,
      caseId: input.caseId ?? null,
      reason: input.reason ?? null,
      changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      versionIds: (input.versionIds ?? undefined) as Prisma.InputJsonValue | undefined,
      sourceEventId: input.sourceEventId ?? null,
      correlationId: input.correlationId ?? null,
      ip: input.ip ?? null,
      blocked: input.blocked ?? false,
    },
  });
}
