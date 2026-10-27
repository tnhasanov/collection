import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { ok } from "@/server/http";
import { getSessionUser, revokeSession, SESSION_COOKIE } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser();
  if (token) await revokeSession(token);
  if (user) {
    await prisma.agentSession.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false, endedAt: new Date(), confirmedState: "OFFLINE", stateReason: "SIGNED_OUT" } });
    await appendAudit(prisma, { actorUserId: user.id, action: "auth.logout", objectType: "User", objectId: user.id });
  }
  const res = ok({ signedOut: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
  return res;
}
