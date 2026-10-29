# ATB Collections — early-arrears collections operating layer (synthetic demo)

Internal web application for collecting existing, unsecured AZN consumer cash loans with fixed-rate monthly
annuity repayments. It is a **collections operating layer**: core banking stays the source of truth for
contracts, schedules, postings, balances and DPD; the Prometeia decision design (8 model classes, 10 action
buckets, ERA ranking) drives daily treatment; a provider-neutral dialer adapter runs an automatic progressive
agent desktop. Everything in this repository runs on **synthetic data with mock adapters**. Nothing here is a
live bank integration, a real call, a real SMS or a real payment.

> Status: see `BUILD_STATUS.md`. Assumptions and unresolved production inputs: `ASSUMPTIONS.md`.

## What is in the box

| Area | Where | Notes |
|---|---|---|
| Agent desktop (S28 A/B/C) | `/agent`, `src/components/agent`, `src/app/api/agent/*` | Login → confirmed Ready → automatic reservation → progressive dial → trusted screen pop → conversation → ACW → validated outcome → provider wrap-up ack → Ready/Not ready. SSE stream with polling fallback, auto-saved drafts, reconnect-safe. |
| Dialer/CTI runtime | `src/server/modules/dialer/*` | `DialerAdapter` contract, deterministic `MockDialerAdapter`, routing reservations (one per customer, one voice interaction per agent), agent sessions (requested vs provider-confirmed state), provider event ingestion with idempotency, wrap-up gating, withdrawal on payment-before-dial, payment-during-call notification, deferred breaks. |
| Finance | `src/server/modules/finance/*` | Decimal annuity engine (10,000 / 18% / 24 → 499.24 = 150.00 + 349.24, closing 9,650.76; final installment adjusted), DPD/arrears derivation, demo allocation policy, loan-state restatement from facts. Imported core schedules are preserved; local simulation is clearly separated. |
| Decisions | `src/server/modules/decisions/*` | Typed three-valued rule interpreter (rules are data, never code), Prometeia DRAFT transcription (8 leaves), segments (1–3 DEMO-only rule, 4–10 tree, 11–30 draft roll rates, 31+ unscored), ERA = p × exposure, decile action buckets at daily snapshot, treatment mapping, stable ranking, daily decision run. |
| Contact policy | `src/server/modules/contactPolicy/*` | Server-enforced, customer-wide: kill switch, channel/campaign pauses, strategy/model validity, data freshness, contact validity, status/dispute/support holds, paid-claim hold, permitted hours, attempt caps, RPC cooldown (120 h), PTP protection, retry timing, failed-attempt limits, capacity, callbacks, reservation uniqueness. Evaluated at scheduling, reservation and before dispatch. |
| Payments & reconciliation | `src/server/modules/payments/*`, `promises/*` | Idempotent integration events `(sourceSystem, sourceEventId, eventType)`, verified postings only, allocation per policy, promise attribution (once per payment), cure only at zero overdue, reversals re-open arrears, paid claims open reconciliation, duplicate replay = no effect. |
| Work & operations | `work/*`, `operations/*`, `/work-queue`, `/operations`, `/exceptions` | Atomic `FOR UPDATE SKIP LOCKED` claims, leases, reassignment with reason, live supervision (states, backlog, overflow, missed callbacks, stuck wrap-ups, integration exceptions), rebalance simulation. |
| Strategy & model governance | `/strategies`, `/models/prometeia`, `/strategy/economics`, `/approvals`, `/model-monitoring` | Versioned decision tables with validation and dry simulation, model register with rule table/tree/feature mapping/test-score panel/golden cases/version compare, action economics & capacity scenarios, maker/checker approvals with rollback targets, monitoring panels that say "unavailable" instead of inventing statistics. |
| Analytics & data | `/analytics`, `/data/imports`, `/integrations`, `/audit`, `/settings` | Twelve analytics tabs with definitions and CSV export (as-of + definition version, formula-injection guard), import wizard (map → validate → dry-run → commit → rollback), integration health & outbox, append-only audit, provenance-tagged settings. |
| P1 workflows | `/arrangements`, `/campaigns`, `/templates`, `/recovery`, `/self-service` | Hardship/arrangement simulation and governance, SMS campaigns with live audience/exclusions, versioned AZ/EN/RU templates with SMS encoding/segment estimates, later-stage handover packets; self-service documented as deferred (P2). |
| Worker | `src/worker/main.ts` | pg-boss durable jobs: outbox dispatch (adapter owner), mock provider event delivery, routing allocation, maintenance (leases, due work, source refresh), promise maturation, SMS dispatch (local outbound log), daily decision run (05:00 Asia/Baku). |

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9, Prisma 7 + PostgreSQL, decimal.js, Luxon
(Asia/Baku), Zod 4, Tailwind 4, pg-boss 12, Vitest, Playwright (browser flow). ATB theme (`#6F0BBB`, `#34035D`,
`#F4C900`, `#F8F0FE`), compact accessible components (native `<dialog>`, ARIA tabs/roving tabindex, visible focus).
English UI with AZ/RU dictionaries (`src/i18n/dictionaries.ts`); AZN amounts; Asia/Baku business dates.

