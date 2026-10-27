"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";

export function LoginForm({ next, demoUsers, demo }: { next: string | null; demoUsers: { username: string; label: string }[]; demo: boolean }) {
  const router = useRouter();
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
    router.replace(next && next.startsWith("/") ? next : json.data.landing);
    router.refresh();
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
      <Field label="Username" htmlFor="username" required>
        <Input id="username" name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
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
