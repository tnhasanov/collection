"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast } from "@/components/ui";
import { ContactOutcomeDrawer, type DrawerCustomer, type DrawerPreset } from "@/components/customers/ContactOutcomeDrawer";

export function CustomerActions({ customer, serverNow, canWrite }: { customer: DrawerCustomer; serverNow: string; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<DrawerPreset | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "success" | "danger" | "warning" } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canWrite) return null;
  async function sms() {
    setBusy(true);
    const res = await fetch(`/api/customers/${customer.id}/sms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateCode: "SMS-REMINDER-01" }) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) setToast({ message: `${json.error.message}${json.error.details?.reasons ? `: ${json.error.details.reasons.join(", ")}` : ""}`, tone: "warning" });
    else setToast({ message: json.data.duplicate ? "Already queued today" : "Approved SMS queued to the local outbound log (DEMO)", tone: "success" });
    router.refresh();
  }
  async function escalate() {
    const reason = window.prompt("Escalation reason (recorded in the audit trail):");
    if (!reason) return;
    const res = await fetch(`/api/customers/${customer.id}/escalate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const json = await res.json();
    setToast(json.ok ? { message: "Escalation task created for the team lead", tone: "success" } : { message: json.error.message, tone: "danger" });
    router.refresh();
  }
  return (
    <>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setOpen("outcome")}>
          Record contact
        </Button>
        <Button onClick={() => setOpen("ptp")}>Create promise to pay</Button>
        <Button onClick={() => setOpen("callback")}>Schedule callback</Button>
        <Button onClick={sms} disabled={busy} title="Policy re-checked at dispatch; DEMO writes to the local outbound log">
          Send approved SMS
        </Button>
        <Button onClick={() => setOpen("support")}>Request repayment support</Button>
        <Button onClick={() => setOpen("dispute")}>Raise dispute</Button>
        <Button variant="ghost" onClick={escalate}>
          Request escalation
        </Button>
      </div>
      {open && <ContactOutcomeDrawer key={open} customer={customer} open={!!open} onClose={() => setOpen(null)} preset={open} serverNow={serverNow} />}
    </>
  );
}
