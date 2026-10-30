# Build status — ATB Collections (synthetic demo)

Last updated: 30 Oct 2026 (one customer = one row; agent workspace redesign and call-lifecycle repair) · branch `claude/bold-bohr-njc446`

## One customer = one compact row (30 Oct 2026)

Diagnosis before changing anything: the **work queue** (`/work-queue`) listed work items, so a customer with both a
call and a callback appeared twice — on different pages, with the page count counting items (C-DEMO-025 in the
synthetic data) — and each row wrapped to 6–7 lines over 15 columns. The **customer list** (`/customers`) already
returned one record per customer, but only after a search, with the customer id stacked under the name.

| Area | What changed | Where |
|---|---|---|
| Customer list | Scoped portfolio list (no search needed): one row per customer id with Müştəri, CIF, Kredit sayı, Gecikmiş cəmi, Maks. gecikmə günü, Status / növbəti iş; search, "with overdue / all with active loans", sort and paging. Aggregation in SQL over active loans (each loan once), scope and search applied before grouping and paging, total = distinct customers, ties broken by customer id | `customers/customerListService.ts`, `(shell)/customers/page.tsx` |
| Work queue | Matching work items grouped by customer id BEFORE paging; each customer placed by its next work item in workflow order (in a call, claimed, due callback, rank, priority, age — the claim order); "+N" for the other open work; KPIs count distinct customers; filters still select work items; ERA, probability, bucket and policy details moved into the panel | `work/queueService.ts`, `work/nextWork.ts`, `(shell)/work-queue/page.tsx` |
| Detail panel | Right-side, read-only panel (name, "N kredit", "+N" or the details button): summary, next work with blocker and owner, other open work, individual loans (link to the loan page), open promises with the loans they cover, last contact and outcome, link to the full profile. Escape closes; focus returns to the row; list position and selection kept. Opening it never claims, reserves or dials; the view is scoped and audited | `customers/CustomerDetailPanel.tsx`, `customers/CustomerRowsTable.tsx`, `api/customers/[id]/overview` |
| Presentation | 46 px rows, 14 px text, every cell on one line with ellipsis and the full value in a tooltip; below 768 px only name, overdue and status remain (details in the panel) | `globals.css` (`.rows-table`, `.detail-panel`) |
| Search fix | "N matching customers are outside your scope" now subtracts all in-scope matches, not only the rows on the page | `customers/customerService.ts` |

Unchanged on purpose (separate events or items stay separate): call history and timeline, payment transactions,
audit history, promise and task lists, agent follow-ups and the dashboard lists.

Evidence: `tests/integration/customerRows.test.ts` (7), `tests/unit/nextWork.test.ts` (3), `e2e/customer-rows.mjs`
(32 checks at 1366×768, 1440×900, 390×844). Screenshots before/after: `docs/screenshots/customer-rows/`.

## Agent workspace redesign and call-lifecycle repair (30 Oct 2026)

Reported defect: a senior agent's call stayed "connected" for over an hour with "Zəngi bitir…" and the outcome save
both disabled. Root cause reproduced in code: a retried End reused the fixed command key `ctl:END:<id>:once`, so the
outbox refused it as a duplicate while the screen still recorded a pending End; UNKNOWN receipts were dead-lettered
without clearing that pending flag, and nothing reconciled it on reload.

