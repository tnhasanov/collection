import { prisma } from "@/server/db";
import { appMode } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Readiness: database reachable and every migration applied (503 otherwise). The worker heartbeat is reported as a
 * degradation signal, not a readiness failure, because web requests keep working while provider commands queue.
 */
export async function GET() {
  const at = new Date();
  const checks: Record<string, unknown> = {};
  let ready = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
    const pending = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    const n = Number(pending[0]?.n ?? 0);
    checks.migrations = n === 0 ? "applied" : `${n} unfinished`;
    if (n > 0) ready = false;
  } catch (e) {
    checks.database = `error: ${e instanceof Error ? e.message : String(e)}`;
    ready = false;
  }
  try {
    const hb = await prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } });
    const ageSec = hb ? Math.round((at.getTime() - hb.lastSeenAt.getTime()) / 1000) : null;
    checks.worker = hb ? { id: hb.id, version: hb.version, lastSeenAt: hb.lastSeenAt, ageSec, online: ageSec !== null && ageSec < 90, lastCatchUpAt: hb.lastCatchUpAt, capabilities: hb.capabilitiesJson } : { online: false, note: "no heartbeat recorded" };
  } catch {
    checks.worker = { online: false, note: "heartbeat unavailable" };
  }
  return Response.json({ ok: ready, status: ready ? "ready" : "not_ready", mode: appMode(), at: at.toISOString(), checks }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
