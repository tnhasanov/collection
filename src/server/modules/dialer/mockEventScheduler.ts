import { prisma } from "@/server/db";
import type { ScheduleEvents } from "@/server/modules/dialer/routingService";

/**
 * Web-process fallback scheduler: provider commands are normally executed by the worker (which owns the adapter).
 * The web process never schedules mock events itself; it only writes outbox messages.
 */
export const noopScheduleEvents: ScheduleEvents = async () => {};

export async function workerOnline(): Promise<boolean> {
  const hb = await prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
  return !!hb && Date.now() - hb.lastSeenAt.getTime() < 60_000;
}
