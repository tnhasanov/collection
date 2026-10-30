"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast } from "@/components/ui";
import type { Locale } from "@/i18n/dictionaries";
import { at, errorText } from "@/i18n/agentText";

export function ClaimNextButton({ locale = "en" }: { locale?: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <Toast message={msg} tone="warning" />
      <Button
        variant="primary"
        disabled={busy}
        title={at(locale, "cl.claimTitle")}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/work-items/claim-next", { method: "POST" });
          const json = await res.json();
          setBusy(false);
          if (!json.ok) return setMsg(errorText(locale, json.error));
          if (!json.data.workItem) return setMsg(at(locale, "cl.claimNone"));
          router.push(`/customers/${json.data.workItem.customerId}?from=queue&claimed=${json.data.workItem.id}`);
        }}
      >
        {busy ? at(locale, "cl.claiming") : at(locale, "cl.claim")}
      </Button>
    </>
  );
}
