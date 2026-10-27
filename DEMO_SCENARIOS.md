# Demo scenarios and acceptance mapping

Business date **27 Oct 2026** (Asia/Baku). All data is synthetic. Password for every demo identity: `demo1234`.

## Seeded scenario customers (`prisma/seed/scenarios.ts`)

| Customer | Situation | What it demonstrates |
|---|---|---|
| C-DEMO-001 (hero) | Loan L-DEMO-001: 10,000 / 18% / 24, first installment 20 Oct unpaid → DPD 7, class 8, ERA 4,200, bucket 10, rank 1 | The reference annuity fixture (499.24 = 150.00 + 349.24), senior-only routing, the full automatic journey |
| C-DEMO-002 … 004 | DPD 4–10 customers in classes 1–7 | All tree leaves appear in the daily snapshot |
| C-DEMO-005 | Verified RPC yesterday 14:00 | RPC cooldown (120 h) blocks routine calls; reason code `RPC_COOLDOWN` |
| C-DEMO-006 | DPD 45 | Later-stage review, no early-model score; handover packet (S26) |
| C-DEMO-007 | Two loans | One coordinated customer case, one exposure aggregation, one call task |
| C-DEMO-008 | Wrong number recorded yesterday | Invalid contact suppressed; master-data exception |
| C-DEMO-009 | Third-party answer yesterday | Not an RPC; still eligible |
| C-DEMO-010 | Failed attempt (NO_ANSWER) | Retry timing and failed-attempt limits |
| C-DEMO-011 | Promise kept (275.04 paid) | Promise attribution, cure, no case |
| C-DEMO-012 | Partial payment | Arrears remain; partial payments never cure |
| C-DEMO-013 | Promise deadline passed, feed uncertain | Pending reconciliation |
| C-DEMO-014 | Broken promise | Broken-promise follow-up |
| C-DEMO-015 | Customer claims already paid | Paid-claim reconciliation hold |
| C-DEMO-016 | Open dispute | `NO_OPEN_DISPUTE` block |
| C-DEMO-017 | Hardship under review, arrangement submitted | S10 flow (review → approval → mock core confirmation) |
| C-DEMO-018 | Stale balances | `BALANCES_FRESH` block (blocked/stale-data case) |
| C-DEMO-019 | Missing model features | Unscored → manual review, never an invented probability |
| C-DEMO-020 | Payment reversal | Reversal re-opens arrears with history |
| C-DEMO-021 | Paid-off loan | Closed episode |
| C-DEMO-022 | Core schedule differs from the simulation (installment 10) | Traceable mismatch, core schedule preserved |
| C-DEMO-023 | Duplicate CIF import | Import quarantine |
| C-DEMO-025 | Customer-requested callback 10:30 | Callback exception within eligibility |
| C-DEMO-026 | SMS-only treatment | Digital reminder via the local outbox |
| C-DEMO-027 / 028 | Two customers sharing a phone number | Trusted screen pop by customer/work/interaction ids, not by number |
| C-DEMO-029 | Deceased notification | Status block; legal handling |
| C-DEMO-030 | Current loan (DPD 0) | Not in the collections population |
| C-SYN-0001 … | Generic portfolio (≈ 250 customers) across all DPD bands, classes and unscored reasons | Realistic queues, buckets and analytics |

## The demonstrated journey (also automated in `npm run e2e`)

1. `agent.a` / `agent.b` → `/agent` → **Connect to dialer** → **Go Ready** (provider-confirmed).
2. Automatic reservation of the top eligible customer (one reservation per customer, one voice interaction per agent) → progressive dial → trusted screen pop (customer 360 + script + policy context).
3. **End** → after-call work → identity `RPC verified`, outcome `Promise to pay`, reason, promise defaults (full overdue, today) → customer confirmation → **Save outcome & return Ready** → provider wrap-up acknowledged → Ready (or Not ready).
4. Suppression: `/customers/<id>` shows "Routine calls suppressed until …" (RPC cooldown + PTP protection); the work queue no longer offers the customer.
5. `integrator` → `/payments` → simulator (or `POST /api/demo/payments/simulate`, kind `POST`, loan `L-DEMO-001`, 499.24) → allocation, promise attribution, cure at zero overdue, obsolete work withdrawn, dashboards and customer 360 updated.
6. Same transaction id with kind `REPLAY` → `DUPLICATE`, no duplicate amount, allocation, promise credit, task or message.
7. Failed-attempt retry: C-DEMO-010 (or any NO_ANSWER produced by the mock provider script) is deferred with the retry time and attempt counter visible in `/work-queue`.
8. Blocked/stale data: C-DEMO-018 (`BALANCES_FRESH`), C-DEMO-016 (`NO_OPEN_DISPUTE`), C-DEMO-005 (`RPC_COOLDOWN`) show reason codes on the eligibility panel and in the queue.

## Core acceptance scenarios (Part B §15) → where they are proven

