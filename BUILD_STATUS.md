# Build status — ATB Collections (synthetic demo)

Last updated: 27 Oct 2026 (session clock) · branch `claude/bold-bohr-njc446`

## Executed checks (this build)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (eslint flat config: core-web-vitals, typescript, react-hooks) |
| `npm test` (unit) | 36 passing — annuity fixture, arrears/DPD, rule interpreter + golden cases, ERA/buckets, treatment, ranking, contact policy |
| `npm run test:integration` | 14 passing — CTI login/ready, automatic allocation of C-DEMO-001, duplicate provider events, END → ACW, PTP save + wrap-up ack + duplicate save, suppression (120 h + PTP), verified payment keeps promise/cures case/replay = DUPLICATE, partial payment, failed-attempt retry, blocked cases, concurrent claims, payment-before-dial withdrawal, payment-during-call notification + deferred break, failed wrap-up ack exception, permission matrix |
| `npm run e2e` (browser critical path) | passed — login → connect → Ready → automatic reservation → screen pop → End → ACW → PTP saved → wrap-up acknowledged → supervisor view → mock verified payment PROCESSED → replay DUPLICATE → customer 360 |
| `npm run screenshots` | 79 images in `docs/screenshots/` at 1440 / 1280 / 1024 px (24 screens + login + agent home) |
| Governance flows (API) | template draft → approval → ACTIVE; campaign create → review → release approval → RUNNING → pause → cancel; arrangement review → approval → mock core confirmation; handover create → approval → export → accept; settings change → POLICY_ACTIVATION approval → applied; self-approval refused; imports validate → dry-run → commit → rollback (reversal events), duplicate batch refused |

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
| S28 Agent desktop (A/B/C) | `/agent` | P0 core | done (automatic journey, SSE + polling, drafts, outcome validation, wrap-up gating, recovery states, manual dial for seniors) |

## Known gaps and disabled functionality (precise inventory)

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
