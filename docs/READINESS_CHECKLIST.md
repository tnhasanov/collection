# Production readiness checklist (what the demo proves vs what remains)

Legend: ✅ demonstrated with synthetic data · 🟡 implemented, needs bank input/approval · ⛔ not started / out of scope

## Functional
- ✅ Automatic progressive dialing journey with provider-confirmed states, one reservation per customer, one voice interaction per agent, wrap-up gating, reconnect safety, duplicate events, unknown command results, payment-before-dial withdrawal, payment-during-call notification, deferred breaks.
- ✅ Structured outcome capture with conditional fields, server validation, next-action preview, idempotent save, corrections with audit.
- ✅ Customer-wide contact policy evaluated at scheduling, reservation and dispatch with reason codes.
- ✅ Idempotent payment ingestion, allocation, promise attribution, cure at zero overdue, reversals, paid-claim reconciliation hold, duplicate replay with no effect.
- ✅ Daily decision snapshot (segments, draft tree, ERA, deciles, treatment, ranking) and work-item sync; manual re-run.
- ✅ Strategy/model/policy/template/campaign/arrangement/handover governance through maker/checker approvals with rollback targets.
- 🟡 Later-stage policy beyond handover; legal/statutory notices (explicitly out of scope).
- ⛔ Customer self-service (P2), IVR/email channels, inbound reservation contention (no inbound provider).

## Data and integrations
- ✅ Adapter contracts (core, payment feed, customer master, SMS, dialer, identity) with mock implementations; outbox with bounded retries and dead letters; source watermarks and freshness thresholds; import wizard with quarantine and rollback.
- 🟡 Real connector configuration behind `CONNECTOR_*` flags (all `mock`); field mappings in `INTEGRATION_MAPPING.md` are proposals.
- 🟡 Core schedule/balance reconciliation rules (tolerances, who wins) need the bank's confirmation.
- ⛔ Document repository for hardship evidence; BI export contract.

## Security and operations
- ✅ Server-side RBAC and object-level customer scoping, audited denials; append-only audit trail (DB trigger); masked contacts for restricted roles; no secrets in the repository.
- 🟡 Identity provider (OIDC/SAML + MFA), session hardening (secure cookies behind TLS), secret management, PII retention and export controls.
- 🟡 Observability: worker heartbeat and job runs exist; metrics/log shipping and alerting need the bank's platform.
- 🟡 Backups, DR, migration runbooks for PostgreSQL.

## Model governance
- ✅ Draft transcription with golden cases, version compare, test-score panel, unresolved issues panel, monitoring that reports "unavailable" honestly.
- 🟡 Signed executable artifact, feature dictionary, approved exposure definition, 1–3 DPD rule, boundary decisions (see `MODEL_CARD.md`).
- ⛔ Matured labelled observations for validation (GINI/AUC, calibration, drift).

## Quality gates (current)
- Typecheck, lint, 50 automated tests (unit + integration), browser critical path, screenshots at three widths.
- ⛔ Load/performance testing, accessibility audit with assistive technology, penetration test.
