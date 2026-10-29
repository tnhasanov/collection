"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { SpecialCaseActions } from "@/components/customers/SpecialCaseActions";

export function ExceptionActions({ id, status, type, supportCaseId, canConfirmSpecial }: { id: string; status: string; type: string; supportCaseId?: string | null; canConfirmSpecial?: boolean }) {
  const router = useRouter();
  async function act(action: string, needReason = false) {
    const reason = needReason ? window.prompt("Reason (recorded in the audit trail):") : undefined;
    if (needReason && !reason) return;
    const r = await fetch(`/api/exceptions/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    const j = await r.json();
    if (!j.ok) window.alert(j.error.message);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-1">
      {status !== "RESOLVED" && type === "DECEASED_VERIFICATION" && supportCaseId && canConfirmSpecial && <SpecialCaseActions supportCaseId={supportCaseId} type="DECEASED_LEGAL" />}
      {status !== "RESOLVED" && <Button size="sm" onClick={() => act("ASSIGN_ME")}>Assign to me</Button>}
      {status !== "RESOLVED" && ["STALE_BALANCES", "STALE_FEATURES", "SOURCE_MISMATCH", "UNMATCHED_PAYMENT", "MISSING_MODEL_INPUT"].includes(type) && <Button size="sm" onClick={() => act("REQUEST_REFRESH", true)}>Request source refresh</Button>}
      {status !== "RESOLVED" ? <Button size="sm" variant="primary" onClick={() => act("RESOLVE", true)}>Resolve with reason</Button> : <Button size="sm" onClick={() => act("REOPEN")}>Reopen</Button>}
    </div>
  );
}
