"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast } from "@/components/ui";

export function IntegrationActions({ source, paused, disabled }: { source: string; paused: boolean; disabled: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function act(action: string) {
    const r = await fetch(`/api/integrations/${source}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: "operator action from S21" }) });
    const j = await r.json();
    setMsg(j.ok ? `${action}: ${j.data.result ? JSON.stringify(j.data.result).slice(0, 160) : "ok"}` : j.error.message);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Toast message={msg} tone="info" />
      <Button size="sm" disabled={disabled} onClick={() => act("TEST")}>Test</Button>
      <Button size="sm" disabled={disabled} onClick={() => act("DRY_RUN")}>Dry-run</Button>
      {paused ? <Button size="sm" onClick={() => act("RESUME")}>Resume</Button> : <Button size="sm" disabled={disabled} onClick={() => act("PAUSE")}>Pause</Button>}
      <Button size="sm" disabled={disabled} onClick={() => act("REFRESH_NOW")}>Refresh now</Button>
      <Button size="sm" variant="ghost" onClick={() => act("ROTATE_SECRET_REF")}>Rotate secret ref</Button>
    </div>
  );
}

export function OutboxReplay({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button size="sm" onClick={async () => { await fetch(`/api/integrations/outbox/${id}/replay`, { method: "POST" }); router.refresh(); }}>
      Replay
    </Button>
  );
}
