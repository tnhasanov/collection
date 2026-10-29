import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { ok, fail, parseBody, clientIp } from "@/server/http";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { localSignInEnabled, requireUser, SESSION_COOKIE } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { badRequest, forbidden } from "@/server/errors";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });

/** Password change for local identities (PILOT first sign-in and self-service). Other sessions of the user are revoked. */
export async function POST(req: Request) {
  try {
    if (!localSignInEnabled()) throw forbidden("Passwords are managed by the bank identity provider in INTEGRATION mode");
    const user = await requireUser();
    const { currentPassword, newPassword } = await parseBody(req, schema);
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) throw badRequest("The new password needs at least 10 characters including a letter and a digit");
    if (newPassword === currentPassword) throw badRequest("Choose a password you have not used before");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!verifyPassword(currentPassword, row.passwordHash)) {
      await appendAudit(prisma, { actorUserId: user.id, action: "auth.password_change.failed", objectType: "User", objectId: user.id, ip: clientIp(req), blocked: true });
      throw forbidden("Current password is incorrect");
    }
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword), mustChangePassword: false } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(token ? { token: { not: token } } : {}) }, data: { revokedAt: new Date() } }),
    ]);
    await appendAudit(prisma, { actorUserId: user.id, action: "auth.password_changed", objectType: "User", objectId: user.id, ip: clientIp(req) });
    return ok({ changed: true });
  } catch (e) {
    return fail(e);
  }
}
