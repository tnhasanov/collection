# Agent workflow acceptance — guided desktop and mock dialer (28 Oct 2026)

Scope: the guided-agent blueprint (`docs/spec/ATB_Guided_Agent_Desktop_and_Dialer_Blueprint.md`) applied to the
existing build, then the operational acceptance pass requested for this night. Everything ran locally on synthetic
data with the deterministic mock dialer. **Mock validation proves the application logic and the intended agent
experience; it does not prove real audio, carrier, provider pacing, wrap-up mapping or Orange behaviour** (see §7).

Evidence legend: `INT` = integration test (`tests/integration/*.test.ts`, separate test database reset per file),
`UNIT` = unit test, `E2E` = browser flow (`npm run e2e`), `MEASURE` = instrumented browser run (`npm run measure`),
`SHOT` = screenshot in `docs/screenshots/`. Earlier evidence from the previous build (journey suite, screens) is reused
where the workflow did not change.

## 1. Collection-floor simulation

| Check | Expected | Actual | Evidence |
|---|---|---|---|
| Six agents (2 senior, 4 regular) connect and become Ready concurrently | Ready only after provider confirmation, all six confirmed | 6/6 confirmed READY with CTI connected | INT floor §1 |
| One active outbound reservation per customer across campaigns | A second campaign cannot reserve a reserved customer | 6 distinct customers; a duplicate reservation for any of them is rejected by the partial unique index | INT floor §2 |
| One voice interaction per agent | No second reservation/call for a busy agent | second allocation round reserves 0; `allocateForSession` → NOT_ELIGIBLE_AGENT for every agent | INT floor §2–3 |
| Seniority routing | Regular agents never receive senior-only work | asserted for every regular reservation; senior-only (bucket 10) stays with seniors | INT floor §2 |
| Correct customer and script appear automatically | Interaction bound to the reservation's customer; active script in the customer's language (EN fallback) | asserted for every answered call; identity stays unselected ("answered ≠ verified") | INT floor §3, SHOT `agent-live-1440.png` |
| Busy/no-answer recorded without agent entry | Auto-saved NO_CONVERSATION with provider result, no identity, wrap-up not required, agent back to Ready, retry under policy | NO_ANSWER attempt: status SAVED, technicalResult NO_ANSWER, identityStatus null, wrapUpStatus NOT_REQUIRED, agent READY, work item re-queued | INT floor §3; MEASURE no-answer attempts |
| Required wrap-up prevents another call | Ready refused and allocation skipped until saved + acknowledged | CONFLICT (WRAP_UP_REQUIRED) and NOT_ELIGIBLE_AGENT while in ACW | INT floor §4, INT journey |
| Failed save prevents another call | Invalid outcome (promise not confirmed) leaves the draft and the agent in ACW | UNPROCESSABLE; interaction still DRAFT; agent still ACW | INT floor §4 |
| Failed provider wrap-up acknowledgment | Agent held in ACW with a visible exception, idempotent retry | PROVIDER_WRAPUP_FAILURE exception; Ready refused; one command receipt | INT journey (CTI 11) |
| Break during a call | Applied after the required wrap-up | deferred: true → BREAK confirmed after save and acknowledgment | INT floor §4, INT journey (CTI 12) |
| Refresh / reconnect | Draft and call recovered from the server; stale Ready cannot allocate | draft survives; CONNECTION_PROBLEM pauses allocation; recovery restores TALKING from the provider; stale heartbeat → BROWSER_HEARTBEAT_STALE | INT floor §4 |
| Clock advancement instead of waiting | Cooldown (120 h) and PTP protection released at the advanced time; promise matured | at Mon 2 Nov 10:05 Baku: no RPC_COOLDOWN / PTP_PROTECTION; unpaid promise → BROKEN once the feed covers the window | INT floor §5 |

## 2. Guided conversation scenarios

