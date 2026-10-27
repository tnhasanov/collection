# Assumptions and unresolved production inputs

Every parameter below is visible in the application with its provenance (`/settings`, `/models/prometeia`,
`/strategies`). **Source-based** values come from the supplied pack (deck, master prompt); **demo assumptions**
are reversible placeholders chosen so the synthetic demo can run end to end; **bank-approved** values do not
exist yet. Nothing here asserts an Azerbaijani legal requirement.

## 1. Product and financial conventions

| Topic | Value used | Provenance | Notes |
|---|---|---|---|
| Product | Unsecured AZN cash loans, fixed nominal annual rate, monthly annuity | Source-based | Fixture 10,000 / 18% / 24 months → 499.24 (150.00 interest + 349.24 principal, closing 9,650.76) reproduced in `tests/unit/annuity.test.ts`. |
| Rounding | Half-up to 0.01 AZN per installment; final installment absorbs the rounding residual | Demo assumption | Core banking's schedule wins whenever it is imported (`ScheduleVersion.source = CORE_IMPORT`); the local simulation is labelled and never overwrites it. |
| Periodic rate | nominal annual rate ÷ 12 | Source-based | No day-count convention supplied; schedule dates use the day-of-month anchor with month-end clamping. |
| DPD | Calendar days since the oldest unpaid due date (end of day Asia/Baku), tolerance 0.00 AZN | Demo assumption | Core DPD overrides the local derivation when a balance snapshot carries it; mismatches raise reconciliation issues. |
| Partial payments | Allocate oldest due first, interest before principal within an installment, remainder unapplied; never cure | Demo assumption (`DEMO_ALLOCATION_POLICY`) | The bank's allocation order must be confirmed; no fee, penalty or capitalization is invented. |
| Business date | Asia/Baku; seeded 27 Oct 2026; offset clock in DEMO | Demo assumption | INTEGRATION mode uses the real clock only. |
| Currency | AZN only | Source-based | Imports reject other currencies. |

## 2. Decision module (Prometeia)

| Topic | Value used | Provenance | Notes |
|---|---|---|---|
| 4–10 DPD model | DRAFT transcription of the page-10 rule table (8 leaves, probabilities 0.08 … 0.42) | Source-based (draft) | Page-11 Class 7 leaf label conflicts with its split; page-10 probabilities are used and the conflict is listed on S13. |
| 1–3 DPD | DEMO-only MAX_DPD_L3M bands (0.030 / 0.059 / 0.090 / 0.149) | Demo assumption | Not production-activatable; labelled DEMO ONLY everywhere; self-cure preference applies. |
| 11–30 DPD | Draft empirical roll rates 0.198 / 0.269 / 0.337 for 11–16 / 17–23 / 24–30 | Source-based (draft) | Boundary 10 vs 11 is unresolved (model segment overlaps a [10,17) table). |
| 31+ DPD | No early-arrears probability; later-stage review queue | Source-based | Separate policy; handover via S26. |
| Target event | Deterioration to over 30 DPD within the following month | Source-based (wording to confirm) | "30+" vs "over 30" must be confirmed by the provider. |
| Feature freshness | Latest complete monthly snapshot; max age 45 days, else Unscored | Demo assumption | Missing or stale features never produce an invented probability. |
| Exposure | Sum of principal outstanding of eligible active cash loans per customer | Demo assumption | Must match the approved dictionary (accrued interest, performing loans, aggregation). |
| ERA | p × exposure, ranking amount only (no LGD, not ECL, not recovery) | Source-based | |
| Action buckets | Ten position-based deciles at the daily snapshot; identical ERA shares a bucket (lower) | Demo assumption | Fewer than ten distinct values leave buckets empty (recorded on the run). |
| Treatment | 1–4 SMS; 5–6 SMS fallback (IVR unavailable); 7 selective call if spare capacity; 8–9 regular calls; 10 senior calls | Source-based (deck) + Phase 1 capability | Unavailable IVR does not convert every digital case into an agent call. |
| Ranking | ERA desc, oldest overdue due date asc, customer id asc | Demo assumption | Deterministic and reproducible. |
| Rescoring | Daily snapshot; intraday events only invalidate work | Demo assumption | |

