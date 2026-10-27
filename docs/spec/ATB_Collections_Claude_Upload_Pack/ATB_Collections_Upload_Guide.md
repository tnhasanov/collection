# ATB Collections - upload pack and start instructions

Prepared for Tural Hasanov | 28 October 2026 | Consolidated starting pack

This pack contains the full build specification, automatic dialer/agent workflow, operating process, ATB branding, screen references and original Prometeia source. You can begin a new Claude Code project with it; earlier conversation messages are not required.

## Start in Claude Code

1. Download and extract `ATB_Collections_Claude_Upload_Pack.zip`.
2. Put the extracted `ATB_Collections_Claude_Upload_Pack/` folder inside the project where Claude Code will work. For a new project, create an empty project folder first and place the pack in it. Keep the folder structure so Claude can access the brand assets and individual screens.
3. Open Claude Code in that project and paste the complete contents of `ATB_Collections_Ultimate_Prompt.md` as the first instruction.
4. Let Claude inspect the files and build the first end-to-end local slice, then complete the P0 scope and proceed through the defined later scope. The first slice already includes automatic dialer simulation and the agent desktop.
5. Use the README/run commands Claude produces to start the web app, worker and local database. Follow DEMO_SCENARIOS.md to verify the complete journey. The pack itself is a build specification and reference set, not an already implemented application.

For a chat attachment workflow, attach the four main documents in the table below and paste the ultimate prompt. Make `brand/` and `screens/` available to the coding workspace when implementing. Extract archives first; do not assume an attached ZIP will be inspected automatically. Claude Code with repository/file access is the intended environment for implementing and testing the full backend and worker.

## The four main documents

| File | Role |
|---|---|
| `ATB_Collections_Claude_Master_Prompt.md` | Authoritative written requirements: benchmark/context, financial/domain logic, 28 screen specs, ATB theme, automatic dialer/agent integration, operating process, phases and acceptance cases |
| `ATB_Collections_Screen_References.pdf` | 12 ATB-colored core screen references |
| `ATB_Dialer_Agent_Desktop_Screens.pdf` | Four ATB-colored agent and supervisor states: dashboard, live call, wrap-up and live supervision |
| `Prometeia_ATB_Collections_Source.pdf` | Original supplied project deck, copied unchanged under a simple filename |

Read `ATB_Collections_Ultimate_Prompt.md` as the start instruction, not as a replacement for the master. The screenshots cover 16 selected states across 28 screen specifications, rather than 28 completed application pages. All mockup customers, figures, graphs and interactions are synthetic layout examples.

## Other included files

- `brand/ATB_Collections_Theme.css`: implementation-ready color tokens and basic usage.
- `brand/atb-theme.json`: the same palette in structured form.
- `brand/atb-logo.svg`: original official logo; use it unchanged.
- `brand/atb-logo.png`: raster version for compatible use.
- `brand/README_ATB_Theme.md`: color provenance and usage notes.
- `screens/`: all 16 individual PNG references plus `INDEX.md` with screen-to-route mapping.
- `reference/ATB_Dialer_Agent_Desktop_Addendum.md`: convenience copy of the earlier addendum. Its full requirements are already included in Part C of the master; uploading it separately is unnecessary.
- `PACKAGE_CONTENTS.md`: file inventory and main-reference checksums.

## Which instruction takes precedence

The master is the single authoritative specification. Implement Parts B, C and D; use Part A for research context, evidence and unresolved model inputs. Parts C and D clarify the automatic agent workflow and delivery priorities. Part B section 5.1 plus `brand/` controls visual styling. The PDFs and PNGs illustrate layout; they do not override business logic. The duplicate standalone dialer addendum is a reference extract.

The Prometeia deck is source evidence, not a final approved executable model. The master explicitly documents missing mappings, the DPD 10 boundary, model-tree discrepancy, exposure/cutoff questions and later-arrears coverage. Demo assumptions must stay labeled. Do not let Claude fill a production gap by pretending a value was supplied or approved.

## Expected first demonstration

Agent signs in -> confirms Ready -> receives the next eligible customer automatically -> sees customer and script -> records verified contact and a valid promise -> saves wrap-up -> routine calls are suppressed -> a mock posted payment is injected -> promise, arrears, case, queue and dashboard update -> replaying the event produces no duplicate effect.

Also test a failed attempt, an ineligible customer, partial payment without cure, a stale payment source and an unresolved wrap-up. A customer with multiple loans must still have one coordinated outbound call reservation.

## Current boundaries

This is an internal collections application for existing consumer cash loans with annuity repayments. Core banking remains the financial source of truth. Loan origination, underwriting, disbursement and the general ledger are separate systems. The local annuity engine is for synthetic data, simulation and reconciliation comparison.

The current Orange telephone application and its underlying platform have not been identified precisely. No dialer has been selected or bought. Build a provider-neutral mock integration first and document the real capability/mapping requirements. Progressive automatic routing is the demo default. The initial build places no real call, sends no real message, moves no money, connects to no ATB production system and requires no commercial dialer account.

ATB brand anchors: UI purple #6F0BBB, dark purple #34035D, yellow #F4C900 and pale lavender #F8F0FE. The supplied official logo retains its original #6F0BB5 purple. Operational status/neutral colors are application choices; the pack does not claim to be a formal bank brand manual. Brand source: https://atb.az/media/ and the bank website stylesheet.

Original source filename: `ATB ERM Diagnostic Status Meeting 18062026-5.pdf`. The deck's title page says 19.06.2026; its original filename contains 18.06.2026. Collection material is on PDF pages 4 and 7-23. The copy in this pack has identical bytes to the supplied attachment.
