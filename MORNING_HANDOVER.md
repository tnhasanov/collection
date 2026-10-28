# Morning handover — ATB Collections guided agent desktop (synthetic demo)

Prepared at the end of the overnight acceptance pass (28 Oct 2026). Everything below runs locally with synthetic
data and the mock dialer; nothing was deployed, no call was placed, no message was sent, no bank system was touched.

## 1. Start the demo (exact commands)

```bash
cp .env.example .env            # adjust DATABASE_URL / TEST_DATABASE_URL for your PostgreSQL 16
npm install
npm run db:migrate              # applies all migrations (incl. 20261027234721_guided_outcome_summary)
npm run db:seed                 # synthetic portfolio, scenarios, demo identities (or `npm run db:reset` to start clean)
npm run dev                     # http://localhost:3000
npm run worker                  # second terminal — REQUIRED for dialing, wrap-ups, SMS log, outbox, decisions
```

Check: `http://localhost:3000/login` returns the sign-in page and the worker log shows `[worker] … started (mode DEMO, dialer MOCK_DIALER)`.

Demo logins (password `demo1234`): agents `agent.a` / `agent.b` (senior), `agent.c`–`agent.f` (regular); `lead` (team lead), `head`, `risk`, `modelmaker`, `approver`, `integrator`, `auditor`, `admin`.

## 1b. No Node.js on the machine? Run it in the browser

Open the repository on GitHub, switch the branch dropdown to this branch, then **Code → Codespaces → +**. The dev
container in `.devcontainer/` installs everything, seeds the synthetic demo, builds the app and starts the web app and
the worker (first start about five to eight minutes). Open port 3000 from the **Ports** tab (globe icon; a pasted URL
in another browser profile gives HTTP 401) and sign in with the demo logins above. To share with colleagues set the
port's visibility to Public. Details: README, "Run it in the browser".

## 2. Five-minute guided demonstration

| Minute | Who | Do | Watch for |
|---|---|---|---|
| 0:00 | `agent.a` → `/agent` | **Connect to dialer**, then **Go Ready** once | Ready is shown only after the mock provider confirms it; no customer search, no number to copy |
| 0:30 | — | Wait for the automatic reservation | Call strip shows the trusted customer/case ids and masked number; facts left, RU/AZ/EN script centre, responses right |
| 1:00 | agent | While "talking", click **Borrower verified** → **Salary not yet received** → **Payment promise** → amount chip **Overdue due now** → **+3 days** → tick **The customer explicitly agreed** | Nothing was preselected; the factual summary (step D) is generated: "Borrower verified… Customer reported: salary timing (customer-stated)… Agreed payment … (customer explicitly confirmed)… pending verification" |
| 2:00 | agent | **End** (provider control) → after-call work | Technical result "Answered (provider-observed)" came from the provider; the captured facts are still there; **Save & next call** is the single confirmation |
| 2:30 | agent | **Save & next call** | Wrap-up acknowledged by the mock provider → next eligible customer is dialed automatically |
| 3:00 | `lead` → `/customers/<that customer>` | Open the customer | "Routine calls suppressed until …" (120 h cooldown + PTP protection, customer-wide across loans/numbers/campaigns); promise listed; next action |
| 3:30 | `integrator` → `/payments` → simulator | Post a verified payment for that loan (kind POST), then **replay** the same transaction | Allocation, promise attribution, cure at zero overdue, obsolete work withdrawn; replay returns DUPLICATE with no effect |
| 4:15 | `lead` → `/operations` | Live supervision | Agent states (provider-confirmed), backlog, overflow, pending wrap-ups, exceptions |
| 4:45 | agent | Choose **No payment commitment** on the next call and type "might pay Friday" in the statement field | Stored as a customer statement with provenance; no promise, reminder or protection is created |

Variants to show on request: **Already paid (claim)** → reconciliation task + hold, balances untouched; **Wrong number** → contact point blocked, no cooldown; **Third party** → only "No borrower conversation"/"Special-case referral" are offered.

## 3. Evidence produced tonight

- `AGENT_WORKFLOW_ACCEPTANCE.md` — scenario results, expected vs actual, interaction counts, evidence, gaps.
- `docs/evidence/agent-interaction-counts.md` (+ `.json`) — measured clicks/typing/submissions per scenario in the real browser.
- Screenshots: `docs/screenshots/agent-home-*.png`, `agent-reserved-*.png`, `agent-live-*.png`, `agent-live-captured-*.png`, `agent-acw-*.png` at 1440 and 1024 px, plus the 24 management screens at 1440/1280/1024.
- Automated checks: `npm run typecheck`, `npm run lint`, `npm test` (39 unit), `npm run test:integration` (29: journey 14 + collection floor 5 + guided conversation 10), `npm run e2e` (browser critical path), `npm run measure`, `npm run build`. Results are listed in `BUILD_STATUS.md`.

## 4. Remaining defects and real-provider dependencies

Defects / limitations found and left open (none blocks the demo):
- The ACW layout at ≤ 1024 px stacks facts above responses; the review strip is reachable by scrolling (acceptable, documented).
- Transfer is disabled: the mock provider has no transfer leg; blended inbound reservation contention is not demonstrated (no inbound provider).
- Analytics roll/cure matrices need two daily decision runs; S19 validation statistics stay "unavailable" until matured labels exist.

What only a real Orange (or other) telephony integration can prove — not tested through the mock:
- Real audio path, headset/softphone readiness, carrier results and answer/machine detection accuracy.
- Provider agent auto-accept / whisper, screen-pop timing at the connection point, p95 screen-pop delay under load.
- Provider wrap-up mapping semantics (callability after dispositions, campaign recycle/recall behaviour) and withdrawal acknowledgment latency.
- CTI reconnect/reconcile behaviour against the actual event stream; transfer and hold semantics.
- Identity/platform/version/licensed CTI capabilities of the current Orange deployment (still unknown).

## 5. Next three priorities

1. **Real-provider capability test**: obtain the Orange platform/version and CTI/API documentation, map its events to `NormalizedProviderEvent`, run the 12 CTI scenarios and the floor simulation against a test extension; record pre-dial suppression, wrap-up gating and withdrawal behaviour as pass/fail capability flags.
2. **Bank sign-off of the conversation dictionary and contact policy**: review the quick-choice labels, reason list, required fields and the factual-summary wording with collections leads and compliance; run a two-reviewer calibration on a permitted sample; activate the agreed contact policy through S11.
3. **Core banking and payment-feed contracts**: confirm allocation order, balance/DPD reconciliation rules and the event envelope with ATB IT; implement the real adapters behind `CONNECTOR_*` and re-run the payment-consequence tests against sample files.

## 6. If something looks wrong in the morning

- Agent stuck in after-call work: the worker is probably not running (`npm run worker`); wrap-ups and state changes are queued in the outbox and visible on `/integrations`.
- "Worker offline" badge on the desktop: same cause.
- Stale demo state: `npm run db:reset` restores the seeded 27 Oct 2026 business date.
- Continuation prompt for a fresh session: see the end of `BUILD_STATUS.md`.
