# Integration mapping and adapter contracts (proposals, mock implementations)

The collections layer never owns contracts, schedules, postings, balances or DPD. Every external system is reached
through an adapter behind a feature flag (`CONNECTOR_*`); in this repository all adapters are **mocks** and the demo
identity provider is local. The contracts below are proposals to be confirmed with ATB; none is a confirmed ATB
endpoint. Health, freshness and mode of every source are visible on `/integrations` (S21).

## Sources and adapters

| Source (`SourceWatermark.sourceSystem`) | Direction | Demo mode | Contract | Freshness threshold (demo) | Owner module |
|---|---|---|---|---|---|
| CORE_BANKING | inbound | MOCK_INBOUND | Loan/customer/schedule imports (S20 datasets `loans`, `schedules`, `arrears`) and `loan.balance.snapshot` events | 15 min for balances | `imports/*`, `payments/paymentService.ts` |
| PAYMENT_FEED | inbound | MOCK_INBOUND | `payment.posted` / `payment.reversed` events (`POST /api/integration-events`, service account) or `payments` import | 15 min | `payments/paymentService.ts` |
| CUSTOMER_MASTER | inbound | MOCK_INBOUND | `customers`, `contacts` imports; `customer.contact.updated` events | 60 min | `imports/*` |
| PROMETEIA_FEATURES | inbound (monthly file) | FILE_DRAFT | `features` import (canonical feature names + aliases), optional `scores` import | 45 days | `imports/*`, `decisions/*` |
| SMS_GATEWAY | outbound | LOCAL_OUTBOX | Outbox topic `sms.send` → local outbound log (`OutboundMessage`); a real gateway adapter must return delivery receipts | — | `dialer/runtime.ts`, `jobs/maintenance.ts` |
| DIALER | both | MOCK_PROVIDER | `DialerAdapter` contract below; provider events via `ingestProviderEvent` | 5 min | `dialer/*` |
| IDENTITY | — | LOCAL_DEMO | Local accounts (scrypt), DB sessions, cookie `atb_session`; production: OIDC/SAML + MFA | — | `auth/*` |
| BI_EXPORT | outbound | DISABLED | No contract supplied; analytics CSV export exists per tab | — | `analytics/*` |

## Integration event envelope (inbound, idempotent)

`POST /api/integration-events` (permission `integration.operate`; service account `svc.core-feed`). Schema in
`src/server/modules/payments/paymentService.ts` (`integrationEventSchema`):

```json
{
  "schemaVersion": "1.0",
  "eventId": "core-evt-000123",
  "eventType": "payment.posted | payment.reversed | loan.balance.snapshot | customer.contact.updated",
  "sourceSystem": "CORE_DEMO",
  "sourceEventId": "TXN-000123",
  "sourceVersion": "7",
  "occurredAt": "2026-10-27T09:15:00+04:00",
  "businessDate": "2026-10-27",
  "customerId": "C-DEMO-001",
  "loanId": "CORE-L-DEMO-001",
  "correlationId": "batch-42",
  "payload": { "transactionId": "TXN-000123", "amount": "499.24", "currency": "AZN", "valueDate": "2026-10-27", "loanRef": "CORE-L-DEMO-001" }
}
```

Rules: `(sourceSystem, sourceEventId, eventType)` is unique → a replay returns `DUPLICATE` with no effect; unknown
loan/customer references are `QUARANTINED` (visible on `/payments` and `/exceptions`); a balance snapshot older than
the current `sourceVersion` is `SUPERSEDED`; only `PROCESSED` verified postings change financial state; every event
is stored in `IntegrationEvent` with its result. Reversals reference `originalTransactionId`.

## Import datasets (S20) and mapping templates

Templates: `docs/templates/import-*.csv` (also downloadable from `/api/imports/templates/<dataset>`). Canonical
columns, synonyms for auto-mapping, key columns and rollback mode are defined in
`src/server/modules/imports/datasets.ts`.

| Dataset | Key | Critical | Rollback | Notes |
|---|---|---|---|---|
| customers | customer_id | no | retained (reverse import) | status enum ACTIVE/INACTIVE/DECEASED_NOTIFIED/LEGAL |
| contacts | customer_id+type+value | no | delete by batch | new points are UNVERIFIED unless stated |
| loans | core_loan_id | yes | retained | new loans get an annuity-engine schedule until a schedule import supersedes it |
| schedules | core_loan_id+schedule_version+seq | yes | retained | new current CORE_IMPORT version; previous versions kept; projection restated |
| payments | transaction_id | yes | reversal events | each row → idempotent integration event; duplicates skipped |
| arrears | core_loan_id+as_of | yes | retained | stored as snapshots; mismatches vs projection raise `PROJECTION_MISMATCH` |
| features | customer_id+observation_month | no | delete by batch | becomes the latest complete monthly snapshot |
| scores | customer_id+score_as_of+model_version | no | delete by batch | retained as `EXTERNAL_SUPPLIED`, not used for routing |

Batch lifecycle: UPLOADED → VALIDATED → DRY_RUN → COMMITTED → ROLLED_BACK, with `(dataset, checksum)` duplicate
protection, control totals (rows, accepted, rejected, duplicates in file / in store, missing references, invalid
dates/amounts, schema mismatch, amount totals by currency, source as-of), row-level issues and a downloadable error
file (formula-injection guarded). Identifier columns accept `[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}` only.

## Dialer / CTI adapter contract (`src/server/modules/dialer/contract.ts`)