## Quick start

Prerequisites: Node.js 22+, PostgreSQL 16 (local or `docker compose up -d`).

```bash
cp .env.example .env            # adjust DATABASE_URL / TEST_DATABASE_URL (no secrets in the template)
npm install
npm run db:migrate              # prisma migrate deploy
npm run db:seed                 # synthetic portfolio (≈ 280 customers, ≈ 330 loans), scenarios, demo identities
npm run dev                     # web app on http://localhost:3000
npm run worker                  # in a second terminal: durable background worker (required for dialing, outbox, SMS, decisions)
```

Reset the demo at any time: `npm run db:reset` (drops schemas, re-applies migrations, seeds). The seeded business
date is **27 Oct 2026**; `DEMO_CLOCK_MODE=offset` lets time advance from the moment of seeding.

### Pilot mode, health checks and the agent workspace (pilot hardening)

- `APP_MODE=PILOT` replaces the shared demo logins with individual tester identities (`npm run pilot:users`, forced
  password change, rate-limited sign-in, no role switching) while keeping synthetic data and mock providers; see
  `DEPLOYMENT.md` and `UAT_GUIDE.md`.
- Health: `/api/health/live` and `/api/health/ready` (database, migrations, worker heartbeat).
- Agent workspace: compact provider-confirmed header, script and structured answers as the main area, details tabs
  (facts, accounts, timeline, related persons, payment instructions), sticky action bar; follow-ups in one view
  (`/agent/follow-ups`); role home pages for leads and heads (`/home`). Azerbaijani is the default UI language
  (switch in the topbar).
- Policy drafts pending bank approval are listed in `ASSUMPTIONS.md` §5a (access window, attribution rule ATTRIB-1,
  promise horizon and calendar rule, reminder schedule).

Demo identities (password `demo1234`, DEMO mode only): `agent.a`, `agent.b` (senior), `agent.c`–`agent.f`,
`lead`, `head`, `risk`, `modelmaker`, `approver`, `integrator`, `auditor`, `admin`, service account `svc.core-feed`.
Agents land on `/agent`; everyone else on `/overview`. The admin can switch role in DEMO mode (audited).

### Run it in the browser (GitHub Codespaces, nothing to install)

The repository ships a dev container (`.devcontainer/`) that provisions Node.js 22, PostgreSQL 16, the migrations,
the synthetic seed, a production build and both processes (web app and worker) automatically.

1. On GitHub open the repository and switch the branch dropdown to the branch you want to run (a codespace built from
   a branch without the project, such as a bare `main`, contains only its README).
2. **Code → Codespaces → +** ("Create a codespace on <branch>"). The first start takes about five to eight minutes;
   the creation log (Ctrl+Shift+P → "Codespaces: View Creation Log") ends with `[setup] done`.
3. Open the **Ports** tab, hover the row for port 3000 ("ATB Collections (web)") and click the globe icon. Always open
   the app from this tab: a forwarded port is private to your GitHub account, and typing the URL in another browser
   profile or an incognito window gives `HTTP ERROR 401`.
4. Sign in with any demo identity (`agent.a`, `lead`, `head`, `risk`, `integrator`, `admin`) and the password
   `demo1234`.

To let colleagues open it, right-click port 3000 in the Ports tab and set **Port Visibility → Public**; anyone with
the link can then sign in with the demo logins (synthetic data only). Keep the codespace running while they test: it
stops after the idle timeout (30 minutes by default; raise it under GitHub Settings → Codespaces) and the link works
again as soon as it is started.

The web app and the worker are started by `.devcontainer/start.sh` on every start and attach; logs are in
`/tmp/atb/`. If port 3000 is not listed, run `bash .devcontainer/start.sh` in the terminal (or `npm start` to see
the output directly). `npm run db:reset` restores the seeded state. The free Codespaces quota is about 60 hours a
month on the default 2-core machine.

### Host it with a permanent address (Render, Railway)

`Dockerfile` and `scripts/start-all.sh` run migrations, the idempotent seed, the worker and the web app in one
container; `render.yaml` is a one-click Render blueprint. Steps, costs and limits for Render, Railway and others are
in `DEPLOYMENT.md`. The hosted demo stays synthetic: demo logins, mock dialer, local outbound log.

## Verification commands

