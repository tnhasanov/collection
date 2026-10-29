import Image from "next/image";
import { LoginForm } from "@/app/login/LoginForm";
import { prisma } from "@/server/db";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { appMode, isDemoMode } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const MODE_NOTE: Record<string, string> = {
  DEMO: "DEMO mode: synthetic data only, mock integrations, shared local demo identities. No real call, message, payment or loan change can occur.",
  PILOT: "PILOT mode: synthetic data and mock integrations with individual tester identities. Shared credentials and role switching are disabled; every action is attributed to the signed-in tester.",
  INTEGRATION: "INTEGRATION mode: sign in with the bank identity provider.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  const mode = appMode();
  const demo = isDemoMode();
  const [users, sharedActive] = await Promise.all([
    demo ? prisma.user.findMany({ where: { isActive: true, isServiceAccount: false }, orderBy: { role: "asc" }, select: { username: true, displayName: true, role: true } }) : Promise.resolve([]),
    mode === "PILOT" ? prisma.user.count({ where: { isActive: true, isServiceAccount: false, email: { endsWith: "@demo.atb.local" }, mustChangePassword: false } }) : Promise.resolve(0),
  ]);
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto grid min-h-screen max-w-5xl grid-cols-1 items-center gap-8 px-4 py-10 md:grid-cols-[1.1fr_1fr]">
        <section className="hidden md:block">
          <Image src="/brand/atb-logo.svg" alt="atb" width={85} height={55} priority />
          <h1 className="mt-6 text-3xl font-bold text-ink">ATB Collections</h1>
          <p className="mt-2 max-w-md text-muted">Internal collections operating layer for unsecured AZN consumer cash loans. Core banking stays the financial source of truth; this application owns cases, decisions, contacts, promises and operational history.</p>
          <p className="mt-6 text-xs text-muted">{MODE_NOTE[mode]}</p>
        </section>
        <section className="card card-pad">
          <div className="mb-4 flex items-center gap-3 md:hidden">
            <Image src="/brand/atb-logo.svg" alt="atb" width={60} height={39} priority />
            <span className="text-lg font-bold">ATB Collections</span>
          </div>
          <h2 className="text-lg font-bold">Sign in</h2>
          {reason === "session" && (
            <p className="callout callout-warning mt-2" role="status">
              Your session expired or you are not signed in. Please sign in again.
            </p>
          )}
          {reason === "denied" && (
            <p className="callout callout-danger mt-2" role="alert">
              Access denied for the requested page. Sign in with an authorized account.
            </p>
          )}
          {reason === "password" && (
            <p className="callout callout-success mt-2" role="status">
              Password changed. Sign in with your new password.
            </p>
          )}
          {mode === "PILOT" && sharedActive > 0 && (
            <p className="callout callout-warning mt-2" role="status">
              {sharedActive} shared demo identities are still active in this PILOT environment. Disable them with <code>npm run pilot:users -- --disable-demo-identities</code> before inviting testers.
            </p>
          )}
          <LoginForm next={next ?? null} demoUsers={users.map((u) => ({ username: u.username, label: `${u.displayName} · ${ROLE_LABELS[u.role]}` }))} mode={mode} />
        </section>
      </div>
    </main>
  );
}
