import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody, clientIp } from "@/server/http";
import { verifyPassword } from "@/server/auth/password";
import { appMode, createSession, localSignInEnabled, SESSION_COOKIE } from "@/server/auth/session";
import { landingPathForRole } from "@/server/auth/permissions";
import { appendAudit } from "@/server/modules/audit/audit";
import { unauthorized } from "@/server/errors";
import { checkLoginRateLimit, recordLoginFailure } from "@/server/auth/rateLimit";

const schema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });

/**
 * Local identity provider for DEMO (shared walkthrough identities) and PILOT (individual tester identities with a
 * forced password change on first sign-in). INTEGRATION mode refuses it: the bank OIDC/SSO adapter signs users in.
 * Failed attempts are rate limited per IP and per username and audited.
 */
export async function POST(req: Request) {
  try {
    const { username, password } = await parseBody(req, schema);
    if (!localSignInEnabled()) throw unauthorized("Local sign-in is disabled outside DEMO/PILOT mode; use the bank identity provider");
    const ip = clientIp(req);
    checkLoginRateLimit({ ip, username });
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user || !user.isActive || user.isServiceAccount || !verifyPassword(password, user.passwordHash)) {
      recordLoginFailure({ ip, username });
      await appendAudit(prisma, { action: "auth.login.failed", objectType: "User", objectId: user?.id ?? null, ip, blocked: true, changes: { username, mode: appMode() } });
      throw unauthorized("Invalid username or password");
    }
    const session = await createSession(user.id, { userAgent: req.headers.get("user-agent") ?? undefined, ip });
    await appendAudit(prisma, { actorUserId: user.id, action: "auth.login", objectType: "User", objectId: user.id, ip, changes: { mode: appMode(), mustChangePassword: user.mustChangePassword } });
    const res = ok({ landing: landingPathForRole(user.role), role: user.role, displayName: user.displayName, mustChangePassword: user.mustChangePassword });
    res.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: session.expiresAt });
    return res;
  } catch (e) {
    return fail(e);
  }
}
