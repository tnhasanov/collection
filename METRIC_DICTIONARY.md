# Metric dictionary (version 1.0, as of 2026-10-27)

Every ratio shown in the application names its numerator, denominator, scope, unit and maturation window; counts
and exposure (AZN) are always shown separately. Definitions are stored in the `MetricDefinition` table (seeded) and
referenced by the analytics export header (`definitions=CODE@version`). Unadjusted comparisons between strategies,
arms, agents or periods are never labelled as treatment uplift.

| Code | Name | Numerator | Denominator | Scope | Unit | Maturation / freshness |
|---|---|---|---|---|---|---|
| ATTEMPTS | Attempts | Recorded outbound dial attempts (provider callbacks deduplicated per attempt) | — | Period / agent / team | count | Real time from provider events |
| DISTINCT_CUSTOMERS_ATTEMPTED | Distinct customers attempted | Unique customers with ≥ 1 qualifying attempt | — | Period | count | |
| RPC_RATE_ATTEMPT | RPC rate (attempt-based) | Verified right-party conversations | Qualifying attempts | Period | ratio | |
| RPC_RATE_CUSTOMER | RPC rate (distinct-customer) | Distinct customers with ≥ 1 verified RPC | Distinct customers attempted | Period | ratio | |
| COVERAGE | Coverage | Distinct eligible customers worked | Distinct eligible customers assigned in the snapshot | Snapshot | ratio | Daily snapshot |
| PTP_CONVERSION | PTP conversion | Promises obtained | Verified eligible conversations | Period | ratio | |
| KEPT_PTP_RATE | Kept PTP rate | Kept promises | Matured eligible promises (not-yet-due excluded; pending reconciliation shown separately) | Maturity cohort | ratio | Deadline + settlement allowance (2 days) |
| CURE | Cure | Entry-cohort customers back to zero overdue within the window (verified postings only; partial payments never cure) | Entry cohort | Fixed entry cohort | ratio | 30-day window; recent cohorts immature |
| ROLL_FORWARD | Roll-forward | Entry-cohort customers crossing the threshold within the horizon | Entry cohort (matured observations) | Fixed entry cohort | ratio | Needs ≥ 2 daily snapshots / monthly target |
| CASH_RECEIVED | Cash received | Verified posted inflows net of reversals (value-date convention) | — | Period / scope | AZN | Payment feed freshness shown on the page |
| AGENT_ATTRIBUTED_CASH | Agent-attributed cash | Verified allocations credited once to the agent of the latest verified RPC within 10 days (demo rule) | — | Period / agent | AZN | Never double-counted across agents |
| COST | Cost | SMS units × unit cost; agent customer-days × unit cost (scenario units) | — | Period | AZN | Dated unit costs (S14 / S24) |

## Analytics tabs (S18) and their measures

| Tab | Measures | Notes |
|---|---|---|
| DPD distribution | Customers (open cases), share, exposure, overdue by segment | Current daily snapshot; DPD-0 loans listed separately |
| Roll / cure | Segment transitions between the first and latest daily run; cases cured / opened in window | "Insufficient matured observations" when fewer than two runs |
| Entry cohorts | Weekly case-open cohorts: entered, entry exposure, avg entry DPD, cured, cure rate, open, handover | Immature cohorts flagged |
| Cash collected | Postings, posted, reversed, net, PTP-attributed by value date | Quarantined/unmatched excluded until reconciled |
| Promises | Promises by status, promised/paid amounts, kept rate on matured promises | Pending reconciliation separate |
| RPC / contact outcomes | Technical results, identity statuses, business outcomes, RPC rates (attempt and customer based) | Provider callbacks deduplicated |
| Cost | SMS by status × unit cost; agent customer-days × unit cost | Scenario figures, not accounting actuals |
| Action buckets | Customers, exposure, ERA total/min/max, effective actions per bucket | Deciles fixed at the daily snapshot |
| Model classes | Customers, p(roll), exposure, ERA by class/source; unscored reasons | Observed-vs-assigned belongs to S19 |
| Strategies | Customers and treatments per strategy version; experiment arms | Unadjusted comparison only |
| Agent / team | Attempts, distinct customers, RPC, RPC rate, PTP, PTP conversion, attributed cash, backlog | Compare with case mix (S17) |
| Vintage | Loans, principal, outstanding, arrears share, avg DPD, paid-off by origination month | Point-in-time, not a cumulative default rate |

## Operational metrics (S02, S17, S28)

- Live agent states (provider-confirmed), eligible backlog, senior-only backlog vs senior capacity (overflow), overdue callbacks, unsaved/failed wrap-ups, screen-pop delays, suppression sync failures, unacknowledged withdrawals, dead letters, outbox pending, worker heartbeat.
- Agent desktop: today's attempts, RPC, PTP, callbacks due, average handle/ACW time (from interaction timestamps).

## Experiment design note

Experiment arms (`ExperimentAssignment`) are stored per customer and surfaced as filters. A causal uplift claim
needs a pre-registered design (randomized assignment at decision time, matured observation window, intention-to-treat
analysis) — none of the demo comparisons meets that bar, and the UI says so.
