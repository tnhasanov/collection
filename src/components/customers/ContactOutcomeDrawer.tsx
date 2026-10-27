"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, bakuTodayIso, toBakuLocalInput, fromBakuLocalInput, humanize } from "@/lib/format";
import { IDENTITY_OPTIONS, OUTCOME_OPTIONS, REASON_OPTIONS, TECHNICAL_OPTIONS, allowedOutcomesFor } from "@/components/customers/outcomeOptions";

export type DrawerPreset = "outcome" | "ptp" | "callback" | "support" | "dispute";

export interface DrawerCustomer {
  id: string;
  name: string;
  cif: string;
  language: string;
  maxDpd: number;
  overdue: string;
  bucket: number | null;
  requiredSkill: string | null;
  loans: { id: string; coreLoanId: string; totalOverdue: string; oldestUnpaidDueDate: string | null }[];
  contacts: { id: string; type: string; value: string; verification: string; isPrimary: boolean }[];
  scriptSummary: string;
}

interface Eligibility {
  eligible: boolean;
  reasons: string[];
  nextAllowedAt: string | null;
  policyVersion: string;
}

export function ContactOutcomeDrawer({ customer, open, onClose, preset, serverNow }: { customer: DrawerCustomer; open: boolean; onClose: () => void; preset: DrawerPreset; serverNow: string }) {
  const router = useRouter();
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [channel, setChannel] = useState<"VOICE_INBOUND" | "MANUAL_NOTE" | "VOICE_OUTBOUND">("VOICE_INBOUND");
  const [technical, setTechnical] = useState("ANSWERED");
  const [identity, setIdentity] = useState(preset === "outcome" ? "" : "RPC_VERIFIED");
  const [outcome, setOutcome] = useState(preset === "ptp" ? "PTP" : preset === "callback" ? "CALLBACK_REQUESTED" : preset === "support" ? "SUPPORT_NEEDED" : preset === "dispute" ? "DISPUTE" : "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [contactPointId, setContactPointId] = useState(customer.contacts.find((c) => c.isPrimary)?.id ?? "");
  const overdueLoans = customer.loans.filter((l) => Number(l.totalOverdue) > 0);
  const [ptp, setPtp] = useState({ amount: overdueLoans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2), deadlineDate: bakuTodayIso(serverNow), coveredLoanIds: overdueLoans.map((l) => l.id), customerConfirmed: false });
  const [cb, setCb] = useState({ dueAt: new Date(new Date(serverNow).getTime() + 86_400_000).toISOString(), customerRequested: true, ownerMode: "ME" as "ME" | "POOL" });
  const [claim, setClaim] = useState({ amount: "", date: "", channel: "", reference: "" });
  const [dispute, setDispute] = useState("");
  const [support, setSupport] = useState({ type: "HARDSHIP", reason: "" });
  const [wrongCp, setWrongCp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [idKey] = useState(() => `drawer-${customer.id}-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/customers/${customer.id}/eligibility?channel=VOICE`)
      .then((r) => r.json())
      .then((j) => j.ok && setElig(j.data))
      .catch(() => undefined);
  }, [open, customer.id]);

  const outcomes = allowedOutcomesFor(identity);
  const rpc = identity === "RPC_VERIFIED";

  async function submit() {
    setBusy(true);
    setError(null);
    setErrors([]);
    const body = {
      customerId: customer.id,
      channel,
      technicalResult: technical,
      contactPointId: contactPointId || null,
      outcome: {
        idempotencyKey: idKey,
        identityStatus: identity,
        businessOutcome: outcome,
        nonPaymentReason: reason || null,
        note: note || null,
        ptp: outcome === "PTP" || outcome === "PARTIAL_COMMITMENT" ? ptp : null,
        callback: outcome === "CALLBACK_REQUESTED" ? cb : null,
        paidClaim: outcome === "ALREADY_PAID_CLAIM" ? { amount: claim.amount || null, date: claim.date || null, channel: claim.channel || null, reference: claim.reference || null } : null,
        wrongNumber: identity === "WRONG_NUMBER" ? { contactPointId: wrongCp } : null,
        dispute: outcome === "DISPUTE" ? { reason: dispute } : null,
        support: outcome === "SUPPORT_NEEDED" || outcome === "SPECIAL_REFERRAL" ? support : null,
        returnReady: false,
      },
    };
    const res = await fetch("/api/interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error.message);
      const d = json.error.details as { errors?: string[]; reasons?: string[] } | null;
      if (d?.errors) setErrors(d.errors);
      if (d?.reasons) setErrors(d.reasons);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Record contact outcome" wide>
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <section className="space-y-3 text-sm">
          <div>
            <h3 className="font-bold">{customer.name}</h3>
            <p className="text-xs text-muted">
              {customer.cif} · {customer.language} · DPD {customer.maxDpd} · overdue {fmtAzn(customer.overdue)} · bucket {customer.bucket ?? "—"} {customer.requiredSkill === "SENIOR" ? "· senior" : ""}
            </p>
          </div>
          <div>
            <p className="label">Pre-contact check (server policy)</p>
            {elig ? (
              elig.eligible ? (
                <Badge tone="success">Eligible now · {elig.policyVersion}</Badge>
              ) : (
                <div className="callout callout-warning text-xs">
                  Blocked for outbound: {elig.reasons.join(", ")}
                  {elig.nextAllowedAt ? ` · next allowed ${fmtDateTime(elig.nextAllowedAt)}` : ""}
                  <br />
                  Inbound calls and manual notes can still be recorded; an agent-initiated outbound call is refused.
                </div>
              )
            ) : (
              <span className="text-xs text-muted">Checking…</span>
            )}
          </div>
          <Field label="Channel / direction" htmlFor="d-channel">
            <Select id="d-channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="VOICE_INBOUND">Inbound call from customer</option>
              <option value="MANUAL_NOTE">Manual note (no call)</option>
              <option value="VOICE_OUTBOUND">Outbound call (controlled exception; eligibility enforced)</option>
            </Select>
          </Field>
          <Field label="Dialed / used contact" htmlFor="d-contact">
            <Select id="d-contact" value={contactPointId} onChange={(e) => setContactPointId(e.target.value)}>
              <option value="">—</option>
              {customer.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type} {c.value} ({c.verification.toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Connectivity (technical result)" htmlFor="d-tech">
            <Select id="d-tech" value={technical} onChange={(e) => setTechnical(e.target.value)}>
              {TECHNICAL_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-md bg-canvas p-2 text-xs text-muted">
            <p className="font-bold text-ink">Approved script</p>
            <p>{customer.scriptSummary}</p>
          </div>
        </section>
        <section className="space-y-3">
          <p className="text-xs text-muted">Contact time: {fmtDateTime(serverNow)} Baku. Connectivity, identity verification and disposition are separate fields; answered is not automatically right-party contact.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Identity verification" htmlFor="d-identity" required>
              <Select id="d-identity" value={identity} onChange={(e) => { setIdentity(e.target.value); if (!allowedOutcomesFor(e.target.value).includes(outcome)) setOutcome(allowedOutcomesFor(e.target.value)[0]); }}>
                <option value="">Select…</option>
                {IDENTITY_OPTIONS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Disposition" htmlFor="d-outcome" required>
              <Select id="d-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={!identity}>
                <option value="">Select…</option>
                {OUTCOME_OPTIONS.filter((o) => outcomes.includes(o[0])).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {rpc && (
              <Field label="Reason for nonpayment" htmlFor="d-reason">
                <Select id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Select…</option>
                  {REASON_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {identity === "WRONG_NUMBER" && (
              <Field label="Wrong contact point" htmlFor="d-wrong" required>
                <Select id="d-wrong" value={wrongCp} onChange={(e) => setWrongCp(e.target.value)}>
                  <option value="">Select…</option>
                  {customer.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.type} {c.value}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {(outcome === "PTP" || outcome === "PARTIAL_COMMITMENT") && (
            <div className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-2">
              <Field label="Promised amount (AZN)" htmlFor="d-ptp-amount" required>
                <Input id="d-ptp-amount" inputMode="decimal" value={ptp.amount} onChange={(e) => setPtp({ ...ptp, amount: e.target.value })} />
              </Field>
              <Field label="Payment deadline" htmlFor="d-ptp-date" required>
                <Input id="d-ptp-date" type="date" min={bakuTodayIso(serverNow)} value={ptp.deadlineDate} onChange={(e) => setPtp({ ...ptp, deadlineDate: e.target.value })} />
              </Field>
              <div className="col-span-full text-sm">
                <p className="label">Covered obligation</p>
                {customer.loans.map((l) => (
                  <label key={l.id} className="mr-3 inline-flex items-center gap-1">
                    <input type="checkbox" checked={ptp.coveredLoanIds.includes(l.id)} onChange={(e) => setPtp({ ...ptp, coveredLoanIds: e.target.checked ? [...ptp.coveredLoanIds, l.id] : ptp.coveredLoanIds.filter((x) => x !== l.id) })} />
                    {l.coreLoanId} ({fmtAzn(l.totalOverdue)} overdue{l.oldestUnpaidDueDate ? `, oldest ${fmtDate(l.oldestUnpaidDueDate)}` : ""})
                  </label>
                ))}
              </div>
              <label className="col-span-full inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ptp.customerConfirmed} onChange={(e) => setPtp({ ...ptp, customerConfirmed: e.target.checked })} /> Customer confirmed the amount and date
              </label>
            </div>
          )}
          {outcome === "CALLBACK_REQUESTED" && (
            <div className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-2">
              <Field label="Callback time (Baku)" htmlFor="d-cb" required>
                <Input id="d-cb" type="datetime-local" value={toBakuLocalInput(cb.dueAt)} onChange={(e) => setCb({ ...cb, dueAt: fromBakuLocalInput(e.target.value) ?? cb.dueAt })} />
              </Field>
              <Field label="Owner" htmlFor="d-cb-owner">
                <Select id="d-cb-owner" value={cb.ownerMode} onChange={(e) => setCb({ ...cb, ownerMode: e.target.value as "ME" | "POOL" })}>
                  <option value="ME">Me</option>
                  <option value="POOL">Eligible pool</option>
                </Select>
              </Field>
              <label className="col-span-full inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cb.customerRequested} onChange={(e) => setCb({ ...cb, customerRequested: e.target.checked })} /> Requested by the customer
              </label>
            </div>
          )}
          {outcome === "ALREADY_PAID_CLAIM" && (
            <div className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-4">
              <Field label="Amount" htmlFor="d-claim-amount"><Input id="d-claim-amount" value={claim.amount} onChange={(e) => setClaim({ ...claim, amount: e.target.value })} /></Field>
              <Field label="Date" htmlFor="d-claim-date"><Input id="d-claim-date" type="date" value={claim.date} onChange={(e) => setClaim({ ...claim, date: e.target.value })} /></Field>
              <Field label="Channel" htmlFor="d-claim-channel"><Input id="d-claim-channel" value={claim.channel} onChange={(e) => setClaim({ ...claim, channel: e.target.value })} /></Field>
              <Field label="Reference" htmlFor="d-claim-ref"><Input id="d-claim-ref" value={claim.reference} onChange={(e) => setClaim({ ...claim, reference: e.target.value })} /></Field>
            </div>
          )}
          {outcome === "DISPUTE" && (
            <Field label="Dispute reason" htmlFor="d-dispute" required><Input id="d-dispute" value={dispute} onChange={(e) => setDispute(e.target.value)} /></Field>
          )}
          {(outcome === "SUPPORT_NEEDED" || outcome === "SPECIAL_REFERRAL") && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Referral type" htmlFor="d-support-type" required>
                <Select id="d-support-type" value={support.type} onChange={(e) => setSupport({ ...support, type: e.target.value })}>
                  {outcome === "SUPPORT_NEEDED" ? (<><option value="HARDSHIP">Hardship / repayment support</option><option value="COMPLAINT">Complaint</option></>) : (<><option value="SPECIAL_HANDLING">Special handling</option><option value="DECEASED_LEGAL">Deceased / legal notification</option></>)}
                </Select>
              </Field>
              <Field label="Reason" htmlFor="d-support-reason" required><Input id="d-support-reason" value={support.reason} onChange={(e) => setSupport({ ...support, reason: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Agent note" htmlFor="d-note"><Textarea id="d-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
          {rpc && <Callout tone="success">Saving a verified conversation applies the 120-hour demo call cooldown customer-wide. PTP protection is evaluated separately.</Callout>}
          {error && (
            <Callout tone="danger">
              {error}
              {errors.length > 0 && (<ul className="mt-1 list-disc pl-5">{errors.map((e) => (<li key={e}>{e}</li>))}</ul>)}
            </Callout>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !identity || !outcome} onClick={submit}>{busy ? "Saving…" : outcome === "PTP" ? "Save outcome & promise" : "Save outcome"}</Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
          <p className="text-xs text-muted">Connectivity alone does not establish right-party contact. {humanize(outcome) || ""}</p>
        </section>
      </div>
    </Dialog>
  );
}
