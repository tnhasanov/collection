import { prisma } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { notFound, conflict } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";

/** Packet download (JSON) for an exported/approved handover; audited as an export. */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("recovery.manage");
  const { id } = await ctx.params;
  const h = await prisma.handoverPacket.findUnique({ where: { id } });
  if (!h) throw notFound("Handover not found");
  if (!["APPROVED", "EXPORTED", "ACCEPTED"].includes(h.status)) throw conflict(`Packet is ${h.status}; export requires approval`);
  await appendAudit(prisma, { actorUserId: user.id, action: "handover.packet_downloaded", objectType: "HandoverPacket", objectId: id, caseId: h.caseId });
  return new Response(JSON.stringify(h.packet, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="handover-${id}.json"` } });
});
