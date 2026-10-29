"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";

export function PasswordForm({ next, required }: { next: string; required: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) return setError("The two new passwords differ");
    setBusy(true);
    const res = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: pw }) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) return setError(json.error?.message ?? "Password change failed");
    router.replace(next);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <Field label={required ? "Temporary password" : "Current password"} htmlFor="pw-current" required>
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
      </Field>
      <Field label="New password" htmlFor="pw-new" required hint="At least 10 characters with a letter and a digit">
        <Input id="pw-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} />
      </Field>
      <Field label="Repeat new password" htmlFor="pw-confirm" required>
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} />
      </Field>
      {error && <p className="callout callout-danger" role="alert">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</Button>
    </form>
  );
}
