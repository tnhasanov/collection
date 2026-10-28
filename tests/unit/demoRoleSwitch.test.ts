import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  authenticated: true,
  db: {
    session: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ prisma: state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => state.authenticated ? { value: "existing-demo-session" } : undefined,
  }),
}));

// Exercise the route with the real session and role-permission services; only storage/request cookies are mocked.
import { POST } from "@/app/api/auth/switch-role/route";

const request = () => new Request("https://demo.example/api/auth/switch-role", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "agent.a" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_MODE", "DEMO");
  state.role = "ADMIN";
  state.authenticated = true;
  state.db.session.findUnique.mockImplementation(async () => ({
    id: "session-admin",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: {
      id: "user-admin",
      username: "admin",
      displayName: "Demo administrator",
      role: state.role,
      isActive: true,
      teamId: null,
      team: null,
      agentProfile: null,
      languages: ["AZ"],
      skills: [],
      branchScopes: [],
    },
  }));
  state.db.user.findUnique.mockResolvedValue({
    id: "user-agent",
    username: "agent.a",
    role: "AGENT",
    isActive: true,
    isServiceAccount: false,
  });
  state.db.session.create.mockResolvedValue({ id: "new-session" });
  state.db.session.updateMany.mockResolvedValue({ count: 1 });
  state.db.auditEvent.create.mockResolvedValue({ id: "audit-switch" });
});

afterEach(() => vi.unstubAllEnvs());

describe("demo role-switch authorization", () => {
  it.each(["AGENT", "SENIOR_AGENT", "TEAM_LEAD", "RISK_ANALYST"])("refuses a %s before looking up or switching the target", async (role) => {
    state.role = role;
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(state.db.user.findUnique).not.toHaveBeenCalled();
    expect(state.db.session.create).not.toHaveBeenCalled();
    expect(state.db.session.updateMany).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an unauthenticated request", async () => {
    state.authenticated = false;
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(state.db.user.findUnique).not.toHaveBeenCalled();
    expect(state.db.session.create).not.toHaveBeenCalled();
  });

  it("remains disabled outside DEMO mode", async () => {
    vi.stubEnv("APP_MODE", "INTEGRATION");
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(state.db.session.findUnique).not.toHaveBeenCalled();
    expect(state.db.session.create).not.toHaveBeenCalled();
  });

  it("allows an authorized administrator, revokes the old session and keeps the HTTPS cookie secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { landing: "/agent" } });
    expect(state.db.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { token: "existing-demo-session", revokedAt: null } }));
    expect(state.db.session.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "user-agent" }) }));
    expect(state.db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: "user-admin", action: "auth.demo_role_switch", objectId: "user-agent" }) }));
    expect(res.headers.get("set-cookie")).toMatch(/; Secure(?:;|$)/i);
    expect(res.headers.get("set-cookie")).toMatch(/; HttpOnly(?:;|$)/i);
  });

  it("does not let an administrator switch into a service account", async () => {
    state.db.user.findUnique.mockResolvedValue({ id: "svc", username: "svc.core-feed", role: "SERVICE", isActive: true, isServiceAccount: true });
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(state.db.session.create).not.toHaveBeenCalled();
    expect(state.db.session.updateMany).not.toHaveBeenCalled();
  });
});
