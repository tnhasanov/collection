import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { createSession, requireUser, revokeSession, SESSION_COOKIE } from "@/server/auth/session";
import { landingPathForRole } from "@/server/auth/permissions";
import { appendAudit } from "@/server/modules/audit/audit";
import { forbidden } from "@/server/errors";
import { cookies } from "next/headers";

const schema = z.object({ username: z.string().min(1) });

/** DEMO-only role switching for walkthroughs. Refused in INTEGRATION mode and audited. It never grants approval rights to the maker. */
export async function POST(req: Request) {
  try {
    if (process.env.APP_MODE !== "DEMO") throw forbidden("Role switching is disabled outside DEMO mode");
    const current = await requireUser("demo.switch-role");
    const { username } = await parseBody(req, schema);
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target || !target.isActive || target.isServiceAccount) throw forbidden("Unknown demo user");
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) await revokeSession(token);
    const session = await createSession(target.id);
    await appendAudit(prisma, { actorUserId: current.id, action: "auth.demo_role_switch", objectType: "User", objectId: target.id, changes: { from: current.username, to: target.username } });
    const res = ok({ landing: landingPathForRole(target.role) });
    res.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: session.expiresAt });
    return res;
  } catch (e) {
    return fail(e);
  }
}