| Area | What changed | Where |
|---|---|---|
| Command lifecycle | Every Mute/Hold/End is a command with its own key per attempt (`ctl:<ACTION>:<interaction>:<n>`) and an explicit state REQUESTED → ACCEPTED → COMPLETED / FAILED; family duplicates refused under a row lock; stale commands superseded; dead-lettered commands marked FAILED; open commands re-synchronised with the outbox on every page load, reconnect and reconciliation run. A timeout never ends a call: a stale End offers **End again** and **Check call status** (`RECONCILE` asks the provider; only a provider "ended" closes the call) | `dialer/contract.ts`, `dialer/callControlService.ts`, `dialer/runtime.ts`, `outbox/processor.ts`, `api/agent/call-control` |
| Event ordering | Events for another call leg are ignored; `call.ended` before `agent.bridged` opens after-call work; late `attempt.started`/`agent.bridged` after the end only add timestamps | `dialer/providerEventService.ts` |
| Outcome submission | One deterministic key per interaction (`outcome:<id>`); atomic DRAFT → SAVED claim so concurrent saves produce one promise/callback/wrap-up; localized validation (AZ/EN/RU) with codes; promise amount ≤ total owed and loans must be active (server-side); callback moved into permitted hours is a warning, not an error | `interactions/outcomeService.ts`, `outcomeSchema.ts`, `promises/promiseService.ts` |
| Dispatch | No next customer while an interaction is open, unsaved or its wrap-up unacknowledged; reservations with an open interaction are never expired | `dialer/routingService.ts`, tests |
| Follow-ups | Voice items re-evaluated at the current business clock (`explainWorkItem`); stored `nextEligibleAt` is the earliest blocker end, so a due callback is re-checked when it becomes due; the list shows the restriction that applies now and when it ends | `work/eligibilityExplain.ts`, `work/workItemService.ts`, `agent/followUpService.ts` |
| Routes | `/agent` is the personal dashboard (today's workload, due callbacks with live blockers, promises needing attention, concise results); `/agent/call` is the only call workspace; other pages show a return-to-call indicator (`/api/agent/active`), the dashboard opens the call workspace once per new call | `(shell)/agent/*`, `shell/ActiveCallIndicator.tsx` |
| Workspace | Two-row header (name, CIF, overdue, DPD, data freshness with details on demand; call status + timer, call controls; shift controls separated); left 60 %: one conversation Şəxsiyyət → Səbəb və müzakirə → Nəticə və təsdiq with the script passage of the current stage, completed stages collapsed into editable summaries; right 40 %: customer summary + Məlumat / Hesablar / Tarixçə / Əlaqəli şəxslər / Ödəniş təlimatı; slim bottom bar with one-line summary, **Təfərrüat**, **Yadda saxla və fasilə ver**, **Yadda saxla və davam et** | `components/agent/AgentDesktop.tsx`, `CallHeader.tsx`, `ConversationFlow.tsx`, `CustomerPanel.tsx`, `ActionBar.tsx` |
| One draft | The server draft is the single source for answers, script values, presets and the preview; custom amount/date restored visibly; changing amount, date or loans clears the customer's agreement; reason-skip and stage restored after reload/navigation; outcome fields set aside (not submitted) when switching outcome or identity | `components/agent/conversation.ts`, `api/agent/interactions/[id]/draft` |
| Language | Agent-facing statuses, validation, next actions, follow-up and result labels, timeline and generated summary in Azerbaijani (EN reference, RU partial with English fallback); screen codes removed from the navigation | `i18n/agentText.ts`, `i18n/outcomeText.ts`, `shell/*` |

Measured at 1366×768 (synthetic data, mock telephony; `e2e/workspace-redesign.mjs`, 26/26 checks): promise form page
height 1,266 px (was ~1,730 px), decision text 14 px, script 17 px, controls 38 px, no horizontal scroll at 1366, 1440
and 390 px, the sticky bar never covers the focused input. Screenshots: `docs/screenshots/redesign/`.

## Pilot-hardening pass (29 Oct 2026)

Audit findings reproduced against the code and fixed, the collection process hardened, the agent workspace rebuilt
and the UI moved to Azerbaijani-first design tokens. Policy drafts introduced by this pass are listed in
`ASSUMPTIONS.md` §5a; the tester guide is `UAT_GUIDE.md`; hosting notes for a multi-day pilot are in `DEPLOYMENT.md`.

| Area | What changed | Where |
|---|---|---|
| Access scope | One server-side scope (`scope.ts`) before pagination for customers, payments, promises, tasks, work queue, search, analytics/export, APIs; agents keep bounded history (14 days); SSE stream closes on session revocation | `src/server/auth/*`, list pages, `api/agent/stream` |
| Call recovery | Provider-confirmed Mute/Hold/End with `controlState` (pending / confirmed / rejected / unknown), reconciliation job, hydration of the provider view from persisted facts (also before trusting UNKNOWN), supervisor force-end, exceptions `CALL_CONTROL_FAILURE` / `CALL_STATE_UNKNOWN` | `dialer/runtime.ts`, `dialer/providerReconciliation.ts`, `api/operations/controls` |
| Clock | Adapter uses the injected domain clock; daily aging per Baku business date (`Loan.agedForDate`); idempotent worker catch-up on start; UI timers anchored on the server clock | `clock.ts`, `jobs/aging.ts`, `jobs/catchUp.ts`, `worker/main.ts` |
| Attribution | Rule ATTRIB-1 stored once per payment (`PaymentAttribution`), reversed with reversals, read by the agent dashboard, team grid and analytics | `payments/attribution.ts` |
| Reminders | Durable `ReminderJob` with pre-send rechecks, dedup, cancellation, delivery status, manual resend, Unicode segments and cost | `promises/reminderService.ts` |
| Promise policy | 30-day horizon (draft), next-business-day grace, explicit confirmation; out-of-policy date → `PTP_EXCEPTION` approval (lead/head), approval creates the promise | `promises/promiseService.ts`, `approvals/approvalService.ts` |
| Outcomes | `DELINQUENCY_CLOSED` ("Gecikmə bağlanıb") when a verified posting clears the overdue during the call (agent notified live); `PTP_EXCEPTION_PROPOSED`; death report with reporter relation → reported, verification exception, lead confirm/reject | `interactions/*`, `api/support-cases/[id]/confirm` |
| Cases | Loan-level scope inside a multi-loan case (`CaseLoan.releasedAt`) | `cases/caseService.ts` |
| Payment instructions | Approved AZ/EN/RU template sent from the current call after right-party verification, with segments and cost | `api/customers/[id]/sms` |
| Pilot access | `APP_MODE=PILOT`: individual tester identities (`npm run pilot:users`), forced password change, rate-limited sign-in, role switch only in DEMO | `auth/*`, `scripts/create-pilot-users.ts` |
| Agent workspace | Compact header (state, timer, customer line, positive eligibility labels, capability-driven controls), script at 16px + structured answers, details tabs (facts, accounts with explicit payment states, timeline, related persons, payment instructions), sticky action bar, diagnostics restricted, follow-up view, role home for leads/heads, deferred page removed | `components/agent/*`, `(shell)/agent/follow-ups`, `(shell)/home` |
| Design | Self-hosted Inter Variable (Ə ə Ğ ğ İ ı Ö ö Ş ş Ç ç Ü ü ₼ verified in the latin + latin-ext subsets), type scale 14/13/12/22/16/24, weights 400/500/600, 8px radii, tabular numerals, 38-40px controls; Azerbaijani default with EN/RU switch | `globals.css`, `src/i18n/*` |
| Operations | `/api/health/live`, `/api/health/ready`; worker heartbeat with capabilities and last catch-up; idempotent pilot reference seed at boot | `api/health/*`, `scripts/start-all.sh` |

| Check (this pass) | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm run build` | production build succeeds |
| `npm test` | 7 files, 60 unit tests (new `pilotHardening.test.ts`: rate limiting, horizon/exception, overdue-cleared and death-report rules, scope helpers, SMS segments, mock provider controls and persisted state, dictionaries) |
| `npm run test:integration` | 4 files, 40 tests (new `pilot.test.ts`: cross-agent scope on detail/search/lists/headers and the history window, attribution once-per-payment with competing agents / replay / reversal / team grid, reminder scheduling-dispatch-delivery-skip-cancel, provider-confirmed controls with rejected End and force-end recovery, idempotent catch-up and Baku aging, overdue cleared during a call with live notification, promise-date exception with lead approval and refused self-approval, third-party death report, loan-level case scope, readiness endpoint) |
| `npm run e2e:pilot` | agent shift, team lead, head and admin journeys at 1366×768 and 1440×900; screenshots in `docs/screenshots/after/` (previous build in `docs/screenshots/before/`) |

Defect found and fixed during the browser pass: a second worker process (or a web-side authorization) made a live
call unknown to the worker's mock provider instance, so reconciliation flagged it and End would have been refused;
the worker now rebuilds the provider view from persisted facts before trusting an UNKNOWN answer and clears the
error once the provider reports the call again.

Not done in this pass (carried in "Known gaps"): management screens beyond navigation and shared labels remain
English; the contact-outcome drawer on S04 does not yet offer the two new outcomes (agents record them from the
call workspace); the sign-in rate limiter is per instance.

## Guided-agent blueprint and acceptance pass (28 Oct 2026)

Applied `docs/spec/ATB_Guided_Agent_Desktop_and_Dialer_Blueprint.md` to S28: quick-choice identity / reason / outcome
cards with nothing preselected, suggested (bank-verified) promise amounts and dates with a mandatory explicit customer
agreement, derived full/partial coverage, customer statements that never become promises, independent flags, a
deterministic provenance-labelled factual summary, and one final **Save & next call** / **Save & pause**. Corrections
re-evaluate policy and push a corrected provider disposition; provider attempts on withdrawn work are refused.
Results: `AGENT_WORKFLOW_ACCEPTANCE.md`; measured interaction burden: `docs/evidence/agent-interaction-counts.md`;
handover: `MORNING_HANDOVER.md`.

| Check (this pass) | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | clean; production build succeeds |
| `npm test` | 39 unit tests (incl. summary/coverage determinism) |
| `npm run test:integration` | 29 tests: journey 14 · collection floor 5 (six concurrent agents, senior routing, zero-entry no-answer, wrap-up/failed-save gating, break/refresh/reconnect, clock advancement) · guided conversation 10 (all scenarios + consequences) |
| `npm run e2e` | browser critical path with the guided controls passed |
| `npm run measure` | interaction counts per scenario (see evidence file) |
| `npm run screenshots:agent` | home / reserved / live / live-captured / after-call work at 1440 and 1024 px |

## Executed checks (this build, 30 Oct 2026, local container)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` (unit) | 75 passing (9 files) — incl. `conversation.test.ts` and `nextWork.test.ts` (workflow order of a customer's open work) |
| `npm run test:integration` | 56 passing (6 files) — incl. `customerRows.test.ts`: two loans → one row (150.35 = 100.10 + 50.25, closed loan excluded, max DPD 40), same-name customers separate, distinct-customer totals and non-overlapping pages, sort follows displayed values, scope before aggregation, grouped queue (one row per customer across pages, header = distinct customers), read-only overview (no claim, no reservation) |
| `npx next build` | succeeds |
| `node e2e/customer-rows.mjs` | 32/32 checks: one row per customer id, no wrapped cells, 46 px rows with 14 px text at 1366/1440, no horizontal scroll at 1366/1440/390, the customer with a call and a callback once across all queue pages, panel keyboard/Escape/focus/position, "N kredit" opens the loans, "+N" lists other work, nothing claimed |
| `node e2e/workspace-redesign.mjs` | 26/26 checks (agent call flow and drafts unchanged) |

## Scope status by screen

| Screen | Route | Priority | Status |
|---|---|---|---|
| S01 Sign-in and role landing | `/login` | P0 | done (local demo IdP, role landing, DEMO role switch for admin) |
| S02 Collections overview | `/overview` | P0 | done (live KPIs trace to rows; delinquency distribution; priority list; broken promises) |
| S03 Work queue | `/work-queue` | P0 | done (filters, eligibility reasons, atomic claim-next, release/reassign with reason) |
| S04 Customer 360 | `/customers/:id` | P0 | done (tabs, eligibility panel, actions: contact outcome drawer, PTP, callback, SMS, support, dispute, escalation) |
| S05 Loan detail | `/loans/:id` | P0 | done (core schedule versions, payments/allocations, snapshots, local simulation, mismatches) |
| S06 Contact outcome drawer | S03/S04 | P0 | done (same validation as the agent desktop) |
| S07 Promises | `/promises` | P0 | done (register, create/cancel, attribution) |
| S08 Callbacks & tasks | `/tasks` | P0 | done |
| S09 Payments & reconciliation | `/payments` | P0 | done (posted, quarantined, claims, events, DEMO simulator) |
| S10 Hardship & arrangements | `/arrangements` | P1 | done (intake with restricted details, simulation, review, approval, mock core confirmation) |
| S11 Approvals inbox | `/approvals` | P1 | done (maker/checker, effects applied on approval, rollback requests, cancel, info requests) |
| S12 Strategy designer | `/strategies` | P0/P1 | done basic+ (versions, editable decision tables, validation, dry simulation, customer explanation, submit for approval) |
| S13 Prometeia model | `/models/prometeia` | P0/P1 | done basic+ (register, rule table, tree, feature mapping, golden cases, sample preview, version compare, test-score panel, JSON import) |
| S14 Economics & capacity | `/strategy/economics` | P0 | done (dated costs, uplift scenarios, break-even, capacity, observed vs planned, scenario comparison, save to settings) |
| S15 Campaigns | `/campaigns` | P1 | done (live audience/exclusions/cost/previews, states, release approval, pause/cancel; local outbound log) |
| S16 Templates | `/templates` | P1 | done (AZ/EN/RU versions, allow-listed variables, preview, SMS encoding/segments, restricted content check, approval) |
| S17 Operations | `/operations` | P0 | done (live states, backlog, overflow, missed callbacks, stuck wrap-ups, controls, rebalance simulation, team grid) |
| S18 Analytics | `/analytics` | P0/P1 | done basic+ (12 tabs, filters, definitions, freshness, CSV export) — roll/cure matrices need ≥ 2 daily runs |
| S19 Model monitoring | `/model-monitoring` | P1 | done basic (coverage, unscored, class distribution, overrides, versions; validation stats honestly "unavailable") |
| S20 Imports | `/data/imports` | P0 | done (wizard, 8 datasets, templates, control totals, quarantine, dry-run, commit, rollback, error files) |
| S21 Integrations | `/integrations` | P0 | done (sources, freshness, outbox/dead letters, replay, actions) |
| S22 Exceptions | `/exceptions` | P0/P1 | done basic (types, SLA, assign/refresh/resolve/reopen) |
| S23 Audit | `/audit` | P0/P1 | done basic (append-only trail, filters) |
| S24 Settings | `/settings` | P0 | done (provenance, owner, version, effective date; policy/model keys via approval) |
| S25 Users & roles | `/admin/users` | P0 | done (users, roles, teams, scopes — read/admin) |
| S26 Recovery handover | `/recovery` | P1 | done (later-stage list, packet build, approval, export, acknowledge, return) |
| S27 Self-service | `/self-service` | P2 | deferred — documented placeholder only |
| S28 Agent desktop (A/B/C) | `/agent` | P0 core | done — guided workflow per blueprint (quick choices, derived coverage, factual summary, one final save), SSE + polling, drafts, wrap-up gating, recovery states, manual dial for seniors |

## Known gaps and disabled functionality (precise inventory)

- **Workspace redesign (30 Oct)**: the call workspace stacks below 1280 px (conversation first, customer details after); the native date input follows the browser's locale format; the customer profile page (`/customers/[id]`) and management screens were not part of this redesign and keep their earlier wording; the older browser scripts `e2e/run.mjs` and `e2e/agent-states.mjs` still expect English labels and the old `/agent` workspace and were not run (the current journeys are `e2e/workspace-redesign.mjs` and `e2e/pilot-journeys.mjs`); a real 3CX adapter is out of scope — only the mock is exercised.

- **Guided workflow**: live/ACW layouts stack below 1280 px (review strip needs scrolling at 1024 px); transfer unsupported by the mock; calibration reviews are a process step; reminder SMS go to the local outbound log. What only a real provider can prove is listed in `AGENT_WORKFLOW_ACCEPTANCE.md` §7.

- **No real integrations**: core banking, payment feed, customer master, SMS gateway, dialer and identity are mocks. "Sent" SMS is a local log status. The mock dialer does not support transfer (button disabled) or inbound calls, so inbound/outbound reservation contention is not demonstrated.
- **Model**: draft transcription activated for the demo only; 1–3 DPD rule is a DEMO placeholder; validation statistics (observed vs assigned, GINI/AUC, calibration, drift/PSI) are shown as unavailable; external scores are retained, not routed.
- **Analytics**: roll/cure matrices require at least two daily decision runs (run `/api/decisions/run` on consecutive business days or advance the demo clock); experiment arms are stored but no experiment is assigned by the seed.
- **Arrangements**: core submission is mocked (immediate confirmation); restricted hardship details are opaque markers, no document storage.
- **Campaign dispatch**: all RUNNING SMS campaigns target the approved digital-reminder population (one message per campaign/customer/day); there is no per-campaign audience rule language yet.
- **Templates**: SMS segment estimate assumes standard GSM-7/UCS-2 limits; no gateway contract supplied.
- **Imports**: loans/schedules/arrears rollback is "retained" (corrective reverse import), payments rollback issues reversal events.
- **Users & roles**: user management is read/role-view; creating users goes through the seed (no IdP).
- **i18n**: UI strings are English with AZ/RU dictionaries for navigation and key labels; full translation of every screen is not done.
- **Dev indicator**: screenshots show the Next.js dev badge (development mode only).

## Exact next steps (in order)

1. Replace the local identity provider with the bank's OIDC/SAML (+ MFA) behind `CONNECTOR_IDENTITY`; keep RBAC/object scope as is.
2. Agree the core banking/payment feed/customer master contracts; implement real adapters behind the flags and reuse the import datasets as the bulk/batch path; add contract tests against event samples.
3. Dialer pilot: select the provider, map its events to `NormalizedProviderEvent`, implement `DialerAdapter` for it, run the 12 CTI scenarios against a test extension; add transfer support if the provider has it.
4. Prometeia: obtain the signed executable artifact and feature dictionary; import via S13; resolve the Class 7 / DPD 10 / target wording issues; activate through S11; load ≥ 2 monthly feature files to enable drift.
5. Run the daily decision for several business days to populate roll/cure matrices and S19 observed-vs-assigned once matured labels exist.
6. Contact policy sign-off by the bank (values in `ASSUMPTIONS.md`), then activate a `ContactPolicyVersion` through S11.
7. Hardening: secure cookies/TLS, secret management, log/metric shipping, backups, load test of the worker allocation loop, accessibility audit with assistive technology.

## Continuation prompt (for a fresh session)

> Continue the ATB Collections build on branch `claude/bold-bohr-njc446`. Read `README.md`, `BUILD_STATUS.md`,
> `ASSUMPTIONS.md` and `docs/spec/ATB_Collections_Claude_Upload_Pack/ATB_Collections_Claude_Master_Prompt.md`
> (Parts B, C, D are authoritative). Start the local stack (`cp .env.example .env`, PostgreSQL, `npm run db:migrate`,
> `npm run db:seed`, `npm run dev`, `npm run worker`) and verify `npm run typecheck && npm run lint && npm run test:all && npm run e2e`.
> Then work the "Exact next steps" list above in order, keeping every rule in the pack: synthetic data and mock
> adapters only, no invented charges or probabilities, server-enforced customer-wide contact policy, idempotent events,
> maker/checker governance, and honest "unavailable" labels for statistics without matured data. Update
> `BUILD_STATUS.md` after each milestone and commit with the required attribution lines.
