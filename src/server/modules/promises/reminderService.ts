import type { Db } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, bakuBusinessDate, bakuDateTime, formatDate, fromDbDate, type IsoDate } from "@/server/dates";
import { dec, money, toDbMoney } from "@/server/money";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { nextPermittedTime } from "@/server/modules/contactPolicy/evaluator";
import { getContactPolicy, getSetting } from "@/server/modules/settings/settingsService";
import { renderTemplate, smsInfo, templateText, variablesForCustomer } from "@/server/modules/templates/templateService";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";

/**
 * Durable promise reminders. Storing a reminder plan on the promise is not enough: each reminder is a scheduled job
 * that is rechecked immediately before dispatch (promise still open and unchanged, remaining amount, verified
 * recipient, permitted hours, channel and contact restrictions), deduplicated by key, cancelled when the promise
 * changes or closes, and tracked through sent / delivered / failed / skipped with a short reason.
 */
export const REMINDER_TEMPLATE_CODE = "PTP-REMINDER-01";
export type ReminderKind = "BEFORE_DEADLINE" | "DEADLINE_DAY" | "MANUAL";

interface PromiseLike {
  id: string;
  customerId: string;
  deadlineDate: Date | string;
  status: string;
  version: number;
  remainingAmount: unknown;
  reminderPlan?: unknown;
}

export async function reminderSendTime(db: Db): Promise<string> {
  const v = await getSetting<string>("reminders.sendTimeBaku", db).catch(() => null);
  return typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : "10:00";
}

export async function smsUnitCost(db: Db): Promise<string> {
  const costs = await getSetting<{ sms?: { cost?: string } }>("economics.unitCosts", db).catch(() => null);
  return costs?.sms?.cost ?? "0.031";
}

/** Segment count (GSM-7 or UCS-2 per the gateway contract) and estimated cost for a rendered body. */
export async function smsCost(db: Db, body: string) {
  const info = smsInfo(body);
  const unit = await smsUnitCost(db);
  return { ...info, unitCost: unit, estimatedCost: money(dec(unit).times(info.segments)).toFixed(4) };
}

export function reminderDedupKey(promiseId: string, kind: ReminderKind, suffix?: string) {
  return `ptp-reminder:${promiseId}:${kind}${suffix ? `:${suffix}` : ""}`;
}

/** (Re)schedules the reminders implied by the promise's plan; existing scheduled jobs are re-pointed, past times are skipped. */
export async function scheduleReminders(db: Db, promise: PromiseLike, now: Date) {
  const plan = (promise.reminderPlan as { smsBeforeDeadlineDays?: number } | null) ?? { smsBeforeDeadlineDays: 1 };
  const deadlineIso: IsoDate = typeof promise.deadlineDate === "string" ? promise.deadlineDate.slice(0, 10) : fromDbDate(promise.deadlineDate)!;
  const sendTime = await reminderSendTime(db);
  const policy = await getContactPolicy(db);
  const kinds: { kind: ReminderKind; date: IsoDate }[] = [
    { kind: "BEFORE_DEADLINE", date: addDays(deadlineIso, -(plan.smsBeforeDeadlineDays ?? 1)) },
    { kind: "DEADLINE_DAY", date: deadlineIso },
  ];
  const scheduled: string[] = [];
  for (const k of kinds) {
    let at = bakuDateTime(k.date, sendTime);
    if (at.getTime() <= now.getTime()) {
      // Too late for the planned slot: send at the next permitted time if that is still before the deadline day ends.
      const next = nextPermittedTime(now, policy);
      if (bakuBusinessDate(next) > deadlineIso) continue;
      at = next;
    }
    const key = reminderDedupKey(promise.id, k.kind);
    await db.reminderJob.upsert({
      where: { dedupKey: key },
      create: { promiseId: promise.id, customerId: promise.customerId, kind: k.kind, dedupKey: key, scheduledFor: at, promiseVersion: promise.version, status: "SCHEDULED" },
      update: { scheduledFor: at, promiseVersion: promise.version, status: "SCHEDULED", reason: null },
    });
    scheduled.push(key);
  }
  return scheduled;
}