| Scenario | Expected (blueprint) | Actual | Evidence |
|---|---|---|---|
| Verified borrower, full-payment promise | Only relevant fields; explicit agreement required; coverage derived; summary matches stored facts | unconfirmed promise refused; coverage FULL; promise ACTIVE; stored summary equals a deterministic rebuild from the stored fields; cooldown + PTP protection applied customer-wide | INT guided §1, UNIT summary, E2E, SHOT `agent-acw-1440.png` |
| Partial-payment promise with residual arrears | Derived PARTIAL_COMMITMENT; kept partial promise coexists with arrears; no cure | stored PARTIAL_COMMITMENT; after the partial posting the promise is satisfied, the case stays OPEN and overdue > 0 | INT guided §2 |
| No commitment, "I might pay Friday" | Statement with provenance, never a promise; "not stated" accepted | customerStatement stored; 0 promises; summary says "not a commitment; no promise created"; statement + confirmed promise is rejected | INT guided §3, UNIT summary |
| Requested callback | Scheduled under policy with named owner; permitted-time adjustment explicit | callback item owned by the agent at the agreed time; out-of-hours request moved to the next permitted time with an explicit message | INT guided §4 |
| Already-paid claim | Remains a claim until verified; reconciliation task + hold; balances untouched | claim OPEN, RECONCILIATION task, exception, NO_PAID_CLAIM_HOLD; overdue unchanged; no payment row created; summary says "customer-stated, not verified" | INT guided §5 |
| Third-party answer | Privacy script; no borrower outcome; no cooldown | PTP refused; NO_CONVERSATION with isRpc=false; no RPC_COOLDOWN | INT guided §6 |
| Wrong number | Evidence-based contact correction | contact point INVALID (WRONG_NUMBER), exception raised, next action CONTACT_CORRECTION, customer not callable on that point | INT guided §6 |
| Dispute | Owned specialist task; routine calls blocked | DISPUTE support case + DISPUTE_REVIEW task; NO_OPEN_DISPUTE | INT guided §7 |
| Repayment-support referral | Owned support case with restriction; no contract change | HARDSHIP case (restrictsCalls, restriction date) + SUPPORT_REVIEW task; NO_SUPPORT_HOLD | INT guided §7 |
| Independent flags | Flag alongside a primary outcome keeps both facts | support flag + promise: note required, promise created, follow-up task created, summary says "Also noted" | INT guided §7 |
| Required details enforced server-side | Missing reason / "Other" without note / missing promise, callback, dispute, claim details refused | all refused with UNPROCESSABLE and human-readable errors | INT guided §8 |
| Determinism | Identical facts and policy version → identical decision and summary | `computeNextAction` twice → identical JSON; preview summary equals stored summary | INT guided §8 |
| Only relevant fields appear | Conditional fields per identity/outcome; nothing preselected | verified in the rendered workspace: identity cards only until a choice; reason/outcome after "verified"; promise/callback/claim/statement/dispute/referral blocks only for their outcome | SHOT `agent-live-1024.png`, `agent-live-captured-1440.png`, `agent-acw-1024.png` |

## 3. Agent interaction burden (measured)

Targets: zero routine searching, zero manual dialing / copied numbers, zero manual technical-result entry, one final
business-outcome confirmation; promise and referral details stay mandatory.

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

No-answer / busy attempts encountered during the run: 1 (completed with zero agent entry, agent returned to Ready automatically). Technical results were never entered manually (provider-derived in every row). Source: `docs/evidence/agent-interaction-counts.md` (steps and generated summaries per scenario).

Reading the table: identity, reason and outcome are three quick choices; a promise adds two suggested chips (amount,
deadline) and the mandatory explicit-agreement tick; a callback adds nothing when the default time window is used;
claims can be recorded with unknown details in one click; referrals and disputes require one short typed reason.
Technical results, durations and provider ids are never typed. Facts are captured during the call, so after-call work
is a review plus one submission. Duplicate entry across screens is zero: the outcome is entered once in the workspace
and synchronized to the provider as a disposition by the system.

## 4. Automatic consequences

