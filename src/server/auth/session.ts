import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/server/db";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import { forbidden, unauthorized } from "@/server/errors";
import type { Role, Language, Seniority } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "atb_session";
const SESSION_HOURS = 10;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  teamId: string | null;
  teamName: string | null;
  languages: Language[];
  skills: string[];
  branchScopes: string[];
  seniority: Seniority | null;
  extension: string | null;
  providerAgentRef: string | null;
  sessionId: string;
  sessionExpiresAt: Date;
}

export function isDemoMode(): boolean {
  return process.env.APP_MODE === "DEMO";
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await prisma.session.create({ data: { token, userId, expiresAt, userAgent: meta.userAgent?.slice(0, 200), ip: meta.ip } });
  return { token, expiresAt };
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({ where: { token, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function loadSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { team: true, agentProfile: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now() || !session.user.isActive) return null;
  const u = session.user;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
    languages: u.languages,
    skills: u.skills,
    branchScopes: u.branchScopes,
    seniority: u.agentProfile?.seniority ?? null,
    extension: u.agentProfile?.extension ?? null,
    providerAgentRef: u.agentProfile?.providerAgentRef ?? null,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
  };
}

/** Cached per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return loadSessionUser(store.get(SESSION_COOKIE)?.value);
});

export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  if (permission && !hasPermission(user.role, permission)) throw forbidden(`Missing permission ${permission}`);
  return user;
}

export function can(user: SessionUser | null, permission: Permission): boolean {
  return !!user && hasPermission(user.role, permission);
}