| # | Scenario | Proof |
|---|---|---|
| 1 | Annuity fixture 10,000/18%/24; final adjustment; zero rate | `tests/unit/annuity.test.ts` |
| 2 | DPD 0 today / 1 tomorrow; partial payment keeps oldest installment; Baku midnight | `tests/unit/arrears.test.ts`, integration partial-payment test |
| 3 | Imported schedule unchanged by simulation; mismatch exceptions; no invented fees | C-DEMO-022, `/loans/L-DEMO-022` (versions tab), `loanDetailService` |
| 4 | All eight classes and boundaries; missing data not zero; unsupported population unscored | `tests/unit/decisions.test.ts`, S13 golden cases (13/13) |
| 5 | DPD 10 through the tree; DPD 11 later band; DPD 31 never scored | `segments.ts` + unit tests |
| 6 | ERA 4,200 vs 337 ranking; never labelled ECL | unit tests; `/overview` priority list; S14 wording |
| 7 | Class and bucket stored separately; deterministic reruns | `DecisionSnapshot` columns; `runDailyDecision` idempotent ranking |
| 8 | Two loans → one task; concurrent claims cannot double-claim | C-DEMO-007; integration concurrency test (`FOR UPDATE SKIP LOCKED`) |
| 9 | RPC at 27 Oct 10:00 suppresses until ≥ 1 Nov 10:00; new loan no bypass; same rule in API and dispatch | integration suppression test; `contextBuilder` used by both |
| 10 | Third party ≠ RPC; wrong number suppresses contact; retries obey timing/limits; no low-bucket routine call | C-DEMO-009/008/010; `evaluator.ts` |
| 11 | PTP protection; partial payment updates promise without double count; late feed → pending; reversal re-opens | C-DEMO-012/013/020; `promiseService` |
| 12 | Full arrears payment cures and leaves the non-matured loan open; paid claim alone cannot | integration payment test; C-DEMO-015 |
| 13 | Replaying events/imports/jobs never duplicates; out-of-order events ignored | integration duplicate tests; import duplicate protection; `SUPERSEDED` snapshots |
| 14 | Payment between queue and dispatch stops the contact; unknown provider response never triggers a duplicate send | integration payment-before-dial test; `WITHDRAWAL_UNACKNOWLEDGED` exception |
| 15 | IVR disabled → explicit SMS fallback; senior overflow visible and owned | treatment mapping; `SENIOR_CAPACITY_OVERFLOW` exception; S17 |
| 16 | Unapproved/expired versions cannot drive execution; no self-approval; agent cannot change rules or guess customer ids | `decisionRun` validity checks; `approvalService`; integration permission test; `access.ts` audit of denials |
| 17 | Import validation: missing ids, invalid dates, duplicates, control totals, quarantine, row-level results | S20 wizard; `importService` (exercised via API in this build) |
| 18 | Historical decisions keep their versions; rollback auditable | `DecisionSnapshot.modelVersionId/strategyVersionId/policyVersionId`; ROLLBACK approvals |
| 19 | Dashboards reconcile to rows; no duplicated exposure; fixed cohorts; not-yet-due PTPs excluded | `/overview` counts link to the queue; S18 definitions |
| 20 | No real external action in demo; production rejects demo endpoints | mocks only; `APP_MODE` guard on simulator and role switch |

## CTI scenarios (Part C §10)

| # | Scenario | Proof |
|---|---|---|
| 1 | Ready once → automatic call, no search/"get next" | e2e + integration CTI test |
| 2 | Correct 360/script from trusted ids, shared phone number | C-DEMO-027/028; reservation carries customer/work ids |
| 3 | No concurrent reservations for one customer; no second call to a busy agent | partial unique indexes; integration concurrency test |
| 4 | Campaign/language/seniority routing without corrupting ERA order; unscored/later-stage separate | `routingService`, `syncRoutineWorkItem` |
| 5 | Answered ≠ RPC; busy/no answer captured without invented conversation | `providerEventService` auto-records NO_CONVERSATION |
| 6 | End → ACW; PTP needs valid fields; next call waits for save + wrap-up ack | e2e; `requestAgentState` gating |
| 7 | Double save / replayed events do not duplicate | idempotency keys; integration duplicate-save test |
| 8 | RPC suppresses all entries; number change or campaign recycling cannot bypass | customer-wide policy |
| 9 | Payment before dial withdraws work; payment during call updates the screen | integration tests CTI-9/CTI-11 |
| 10 | Refresh / lost events / CTI disconnect recover call and draft; stale Ready cannot authorize | SSE + polling fallback; server-held drafts; heartbeat max age |
| 11 | Pending wrap-up or failed ack blocks continuation with supervisor recovery | `PROVIDER_WRAPUP_FAILURE` exception; S17 assisted wrap-up |
| 12 | Break during a call applies after wrap-up; transfer preserves segments | deferred break test; transfer unsupported by the mock (documented) |

Part D additions: partial-promise fulfilment without cure (C-DEMO-012), already-paid reconciliation with a stale
feed (C-DEMO-013/015), named callback fallback within eligibility (C-DEMO-025), payment arriving in each dispatch
state (integration tests), inbound/outbound contention — not implemented (no inbound provider), stated in
`BUILD_STATUS.md`.
