# API contracts (internal application API)

All routes live under `src/app/api/**/route.ts`, return `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`,
require the session cookie and check a permission server-side (see `docs/PERMISSIONS.md`). Bodies are validated with Zod.

## Authentication
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/auth/login` | POST | — | Local demo identity (`username`, `password`) → DB session cookie |
| `/api/auth/logout` | POST | — | Revoke session |
| `/api/auth/switch-role` | POST | `demo.switch-role` | DEMO only, audited |

## Agent desktop and CTI
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/agent/context` | GET | `agent.desktop` | Full desktop context (session, reservation, interaction, customer, script, policy, notifications) |
| `/api/agent/stream` | GET (SSE) | `agent.desktop` | Live updates; client falls back to polling |
| `/api/agent/session` | POST | `agent.desktop` | Start CTI session (mock provider confirms extension/campaigns) |
| `/api/agent/state` | POST | `agent.desktop` | Request READY / NOT_READY / BREAK / OFFLINE (confirmed by provider; blocked by pending wrap-up) |
| `/api/agent/heartbeat` | POST | `agent.desktop` | Session liveness (stale sessions are not allocated) |
| `/api/agent/auto-continue` | POST | `agent.desktop` | Auto Ready after wrap-up toggle |
| `/api/agent/call-control` | POST | `agent.desktop` | MUTE / HOLD / END via outbox |
| `/api/agent/manual-dial` | POST | `agent.desktop` (senior) | Policy-checked manual reservation |
| `/api/agent/interactions/{id}/draft` | POST | `interaction.write` | Auto-saved recoverable draft (idempotency key) |
| `/api/agent/interactions/{id}/preview` | POST | `interaction.write` | Validation + next-action preview |
| `/api/agent/interactions/{id}/outcome` | POST | `interaction.write` | Idempotent save; promise/callback/claim/dispute/support effects; wrap-up request |
| `/api/agent/notifications/read` | POST | `agent.desktop` | Mark notifications read |

## Work, customers, promises, callbacks, payments
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/work-items/claim-next` | POST | `queue.claim` | Atomic claim (`FOR UPDATE SKIP LOCKED`, JIT policy) |
| `/api/work-items/{id}/release`, `/reassign` | POST | `queue.claim` / `queue.reassign` | Release / reassign with reason |
| `/api/customers/search`, `/api/customers/{id}` | GET | `customer.read` (+ scope) | Search; customer 360 |
| `/api/customers/{id}/eligibility` | GET | `customer.read` | Contact-policy evaluation with reason codes |
| `/api/customers/{id}/sms` | POST | `customer.read` | Policy-checked approved SMS to the local outbox |
| `/api/customers/{id}/escalate` | POST | `customer.read` | Escalation task |
| `/api/interactions` | POST | `interaction.write` | Manual interaction (inbound / note) |
| `/api/promises`, `/api/promises/{id}/cancel` | POST | `promise.write` | Create (one active per customer) / cancel with reason |
| `/api/callbacks` | POST | `callback.write` | Create callback within policy |
| `/api/loans/{id}/schedule`, `/simulate` | GET / POST | `customer.read` | Core schedule; local annuity simulation (never overwrites core) |
| `/api/integration-events` | POST | `integration.operate` | Idempotent inbound events (see INTEGRATION_MAPPING.md) |
| `/api/demo/payments/simulate` | POST | `payment.simulate` (DEMO only) | kinds POST / REPLAY / REVERSE / LATE / CLAIM_ONLY |

## Decisions, strategy, model, economics
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/decisions/run` | POST | `operations.manage` | Manual daily decision run |
| `/api/strategies` | POST | `strategy.draft` | Clone into a new draft version |
| `/api/strategies/{id}` | GET / PUT | `strategy.read` / `strategy.draft` | Read; update validated decision tables (DRAFT/TESTED) |
| `/api/strategies/{id}/simulate` | POST | `strategy.read` | Dry simulation (stores result, DRAFT → TESTED) |
| `/api/strategies/{id}/submit` | POST | `approval.request` | STRATEGY_ACTIVATION approval request with the simulation as impact |
| `/api/strategies/explain` | GET | `strategy.read` | Customer-level explanation under a version |
| `/api/models/test-score` | POST | `model.read` | Score a test case (features, DPD, exposure, as-of) |
| `/api/models/import` | POST | `model.draft` | Validated JSON rule package → DRAFT version with golden-case results |
| `/api/models/template` | GET | `model.read` | Example package |
| `/api/economics/compute` | POST | `strategy.read` | Scenario computation (break-even, benefit, capacity) |

## Governance and operations
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/approvals/{id}/decide` | POST | `approval.decide` | APPROVE (applies effect) / REJECT / REQUEST_INFO; no self-approval |
| `/api/approvals/{id}/cancel` | POST | `approval.request` | Maker cancels |
| `/api/approvals/rollback` | POST | `approval.request` | Rollback request for the active strategy/model |
| `/api/settings` | PUT | `settings.read` + role | Audited setting change; `model.*` / `contactPolicy.*` become approval requests |
| `/api/operations/live`, `/controls`, `/assist-wrapup`, `/rebalance` | GET/POST | `operations.read` / `operations.manage` | Live supervision, kill switch / pauses, assisted wrap-up, rebalance simulation |
| `/api/integrations/{source}/action` | POST | `integration.operate` | TEST / DRY_RUN / PAUSE / RESUME / REFRESH_NOW / ROTATE_SECRET_REF |
| `/api/integrations/outbox/{id}/replay` | POST | `integration.operate` | Replay a dead letter |
| `/api/exceptions/{id}` | POST | `exception.manage` | ASSIGN_ME / REQUEST_REFRESH / RESOLVE / REOPEN |
| `/api/analytics/export` | GET | `export.scoped` | CSV with as-of and definition versions |
| `/api/imports/validate`, `/api/imports/{id}` (+ `/dry-run`, `/commit`, `/rollback`, `/issues`), `/api/imports/templates/{dataset}` | POST/GET | `import.write` | Import wizard |
| `/api/arrangements`, `/simulate`, `/{id}/transition` | POST | `arrangement.write` / `customer.read` / `arrangement.review` | Hardship arrangements |
| `/api/campaigns`, `/{id}/audience`, `/{id}/transition` | POST/GET | `campaign.manage` | SMS campaigns |
| `/api/templates`, `/preview`, `/{id}/submit` | POST | `template.manage` / `approval.request` | Templates |
| `/api/recovery/handovers`, `/{id}/transition`, `/{id}/export` | POST/GET | `recovery.manage` | Handover packets |

Error codes: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE` (422),
`VALIDATION` / `BAD_JSON` (400), `INTERNAL` (500).