```bash
npm run typecheck               # tsc --noEmit
npm run lint                    # eslint (flat config, core-web-vitals + typescript + react-hooks)
npm test                        # unit tests: annuity fixture, arrears/DPD, rule interpreter + golden cases, ERA/buckets, treatment, ranking, contact policy
npm run test:integration        # resets TEST_DATABASE_URL and runs the full journey through the real services (CTI, allocation, outcomes, payments, policy, concurrency, permissions)
npm run e2e                     # browser critical path against a running dev server + worker (Playwright, pre-installed in the dev container)
npm run screenshots             # docs/screenshots at 1440 / 1280 / 1024 px
npm run screenshots:agent       # agent workspace states (home, reserved, live, captured, after-call work) at 1440 / 1024 px
npm run measure                 # instrumented browser run: clicks / typing / submissions per conversation scenario → docs/evidence/
```

Last run: 68 tests passing (39 unit + 29 integration), typecheck, lint and production build clean; the browser
critical path, the agent-state screenshots and the measured interaction counts are in `docs/screenshots/` and
`docs/evidence/`. Guided-workflow acceptance: `AGENT_WORKFLOW_ACCEPTANCE.md`; handover: `MORNING_HANDOVER.md`.

## The demonstrated journey

1. `agent.a` signs in, connects to the (mock) dialer, presses **Go Ready**; Ready is shown only after the provider confirms it.
2. The worker reserves the highest-ranked eligible customer for the agent (one reservation per customer across campaigns, one voice interaction per agent), re-checking the contact policy; the mock provider dials progressively and the agent receives a trusted screen pop with the correct customer, loans, script and policy context.
3. After the conversation the agent presses **End**; the desktop enters after-call work with required structured outcome capture (identity → business outcome → conditional fields, auto-saved drafts, server validation and next-action preview).
4. **Save outcome & return Ready** stores the outcome idempotently, creates the promise, suppresses routine calls (RPC cooldown 120 h + PTP protection), requests provider wrap-up and waits for the acknowledgment; only then is Ready (or Not ready) applied.
5. A mock verified payment (payments page → simulator, or `POST /api/demo/payments/simulate`) is ingested as an integration event: allocation, promise attribution, cure at zero overdue, work invalidation and SSE notification; a replay of the same event is a `DUPLICATE` with no effect.
6. Failed attempts are retried under policy (retry timing, attempt limits); stale balances, disputes, support holds, invalid contacts or paid claims block outreach with visible reason codes (`/customers/<id>`, eligibility panel).

Scenario customers and acceptance mapping: `DEMO_SCENARIOS.md`.

## Documentation index

- `BUILD_STATUS.md` — scope status by screen, known gaps, exact next steps and a continuation prompt.
- `ASSUMPTIONS.md` — every demo assumption with provenance and the unresolved production inputs.
- `MODEL_CARD.md` — Prometeia draft transcription, segments, golden cases, unresolved source conflicts, monitoring.
- `INTEGRATION_MAPPING.md` — adapters, event/API contracts, mapping templates, dialer adapter contract, readiness.
- `METRIC_DICTIONARY.md` — numerator/denominator/scope/maturation for every reported ratio.
- `DEMO_SCENARIOS.md` — seeded scenarios and how each acceptance scenario is demonstrated.
- `AGENT_WORKFLOW_ACCEPTANCE.md` — guided-agent acceptance pass: scenario results, interaction counts, evidence, gaps; `MORNING_HANDOVER.md` — startup, logins, five-minute demo, next priorities.
- `docs/API_CONTRACTS.md`, `docs/PERMISSIONS.md`, `docs/READINESS_CHECKLIST.md`, `docs/templates/*.csv`, `docs/screenshots/`.
- `docs/spec/` — the supplied project pack (authoritative requirements; screen PDFs are illustrative).

## Repository layout

```
prisma/            schema, migrations, seed (synthetic portfolio + scenarios + identities)
src/app/           App Router pages (`(shell)` = authenticated management shell), API routes, login, proxy.ts
src/components/    UI kit, shell, agent desktop, screen components
src/server/        domain modules (finance, decisions, contactPolicy, dialer, interactions, promises, payments,
                   work, strategy, models, economics, analytics, imports, approvals, arrangements, campaigns,
                   templates, recovery, monitoring, settings, audit, outbox, jobs), auth, clock, money, dates
src/worker/        pg-boss worker (owner of adapter instances)
tests/             unit + integration suites; e2e/ browser flows; scripts/ maintenance scripts
```

## Safety and scope notes

- `APP_MODE=DEMO` enables local identities, role switching and the payment simulator; `INTEGRATION` disables them and requires configured, approved adapters (all connector flags default to `mock`).
- No real credentials, phone numbers, customers or payments exist in this repository; secrets are never committed (`.env.example` only).
- Model probabilities are a DRAFT transcription of the provider's rule table with unresolved conflicts preserved; the 1–3 DPD rule is a DEMO-only placeholder and is labelled as such everywhere it appears.