## 3. Contact policy (customer-wide, server-enforced)

| Rule | Value used | Provenance |
|---|---|---|
| RPC cooldown | 120 hours after a verified right-party conversation | Source-based reading of "minimum five days" |
| PTP protection | No routine calls until deadline + settlement allowance (2 days) + end of day Baku; weekend deadlines roll to Monday 09:00 | Demo assumption |
| Permitted hours | 09:00–20:00 Mon–Sat, Sunday blocked, holiday list configurable | Demo assumption |
| Daily / weekly attempt caps | 2 per day, 5 per week per customer (all campaigns) | Demo assumption |
| SMS limits | 1 per day, 3 per week | Demo assumption |
| Retry timing | NO_ANSWER +4 h, BUSY +2 h, VOICEMAIL +1 day, FAILED +1 day; max 3 failed attempts per day | Demo assumption |
| Freshness | Balances ≤ 15 min, payment feed ≤ 15 min for amount-specific outreach | Demo assumption |
| Holds | Open dispute, support hold until date, paid-claim reconciliation hold (2 business days), deceased/legal status | Demo assumption |
| Customer-requested callback | Narrow exception: allowed inside the requested window even during cooldown, never outside permitted hours or against disputes/legal | Demo assumption |

## 4. Economics and capacity

| Topic | Value used | Provenance |
|---|---|---|
| Unit costs | SMS 0.031 per SMS; IVR 0.20 per attempt; agent 1.75 per customer-day (3,076 AZN ÷ 22 days ÷ 80 contacts) | Source-based (deck draft) |
| Uplift scenarios | SMS 0.001/0.003/0.005; IVR 0.005/0.01/0.025; agent 0.025/0.05/0.075 (conservative/base/upside, relative ERA reduction) | Source-based assumptions — never measured causal benefit |
| Capacity | 2 senior + 4 regular agents; 80 successful contacts per agent-day is a planning scenario, not a target; historical 219 attempts / 107 worked / 82 reached per agent-day; RPC 0.76 | Source-based |
| Operational | 09:00–18:00 shift, handle 240 s, ACW 60 s, 10% reserve, 15% callback reserve, 35% retry demand | Demo assumption |

## 5. Integration and operations

- All connectors are mocks (`CONNECTOR_*=mock`, identity `local-demo`). Core banking, payment feed, customer master, SMS gateway, dialer and identity provider contracts are proposals (`INTEGRATION_MAPPING.md`), not confirmed ATB endpoints.
- No commercial dialer or Orange API is assumed; the `DialerAdapter` contract is provider-neutral and the mock provider is deterministic.
- The demo send for SMS writes to the local outbound log; "sent" is a local status, not a gateway receipt.
- Identity: local demo accounts with scrypt-hashed passwords and DB sessions; production requires the bank's IdP (OIDC/SAML) and MFA.
- Restricted hardship details are stored as opaque "restricted" markers in the demo; a production build needs the approved repository and field-level encryption.

## 6. Unresolved production inputs (blocking a production go-live, not the demo)

1. Signed executable Prometeia rule artifact with golden cases and the resolved Class 7 / DPD 10 / target-wording conflicts.
2. Exact feature definitions (ADJ/100, ratio denominators, zero balances, month windows) and the monthly feature file contract.
3. Approved 1–3 DPD probability mapping (or confirmation that only self-cure/digital applies) and any 31–45 DPD probability.
4. Exposure definition for ERA and the bank's allocation order for partial payments.
5. Contact policy values as bank policy (cooldowns, hours, caps, holidays) with legal review.
6. Core banking, payment feed and customer master interface specifications; dialer provider selection and CTI event mapping; SMS gateway contract (encoding, segments, delivery receipts, sender id).
7. Identity provider, roles directory, retention/PII rules and the audit export target.
8. BI/reporting export contract and the official metric definitions (`METRIC_DICTIONARY.md` is the proposal).
