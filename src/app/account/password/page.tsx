import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser, localSignInEnabled } from "@/server/auth/session";
import { PasswordForm } from "@/app/account/password/PasswordForm";

export const dynamic = "force-dynamic";

/** Password change for local identities. PILOT testers land here on first sign-in (mustChangePassword). */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!localSignInEnabled()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <section className="card card-pad w-full">
          <div className="mb-4 flex items-center gap-3">
            <Image src="/brand/atb-logo.svg" alt="atb" width={60} height={39} priority />
            <span className="text-lg font-bold">ATB Collections</span>
          </div>
          <h1 className="text-lg font-bold">{user.mustChangePassword ? "Set your personal password" : "Change password"}</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as <strong>{user.displayName}</strong> ({user.username}). {user.mustChangePassword ? "A personal password is required before you can continue; the temporary password you received stops working." : "Other active sessions of your account are signed out when the password changes."}
          </p>
          <PasswordForm next={next && next.startsWith("/") ? next : "/"} required={user.mustChangePassword} />
        </section>
      </div>
    </main>
  );
}
