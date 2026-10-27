import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { refreshMockSources } from "@/server/modules/jobs/maintenance";
import { getDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { notFound, conflict } from "@/server/errors";

const schema = z.object({ action: z.enum(["TEST", "DRY_RUN", "PAUSE", "RESUME", "REFRESH_NOW", "ROTATE_SECRET_REF"]), reason: z.string().max(300).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ source: string }> }) {
  try {
    const user = await requireUser("integration.operate");
    const { source } = await ctx.params;
    const { action, reason } = await parseBody(req, schema);
    const w = await prisma.sourceWatermark.findUnique({ where: { sourceSystem: source } });
    if (!w) throw notFound("Unknown source");
    const t = await now();
    let result: unknown = null;
    switch (action) {
      case "TEST": {
        if (w.health === "DISABLED") throw conflict("Connector disabled: no contract/configuration supplied");
        if (source === "DIALER") result = await getDialerAdapter().capabilities();
        else result = { mode: w.mode, reachable: true, note: "Mock connection test: no external system is contacted" };
        await prisma.sourceWatermark.update({ where: { sourceSystem: source }, data: { lastSuccessfulRunAt: t, errorCount: 0, health: w.paused ? w.health : "HEALTHY" } });
        break;
      }
      case "DRY_RUN": {
        const counts = { customers: await prisma.customer.count(), loans: await prisma.loan.count(), payments: await prisma.payment.count(), quarantined: await prisma.payment.count({ where: { status: "QUARANTINED" } }), outboxPending: await prisma.outboxMessage.count({ where: { status: { in: ["PENDING", "FAILED"] } } }) };
        result = { ...counts, note: "Dry run compares control totals; nothing is committed" };
        break;
      }
      case "PAUSE": await prisma.sourceWatermark.update({ where: { sourceSystem: source }, data: { paused: true, health: "DEGRADED" } }); break;
      case "RESUME": await prisma.sourceWatermark.update({ where: { sourceSystem: source }, data: { paused: false, health: "HEALTHY", lastSuccessfulRunAt: t } }); break;
      case "REFRESH_NOW": result = await refreshMockSources(prisma, t); break;
      case "ROTATE_SECRET_REF": {
        const ref = `secretstore://atb-collections/${source.toLowerCase()}/credential#v${Math.floor(t.getTime() / 1000) % 1000}`;
        await prisma.sourceWatermark.update({ where: { sourceSystem: source }, data: { notes: `${w.notes ? w.notes + " · " : ""}secret reference rotated to ${ref}` } });
        result = { secretReference: ref, note: "Only the reference is stored; no credential value is ever persisted or logged" };
        break;
      }
    }
    await appendAudit(prisma, { actorUserId: user.id, action: `integration.${action.toLowerCase()}`, objectType: "SourceWatermark", objectId: source, reason: reason ?? null, changes: result ?? undefined });
    return ok({ result, watermark: await prisma.sourceWatermark.findUnique({ where: { sourceSystem: source } }) });
  } catch (e) {
    return fail(e);
  }
}
