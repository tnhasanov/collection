"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";

export function LoginForm({ next, demoUsers, mode }: { next: string | null; demoUsers: { username: string; label: string }[]; mode: "DEMO" | "PILOT" | "INTEGRATION" }) {
  const router = useRouter();
  const demo = mode === "DEMO";
  const [username, setUsername] = useState(demo ? "agent.a" : "");
  const [password, setPassword] = useState(demo ? "demo1234" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error?.message ?? "Sign-in failed");
      return;
    }
    const target = next && next.startsWith("/") ? next : json.data.landing;
    router.replace(json.data.mustChangePassword ? `/account/password?next=${encodeURIComponent(target)}` : target);
    router.refresh();
  }

  if (mode === "INTEGRATION") {
    return <p className="callout callout-info mt-4">Sign-in is handled by the bank identity provider in INTEGRATION mode. Local passwords are disabled.</p>;
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" aria-describedby={error ? "login-error" : undefined}>
      {demo && (
        <Field label="Demo identity" htmlFor="demo-user" hint="Local demo identity provider (OIDC/SSO adapter boundary). Password for every demo user: demo1234">
          <Select id="demo-user" value={username} onChange={(e) => setUsername(e.target.value)}>
            {demoUsers.map((u) => (
              <option key={u.username} value={u.username}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {mode === "PILOT" && <p className="text-xs text-muted">Use the individual tester identity you were given. The first sign-in asks you to set a personal password; nothing is shared between testers.</p>}
      <Field label="Username" htmlFor="username" required>
        <Input id="username" name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!demo} />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && (
        <p id="login-error" className="callout callout-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