Provider-neutral; no commercial dialer or Orange API is assumed. The worker owns the adapter instance; the web app
only writes outbox commands and reads state.

| Method | Purpose |
|---|---|
| `capabilities()` | Progressive/preview modes, call controls, wrap-up receipts supported by the provider |
| `getAgentState(agentRef)` / `setAgentState(cmd)` | Confirmed agent state (READY, NOT_READY, BREAK, OFFLINE …); requested vs confirmed are stored separately |
| `authorizeOrPublishWork(ticket)` | Routing ticket for one customer/contact/agent (reservation id, correlation id, campaign, language, skill) |
| `withdrawWork(cmd)` | Withdraw a pending contact (payment-before-dial, policy change); unacknowledged withdrawals raise exceptions |
| `requestCallControl(cmd)` | MUTE / HOLD / END (transfer not supported by the mock) |
| `submitWrapUp(cmd)` | Provider disposition (`PROVIDER_DISPOSITION_MAP`) after the business outcome is saved; receipts gate Ready |
| `getInteraction(ref)` / `reconcile(since)` | Reconciliation of provider interactions against local attempts |

Normalized provider events (`NormalizedProviderEvent`): `reservation.assigned`, `attempt.started`,
`customer.ringing`, `customer.answered`, `agent.bridged`, `call.ended` (technical result: ANSWERED, NO_ANSWER, BUSY,
VOICEMAIL, FAILED, INVALID_NUMBER …), `agent.state.changed`, `connectivity.lost/restored`. Events are idempotent by
`(providerEventId)`; unknown command receipts are treated as unresolved (never as success). Outbox topics:
`dialer.agentState`, `dialer.wrapup`, `dialer.withdraw`, `dialer.callControl`, `agent.notify`, `sms.send`.

Real-provider pilot needs: endpoint/security mapping, test extension and campaign, event samples, pre-dial
suppression behaviour, wrap-up timeout configuration, transfer/reconnect tests and operational owners.

### Call controls, persisted provider state and reconciliation (pilot hardening)

- Call controls (`requestCallControl`: MUTE/UNMUTE/HOLD/RESUME/TRANSFER/END) are outbox commands; the receipt is one
  of three truths — **CONFIRMED** (the interaction's `controlState` flags follow the provider), **REJECTED** (durable
  `lastError`, and for END an exception `CALL_CONTROL_FAILURE` owned by a supervisor), **UNKNOWN** (retried with
  backoff; `CALL_STATE_UNKNOWN` after two minutes). The desktop renders only capabilities the adapter reports
  (`capabilities.callControls`, published in the worker heartbeat) and shows pending / confirmed / error per control.
- The mock provider's view is persisted implicitly: on start the worker rebuilds it from reservations, open
  interactions and active sessions (`hydrateMockAdapter`), then `reconcileProviderState` runs every minute: provider
  ENDED → truthful `call.ended`; provider UNKNOWN → error + exception; sessions corrected to the provider state.
- Supervisor recovery: `POST /api/operations/controls {action: "FORCE_END_CALL", interactionId, reason}` moves the
  call to after-call work with an upper-bound talk time and resolves the related exceptions (audited).

## SMS gateway (proposal)

Outbound: template id/version, language, rendered body, encoding (GSM-7 / UCS-2) and segment estimate, dedup key
`campaign:customer:day`, policy check result at dispatch. Inbound receipts: SENT / DELIVERED / FAILED / UNKNOWN per
provider reference; opt-out keywords update contact preferences. The demo marks messages SENT in the local log.

### Message kinds and reminder receipts

`OutboundMessage.kind` distinguishes CAMPAIGN, PTP_REMINDER, PAYMENT_INSTRUCTIONS and MANUAL messages; every message
records `segments` (GSM-7 160/153, UCS-2 70/67 — Azerbaijani letters force UCS-2) and `estimatedCost` from
`economics.unitCosts`. Promise reminders are durable `ReminderJob` rows (SCHEDULED → SENT → DELIVERED / FAILED /
SKIPPED / CANCELLED) with pre-send rechecks (promise still active and unchanged, remaining amount, permitted hours,
verified mobile, SMS policy, active template). A real gateway adapter must return SENT at acceptance and a delivery
receipt that the worker maps onto the same fields.

## Identity and access (proposal)

OIDC/SAML federation with role claims mapped to `Role`; team membership from the directory; session lifetime and
MFA per bank policy. Object-level customer scope stays in the application (`src/server/auth/access.ts`).

### Access scope and modes

One server-side customer scope (`src/server/auth/scope.ts`) is applied before pagination to every list, search,
aggregate, export and API. Unscoped roles see everything (optionally limited to their branch scopes); agents see
customers reserved for them, work they own or claimed, their own interactions inside `access.scopedHistoryDays`
(14 days, draft) and their active or recent promises. Sessions are revalidated on every stream tick; a revoked
session closes the stream and returns the browser to sign-in. Modes: DEMO (shared identities, role switch), PILOT
(individual identities, forced password change, rate-limited sign-in, no role switch), INTEGRATION (bank IdP).

### Health endpoints

`GET /api/health/live` (process alive) and `GET /api/health/ready` (database, migrations applied, worker heartbeat,
provider capabilities); see DEPLOYMENT.md.

## Resilience

Transactional outbox with bounded retries and backoff → DEAD letters visible on S21 with replay; durable jobs
(pg-boss) with heartbeat; leases on claimed work; reservations expire (3 min) with exceptions; idempotency keys on
every outbound command and every inbound event; audit of every mutation. Failures are shown, never hidden.
