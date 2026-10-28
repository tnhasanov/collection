# Agent interaction burden per scenario (measured in the browser, mock dialer)

Generated 2026-10-28T00:27:10.089Z by `npm run measure`. Manual searches and manual dials are zero by construction: the dialer reserves and dials automatically; the technical result is provider-derived. "Selections" are quick-choice cards, chips, checkboxes and dropdowns; "typing" counts fields where the agent typed; one final submission per call.

No-answer / busy attempts encountered during the run: 1 (completed with zero agent entry, agent returned to Ready automatically).

| Scenario | Searches | Manual dials | Selections | Typing | Final submissions | Duplicate entry |
|---|---:|---:|---:|---:|---:|---:|
| Verified borrower, full-payment promise | 0 | 0 | 6 | 0 | 1 | 0 |
| Partial-payment promise (other amount) | 0 | 0 | 6 | 1 | 1 | 0 |
| No commitment ('might pay Friday' as a statement) | 0 | 0 | 3 | 1 | 1 | 0 |
| Requested callback | 0 | 0 | 4 | 0 | 1 | 0 |
| Already-paid claim (details unknown) | 0 | 0 | 4 | 0 | 1 | 0 |
| Third-party answer | 0 | 0 | 2 | 0 | 1 | 0 |
| Wrong number | 0 | 0 | 2 | 0 | 1 | 0 |
| Dispute | 0 | 0 | 3 | 1 | 1 | 0 |
| Repayment-support referral | 0 | 0 | 4 | 1 | 1 | 0 |

## Steps and generated summaries

### Verified borrower, full-payment promise

- select: Borrower verified
- select: Reason: salary timing
- select: Payment promise
- select: Amount: overdue due now (suggested)
- select: Deadline: +3 days (suggested)
- confirm: Customer explicitly agreed
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: salary timing (customer-stated). Overdue due now 360.34 AZN (bank-verified, as of 27 Oct 2026, 12:28). Agreed payment: 360.34 AZN by 30 Oct 2026 (customer explicitly confirmed); covers the overdue amount in full. Payment pending verification by core banking. Next action: monitor the promise under the active contact policy; no routine call before 01 Nov 2026, 23:59 (policy CONTACT_POLICY/DEMO-01).

### Partial-payment promise (other amount)

- select: Borrower verified
- select: Reason: temporary shortfall
- select: Payment promise
- select: Other amount
- type: Agreed amount
- select: Deadline: +7 days
- confirm: Customer explicitly agreed
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: temporary cash shortfall (customer-stated). Overdue due now 693.70 AZN (bank-verified, as of 27 Oct 2026, 12:28). Agreed payment: 50.00 AZN by 03 Nov 2026 (customer explicitly confirmed); covers 50.00 of 693.70 AZN overdue (partial; residual arrears remain). Payment pending verification by core banking. Next action: monitor the promise under the active contact policy; no routine call before 05 Nov 2026, 23:59 (policy CONTACT_POLICY/DEMO-01).

### No commitment ('might pay Friday' as a statement)

- select: Borrower verified
- select: Reason: not stated
- select: No payment commitment
- type: Customer statement (optional)
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Reason not stated by the customer. Overdue due now 171.71 AZN (bank-verified, as of 27 Oct 2026, 12:28). No payment commitment made. Customer mentioned a possible payment "might pay Friday" (customer-stated, not a commitment; no promise created). Next action: verified-contact cooldown; no routine call before 01 Nov 2026, 12:29 (policy CONTACT_POLICY/DEMO-01).

### Requested callback

- select: Borrower verified
- select: Reason: salary timing
- select: Requested callback
- select: Agreed time: tomorrow 10:00 (suggested slot)
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: salary timing (customer-stated). Overdue due now 314.34 AZN (bank-verified, as of 27 Oct 2026, 12:28). Customer requested a callback for 28 Oct 2026, 10:00; scheduled 28 Oct 2026, 10:00 under policy. Next action: eligible callback; no routine call before 01 Nov 2026, 12:30 (policy CONTACT_POLICY/DEMO-01).

### Already-paid claim (details unknown)

- select: Borrower verified
- select: Reason: payment-channel problem
- select: Already paid (claim)
- select: Details unknown
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: technical payment issue (customer-stated). Overdue due now 430.88 AZN (bank-verified, as of 27 Oct 2026, 12:28). Customer claims a payment (customer-stated, not verified); reconciliation opened, hold until 29 Oct 2026, 12:30. Next action: reconcile the claimed payment; no routine call before 01 Nov 2026, 12:30 (policy CONTACT_POLICY/DEMO-01).

### Third-party answer

- select: Third party
- select: No borrower conversation
- submit: Save & pause (one final confirmation)

> Third party; no verified borrower contact. No conversation with the borrower took place. Next action: retry only within policy timing and limits (policy CONTACT_POLICY/DEMO-01).

### Wrong number

- select: Wrong number
- dropdown: Which contact point
- submit: Save & pause (one final confirmation)

> Wrong number; no verified borrower contact. No conversation with the borrower took place. Contact point flagged as wrong number (evidence-based correction). Next action: contact correction; use an eligible alternative contact (policy CONTACT_POLICY/DEMO-01).

### Dispute

- select: Borrower verified
- select: Reason: disputed debt
- select: Dispute
- type: Dispute reason (required)
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: disputed debt (customer-stated). Overdue due now 222.87 AZN (bank-verified, as of 27 Oct 2026, 12:30). Customer disputes the debt: Installment amount disputed (customer-stated); specialist review opened. Next action: dispute review; no routine call before 01 Nov 2026, 12:31 (policy CONTACT_POLICY/DEMO-01).

### Repayment-support referral

- select: Borrower verified
- select: Reason: income interruption
- select: Repayment support
- dropdown: Referral type
- type: Referral reason (required)
- submit: Save & pause (one final confirmation)

> Borrower verified under the approved procedure. Customer reported: income interruption (customer-stated). Overdue due now 161.49 AZN (bank-verified, as of 27 Oct 2026, 12:30). Repayment support requested (hardship): Job loss; asks for reduced plan (customer-stated); no contract change agreed. Next action: repayment-support assessment; no routine call before 01 Nov 2026, 12:31 (policy CONTACT_POLICY/DEMO-01).