/** Cancels every scheduled reminder of a promise (promise changed, kept, broken, cancelled or superseded). */
export async function cancelReminders(db: Db, promiseId: string, reason: string, now: Date) {
  const r = await db.reminderJob.updateMany({ where: { promiseId, status: "SCHEDULED" }, data: { status: "CANCELLED", reason, updatedAt: now } });
  return r.count;
}

export interface DispatchResult {
  due: number;
  sent: number;
  skipped: number;
  rescheduled: number;
}

/** Dispatches due reminders with all pre-send rechecks. Idempotent: a job is dispatched once, retries reuse the same message. */
export async function dispatchDueReminders(prisma: PrismaClient, now: Date, limit = 100): Promise<DispatchResult> {
  const due = await prisma.reminderJob.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: now } }, orderBy: { scheduledFor: "asc" }, take: limit, include: { promise: true } });
  const result: DispatchResult = { due: due.length, sent: 0, skipped: 0, rescheduled: 0 };
  const policy = await getContactPolicy(prisma);
  for (const job of due) {
    const skip = async (reason: string) => {
      await prisma.reminderJob.update({ where: { id: job.id }, data: { status: "SKIPPED", reason, attempts: { increment: 1 } } });
      result.skipped++;
    };
    const p = job.promise;
    if (!p || !["ACTIVE", "PARTIALLY_PAID"].includes(p.status)) { await skip(`Promise ${p?.status ?? "missing"}; nothing to remind`); continue; }
    if (p.version !== job.promiseVersion) { await skip("Promise changed since the reminder was scheduled; rescheduled from the new version"); continue; }
    if (dec(p.remainingAmount).lessThanOrEqualTo(0)) { await skip("Promise already covered by verified postings"); continue; }
    // Permitted hours for SMS (same quiet hours as voice in the demo policy): move, do not skip.
    const permitted = nextPermittedTime(now, policy);
    if (permitted.getTime() > now.getTime()) {
      await prisma.reminderJob.update({ where: { id: job.id }, data: { scheduledFor: permitted, reason: "Outside permitted hours; moved to the next permitted time" } });
      result.rescheduled++;
      continue;
    }
    const customer = await prisma.customer.findUnique({ where: { id: p.customerId }, include: { contactPoints: true } });
    if (!customer) { await skip("Customer not found"); continue; }
    const recipient = customer.contactPoints.filter((c) => c.type === "MOBILE" && c.verification === "VERIFIED" && !c.restricted).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0] ?? null;
    if (!recipient) { await skip("No verified mobile number; reminder not sent"); continue; }
    const { decision } = await evaluateCustomerEligibility(prisma, p.customerId, { channel: "SMS", now, contactPointId: recipient.id });
    if (!decision.eligible) { await skip(`Blocked by contact policy: ${decision.reasonCodes.join(", ")}`); continue; }
    const template = (await prisma.template.findFirst({ where: { code: REMINDER_TEMPLATE_CODE, status: "ACTIVE", language: customer.language }, orderBy: { effectiveFrom: "desc" } })) ?? (await prisma.template.findFirst({ where: { code: REMINDER_TEMPLATE_CODE, status: "ACTIVE", language: "AZ" } }));
    if (!template) { await skip("No approved reminder template"); continue; }
    const vars = { ...(await variablesForCustomer(prisma, p.customerId)), promiseAmount: dec(p.remainingAmount).toFixed(2), promiseDate: formatDate(p.deadlineDate) };
    const body = renderTemplate(templateText(template.body), vars);
    const cost = await smsCost(prisma, body);
    const existing = job.outboundMessageId ? await prisma.outboundMessage.findUnique({ where: { id: job.outboundMessageId } }) : await prisma.outboundMessage.findUnique({ where: { dedupKey: job.dedupKey } });
    const msg = existing ?? (await prisma.outboundMessage.create({ data: { dedupKey: job.dedupKey, customerId: p.customerId, contactPointId: recipient.id, templateId: template.id, language: template.language, body, status: "QUEUED", kind: "PTP_REMINDER", segments: cost.segments, estimatedCost: toDbMoney(cost.estimatedCost) } }));
    await prisma.outboxMessage.upsert({ where: { idempotencyKey: `sms:${msg.id}` }, create: { topic: "sms.send", idempotencyKey: `sms:${msg.id}`, payload: { outboundMessageId: msg.id } as never }, update: {} });
    await prisma.reminderJob.update({ where: { id: job.id }, data: { status: "SENT", sentAt: now, outboundMessageId: msg.id, attempts: { increment: 1 }, reason: `Queued to the gateway (${cost.encoding}, ${cost.segments} segment${cost.segments === 1 ? "" : "s"}, est. ${cost.estimatedCost} AZN)` } });
    await appendAudit(prisma, { actorService: "reminders", action: "promise.reminder_sent", objectType: "Promise", objectId: p.id, customerId: p.customerId, changes: { jobId: job.id, kind: job.kind, messageId: msg.id, segments: cost.segments, estimatedCost: cost.estimatedCost, policyVersion: decision.policyVersion } });
    result.sent++;
  }
  return result;
}

