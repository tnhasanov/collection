import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody, clientIp } from "@/server/http";
import { verifyPassword } from "@/server/auth/password";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { landingPathForRole } from "@/server/auth/permissions";
import { appendAudit } from "@/server/modules/audit/audit";
import { unauthorized } from "@/server/errors";

const schema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });

/** Local demo identity provider. Production replaces this with the bank OIDC/SSO adapter; demo accounts are refused outside DEMO mode. */
export async function POST(req: Request) {
  try {
    const { username, password } = await parseBody(req, schema);
    if (process.env.APP_MODE !== "DEMO") throw unauthorized("Local demo sign-in is disabled outside DEMO mode; use the bank identity provider");
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user || !user.isActive || user.isServiceAccount || !verifyPassword(password, user.passwordHash)) {
      await appendAudit(prisma, { action: "auth.login.failed", objectType: "User", objectId: user?.id ?? null, ip: clientIp(req), blocked: true, changes: { username } });
      throw unauthorized("Invalid username or password");
    }
    const session = await createSession(user.id, { userAgent: req.headers.get("user-agent") ?? undefined, ip: clientIp(req) });
    await appendAudit(prisma, { actorUserId: user.id, action: "auth.login", objectType: "User", objectId: user.id, ip: clientIp(req) });
    const res = ok({ landing: landingPathForRole(user.role), role: user.role, displayName: user.displayName });
    res.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: session.expiresAt });
    return res;
  } catch (e) {
    return fail(e);
  }
}