| Event / outcome | Expected consequence | Actual | Evidence |
|---|---|---|---|
| Verified conversation | Customer-wide cooldown across loans, numbers and campaigns | C-DEMO-007 (two loans): every contact point and another campaign code report RPC_COOLDOWN | INT guided §9 |
| Valid promise | Promise + reminder plan + PTP protection; next action MONITOR_PTP | as expected; blocked-until shown on the desktop and customer page | INT guided §1, E2E |
| Corrected outcome | Policy re-evaluated; provider callability reconciled explicitly | PTP → NO_COMMITMENT: promise CANCELLED, PTP_PROTECTION gone, cooldown kept, corrected wrap-up command queued, audit row | INT guided §9 |
| Provider recycle / recall of withdrawn work | Never a live contact; END requested; exception | attempt on a withdrawn reservation → IGNORED, CANCELLED attempt recorded, END command queued, SUPPRESSION_SYNC_FAILURE exception | INT guided §10 |
| Duplicate events / double save | No duplicate promise, attempt, credit, metric or disposition | duplicate provider event → DUPLICATE; same idempotency key → duplicate:true; replayed payment → DUPLICATE | INT journey, INT guided §8, E2E |
| Partial payment | Promise updated; arrears remain; no cure | INT guided §2 |
| Reversal | Promise credit reversed with history; arrears reopened | reversal PROCESSED; paidAmount 0; link reversed; payment REVERSED | INT guided §10 |
| Stale financial data | Amount-specific outreach blocked with a visible reason | BALANCES_FRESH reason code | INT guided §10 |
| Payment immediately before dialing | Pending work withdrawn, provider acknowledges, late events ignored | INT journey (CTI 9) |
| Payment during a conversation | Agent notified, call not dropped | INT journey (CTI 9/11) |
| Busy / no answer | Attempt recorded; retry only under policy timing/limits | INT floor §3, INT journey |

## 5. Defects found and fixed during the pass

| Defect | Fix |
|---|---|
| Choosing an identity preselected the first outcome (PTP) — violates "do not preselect a positive outcome" | Outcome is auto-filled only when exactly one is possible; otherwise it stays empty |
| Identity/outcome cards toggled off on a second click (lost input on repeated taps) | Cards now behave like radios; chips (reason, flags) toggle |
| Mock provider did not track the agent's own state across call legs, so a CTI reconnect restored RESERVED instead of TALKING | Mock `applyEvent` now mirrors DIALING / TALKING / ACW / READY per leg |
| Provider events on withdrawn/expired reservations were silently ignored | Now recorded as a cancelled attempt, END requested, exception raised, audited |
| Outcome corrections changed labels only | Corrections cancel promises, re-evaluate open work and push a corrected provider wrap-up |
| After-call work repeated the whole form in a separate layout | Facts stay on screen; responses captured during the call are reviewed; one review strip with the generated summary and two save buttons |
| Browser measurement mis-detected no-answer attempts (home page text) | Detection now uses state transitions (dialing → live or → home) |
| Callback outcome relied on a prefilled default time, so the agreed time was never an explicit choice (and the save stayed disabled) | Agreed-time chips (tomorrow 10:00 / 18:00, in 2 hours, other) with no default; one explicit selection |
| Critical-path browser flow failed when the first automatically dialed customer was a provider no-answer | The flow now treats no-answer attempts as zero-entry evidence and waits for the next automatic reservation |

## 6. Remaining gaps

- The ACW and live layouts stack below 1280 px; usable but the review strip needs scrolling at 1024 px.
- Transfer is unsupported by the mock; blended inbound contention and whisper/auto-accept are not demonstrable without a provider.
- Calibration reviews (two reviewers classifying the same calls) are a process, not software; the dictionary is ready for it.
- Promise reminder SMS and PTP follow-up dispatch run through the local outbound log only.

## 7. Mock validation versus real-provider capabilities

Validated through the mock (application logic): reservation uniqueness, agent state gating, screen-pop binding to
trusted ids, wrap-up gating, withdrawal, recycle refusal, reconnect recovery, zero-entry technical results, outcome
validation and consequences, idempotency.

Requires a real Orange/other telephony integration (not claimed here): audio and headset readiness, carrier/answer
detection accuracy, auto-accept/whisper, real screen-pop latency (p95), wrap-up mapping and campaign recycle
semantics on the provider side, withdrawal acknowledgment latency, transfer/hold behaviour, CTI event completeness
after reconnect, and the platform's licensed CTI capabilities (identity/version still unknown).