/** Manual resend (permission-gated by the route): a new job under the same controls, dispatched at once. */
export async function resendReminder(prisma: PrismaClient, params: { promiseId: string; actorUserId: string; now: Date }) {
  const p = await prisma.promise.findUnique({ where: { id: params.promiseId } });
  if (!p) throw notFound("Promise not found");
  if (!["ACTIVE", "PARTIALLY_PAID"].includes(p.status)) throw conflict("Only active promises can be reminded");
  const key = reminderDedupKey(p.id, "MANUAL", String(params.now.getTime()));
  const job = await prisma.reminderJob.create({ data: { promiseId: p.id, customerId: p.customerId, kind: "MANUAL", dedupKey: key, scheduledFor: params.now, promiseVersion: p.version, status: "SCHEDULED", reason: `Manual resend requested by ${params.actorUserId}` } });
  await appendAudit(prisma, { actorUserId: params.actorUserId, action: "promise.reminder_resend_requested", objectType: "Promise", objectId: p.id, customerId: p.customerId, changes: { jobId: job.id } });
  const r = await dispatchDueReminders(prisma, params.now, 1000);
  const refreshed = await prisma.reminderJob.findUniqueOrThrow({ where: { id: job.id } });
  return { jobId: job.id, status: refreshed.status, reason: refreshed.reason, dispatch: r };
}

/** Reminder rows for display (My promises). */
export async function remindersForPromises(db: Db, promiseIds: string[]) {
  if (promiseIds.length === 0) return new Map<string, { id: string; kind: string; status: string; scheduledFor: Date; sentAt: Date | null; reason: string | null; delivered: boolean; segments: number | null }[]>();
  const rows = await db.reminderJob.findMany({ where: { promiseId: { in: promiseIds } }, include: { outboundMessage: { select: { status: true, segments: true, deliveredAt: true } } }, orderBy: { scheduledFor: "asc" } });
  const map = new Map<string, { id: string; kind: string; status: string; scheduledFor: Date; sentAt: Date | null; reason: string | null; delivered: boolean; segments: number | null }[]>();
  for (const r of rows) {
    const list = map.get(r.promiseId) ?? [];
    list.push({ id: r.id, kind: r.kind, status: r.outboundMessage?.status === "DELIVERED" ? "DELIVERED" : r.outboundMessage?.status === "FAILED" ? "FAILED" : r.status, scheduledFor: r.scheduledFor, sentAt: r.sentAt, reason: r.reason, delivered: !!r.outboundMessage?.deliveredAt, segments: r.outboundMessage?.segments ?? null });
    map.set(r.promiseId, list);
  }
  return map;
}
