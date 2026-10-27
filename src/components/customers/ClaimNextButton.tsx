"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast } from "@/components/ui";

export function ClaimNextButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <Toast message={msg} tone="warning" />
      <Button
        variant="primary"
        disabled={busy}
        title="Controlled fallback: atomically claims the next eligible item under the same policy as the dialer"
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/work-items/claim-next", { method: "POST" });
          const json = await res.json();
          setBusy(false);
          if (!json.ok) return setMsg(json.error.message);
          if (!json.data.workItem) return setMsg(`No eligible work right now${json.data.skipped?.length ? ` (${json.data.skipped.length} items deferred during re-check)` : ""}.`);
          router.push(`/customers/${json.data.workItem.customerId}?from=queue&claimed=${json.data.workItem.id}`);
        }}
      >
        {busy ? "Claiming…" : "Get next customer"}
      </Button>
    </>
  );
}
