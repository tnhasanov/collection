# Model card — Prometeia early-arrears roll model (DRAFT transcription)

| Field | Value |
|---|---|
| Provider / model code | Prometeia · `PROMETEIA_EARLY_ARREARS_ROLL_4_10` |
| Version in the demo | `DRAFT-2026-06-19-p10` (status ACTIVE **for the synthetic demo only**; approval recorded as "DEMO ACTIVATION — not a bank approval") |
| Candidate | `CANDIDATE-2026-11` (TESTED; activation request pending on S11, blocked until the provider confirms the executable artifact) |
| Source | ATB ERM Diagnostic Status Meeting deck (title page 19.06.2026, file 18.06.2026), PDF page 10 rule table; page 11 tree for structure only |
| Population | Customers with decision DPD 4–10 and a complete latest monthly feature snapshot |
| Target event | Deterioration to over 30 DPD within the following month (wording "30+" vs "over 30" to confirm) |
| Horizon / observation | 1 month; monthly customer-level observation; daily operational scoring reuses the latest complete monthly snapshot |
| Output | Risk class 1–8 with the class probability; ERA = probability × exposure; decile action bucket |

## Rule table (page 10) as implemented (`src/server/modules/decisions/prometeiaDraftModel.ts`)

| Class | Rule | p(roll) |
|---|---|---|
| 1 | DPD_MAX_MAX12 ≤ 7 AND DPD_RATIO_ADJ_MAX12 > 0.025 | 0.08 |
| 2 | 7 < DPD_MAX_MAX12 ≤ 30 AND DPD_RATIO_ADJ_MAX12 > 0.03 | 0.11 |
| 3 | DPD_MAX_MAX12 ≤ 30 AND DPD_RATIO_ADJ_MAX12 ≤ 0.025 | 0.14 |
| 4 | 7 < DPD_MAX_MAX12 ≤ 30 AND 0.025 < DPD_RATIO_ADJ_MAX12 ≤ 0.03 | 0.16 |
| 5 | DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM > −0.4 AND DPD30_ADJ100_CNT_L6M ≤ 1 AND DPD_RATIO_ADJ_VLM ≤ 0.2 | 0.22 |
| 6 | … AND DPD_RATIO_ADJ_VLM > 0.2 | 0.28 |
| 7 | DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM > −0.4 AND DPD30_ADJ100_CNT_L6M > 1 | 0.36 |
| 8 | DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM ≤ −0.4 | 0.42 |

Rules are **data** evaluated by a typed interpreter with three-valued logic (`ruleInterpreter.ts`): a comparison on a
missing/invalid feature is UNKNOWN; null is never zero; exactly one true leaf scores, otherwise the customer is
Unscored with reason codes (`MISSING_PATH_INPUT`, `AMBIGUOUS_RULES`, `NO_MATCHING_LEAF`). Uploaded packages are
validated structurally and never executed as code (S13 import).

## Features (canonical names, aliases, null rule)

| Feature | Description (per deck, exact definition unresolved) | Unit |
|---|---|---|
| DPD_MAX_MAX12 | Maximum DPD within the last 12 months | days |
| DPD_RATIO_ADJ_MAX12 | Maximum adjusted delinquent exposure ratio within the last 12 months | ratio |
| DPD_RATIO_ADJ_V3LM | Latest-month ratio minus the maximum of the previous 3 months | ratio delta |
| DPD30_ADJ100_CNT_L6M (alias DPD_30_ADJ100_CNT_L6M) | Months with a 30+ DPD occurrence in the last 6 months | count |
| DPD_RATIO_ADJ_VLM | Latest-month delinquent exposure ratio | ratio |

Null/NaN → UNKNOWN → Unscored when on the decision path (manual-review queue), never a low probability.

## Golden cases (`GOLDEN_CASES`, 13 cases)

One case per leaf, boundaries at 7, 30, 0.025, 0.03, −0.4, 1 and 0.2, a missing-input case (Unscored,
`MISSING_PATH_INPUT`) and an alias case. They run in `tests/unit/decisions.test.ts`, on S13 for every registered
version, and again inside the approval service before a MODEL_ACTIVATION is applied (activation is refused if any
case fails).

## Segment coverage (`segments.ts`)

| Decision DPD | Probability source | Status |
|---|---|---|
| 0 | none (`NOT_IN_ARREARS`) | Not in the collections population |
| 1–3 | `DEMO_ONLY_1_3_RULE` (MAX_DPD_L3M bands) | DEMO ONLY, not production-activatable; self-cure preference |
| 4–10 | `DRAFT_TREE_4_10` | Draft transcription |
| 11–16 / 17–23 / 24–30 | `DRAFT_ROLL_RATE_11_30` 0.198 / 0.269 / 0.337 | Draft empirical rates; boundary 10/11 is a demo assumption |
| 31+ | none (`UNSUPPORTED_POPULATION_LATER_STAGE`) | Later-stage review / handover |

## From score to action

ERA = p × exposure (demo exposure definition) → ten position-based deciles computed once per daily snapshot
(ties share the lower bucket) → treatment per bucket (1–4 SMS, 5–6 SMS fallback because IVR is unavailable,
7 selective call when spare capacity exists, 8–9 regular calls, 10 senior calls) → server-enforced contact policy
at scheduling, reservation and dispatch. Unscored → manual review; 31+ → later-stage review.

## Unresolved issues (preserved verbatim on S13)

1. Exact definitions of ADJ/100, ratio denominators, zero balances and month windows are not in the deck.
2. Feature alias `DPD_30_ADJ100_CNT_L6M` vs `DPD30_ADJ100_CNT_L6M` requires an explicit mapping.
3. Page-11 Class 7 leaf label conflicts with its incoming count split and the page-10 table.
4. DPD 10 boundary: the 4–10 model segment overlaps a [10,17) table; other pages say 11–30.
5. Target wording "30+" vs "over 30 DPD" and the monthly observation convention must be confirmed.
6. Exposure definition for ERA must match the approved dictionary.
7. 1–3 DPD probability mapping is absent; 31–45 DPD has no approved probability.

## Monitoring (S19)

Live panels: coverage, missing/stale inputs, unscored rate with reasons, class distribution, overrides, external
scores, versions. Observed-vs-assigned roll rates, GINI/AUC, calibration and drift are reported as **unavailable**
until matured, labelled monthly observations exist. Historical deck values (36.6% train GINI, 40.4% OOT GINI) are
documentation, not live results.

## Governance

Activation, rollback and parameter changes go through maker/checker approvals (S11) with before/after, impact,
validation and a rollback target; every decision is audited (append-only). The demo activation of the draft is
synthetic and reversible.
