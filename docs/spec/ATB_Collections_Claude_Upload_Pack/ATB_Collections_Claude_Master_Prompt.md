# ATB consumer cash-loan collections: benchmark and Claude build prompt

Prepared for Tural Hasanov | 27 October 2026 | Updated 28 October 2026 | Revision 4 - consolidated Claude starting pack and operating process

## How to use this file

Use this file from `ATB_Collections_Claude_Upload_Pack/` together with `ATB_Collections_Screen_References.pdf`, `ATB_Dialer_Agent_Desktop_Screens.pdf`, `Prometeia_ATB_Collections_Source.pdf`, and the supplied `brand/` and `screens/` folders. Paste `ATB_Collections_Ultimate_Prompt.md` into Claude Code as the starting instruction. The original source PDF was copied unchanged under the simple pack filename.

**Implement Parts B, C and D. Use Part A as design context and source evidence.** Begin with the first working vertical slice, then continue through the defined phases while following existing repository conventions. These parts contain 28 screen specifications, domain rules, data contracts, sample model rules, ATB branding, automatic dialer/agent integration, the operating process, delivery phases and acceptance scenarios. The two PDFs and 16 PNGs illustrate selected layouts/states; this written specification is authoritative for behavior. Earlier conversation messages and the separate dialer addendum are not required because the complete addendum is already included in Part C.

Read the whole file before coding. Parts C and D clarify the automatic agent workflow and delivery priorities; Part B section 5.1 and the supplied ATB assets control branding. Prometeia source issues remain explicitly unresolved production inputs. Reference-screen figures are synthetic examples, so actual dashboard and table values must come from persisted application records.

Scope assumption: this is an **internal collections application for existing unsecured consumer cash loans with annuity repayments**, integrated with ATB's existing core banking and Prometeia's collection design. Loan origination, underwriting, disbursement, the accounting ledger, and statutory reporting are separate systems. If a future standalone lending business is intended, add those through a separate scope decision.

This specification distinguishes evidence from the supplied deck, proposed product choices, and unresolved production inputs. It does not claim that the deck is the final approved model or policy.

---

# Part A — What to learn from established products

## Recommendation for ATB

Build a focused **collections operating layer**, preserving the existing core banking system as the financial source of truth. Put Prometeia's decision logic in a separately versioned module so it can change without rewriting screens or customer histories. Start with SMS and agent conversations distributed automatically by the connected dialer, as clarified by the user. Exact dialer/CTI capabilities still need discovery; the demo must simulate automatic allocation.

If ATB chooses to buy, my initial evaluation shortlist would be **QUALCO QCR/QCR Accelerator and CRIF Clever**, with **Experian PowerCurve Collections** included when the main requirement is decision strategy and analytics. C&R Debt Manager and CGI Credit Studio are useful benchmarks for broader enterprise workflows. This is a fit assessment for ATB, not an independently tested ranking.

## Vendor comparison

These are observations from current official product material, reviewed on 27 October 2026. They do not replace demos, reference checks, security review, integration assessment, or commercial quotations. No product was installed or hands-on tested for this comparison. Public feature descriptions do not establish suitability for Azerbaijan's rules or ATB's systems.

| Product | Publicly described strengths | What ATB should borrow | Fit assessment / tradeoff |
|---|---|---|---|
| **QUALCO Collections & Recoveries; QCR Accelerator** | Early through late collections, a decision engine, restructuring, self-service, outsourced/legal workflows, and file/API integration. Accelerator targets early collections for smaller and medium-sized lenders. | One customer across loans; treatment workbench; configurable strategies; separated legal handover; affordable repayment support. | Closest functional reference for this project. A full implementation brings more scope than a simple cash-loan MVP. |
| **Experian PowerCurve Collections** | Combines customer data, analytics, treatment decisions, and operational workflows. | Separate scoring from treatment selection; explain the selected action; monitor outcomes by strategy. | Strong strategy reference. ATB must confirm the exact operational modules, interfaces, and configuration rights offered. |
| **C&R Software Debt Manager** | Configurable customer/account/case views, financial processing, workflow configuration, payment handling, decision simulation, and audit controls. | Collector workspace; reusable administration; historical decisions; approval and traceability. | Strong enterprise benchmark; avoid copying the full financial platform when ATB already has a core system. **Debt Manager is now a C&R product; "FICO Debt Manager" is an outdated product attribution.** |
| **CRIF Clever** | Customer-centered collections, segmentation, decisioning, workflow, resource assignment, integration, and reporting. | Clear analysis → decision → execution → monitoring cycle; workload management; central outcome capture. | Good alternative for a process-led implementation. Validate current interface ergonomics and Prometeia model import in a demo. |
| **CGI Credit Studio for collections** | Event-driven workflows, open APIs, collector operations, self-service, analytics, and assistive AI. | Payment events invalidate pending outreach; auditable workflows; optional human-reviewed summaries. | Useful architecture reference. Some published AI functions are marked as forthcoming; do not make them MVP dependencies. |
| **TurnKey Lender** | Loan management, product/schedule configuration, borrower communications, delinquency buckets, collection strategies, and scripts. | Clear loan detail, repayment schedule, product parameters, and manageable operational forms. | A broader lending alternative if origination and servicing are needed later. For ATB collections alone, duplicating the core would add reconciliation work. |

The borrowing recommendations and tradeoffs in the last two columns are my design judgments. Vendor effectiveness claims, implementation timelines, ROI figures, and marketing rankings have deliberately not been used as ATB business-case assumptions. Public pages reviewed do not establish an ATB-specific total cost; obtain quotations covering configuration, interfaces, hosting, support, upgrades, and exit/data-export rights.

## Build versus buy decision

| Route | Appropriate when | Main obligation |
|---|---|---|
| Configure an established platform | Fast access to wider collections, restructuring, legal, and outsourced operations matters more than bespoke interface ownership. | Prove fit through scripted demos using ATB cases, validate model integration, and compare complete costs. |
| Build the focused application described below | ATB can maintain engineering, support, model governance, integration, security, and operational ownership. | Own financial consistency, contact controls, reliable jobs, access management, and incident response over the product's life. |
| Hybrid | ATB wants its own workflow and Prometeia logic while reusing the core, SMS gateway, dialer, identity provider, and reporting infrastructure. | Set explicit data ownership, integration contracts, and reconciliation. **This is the recommended design assumption.** |

## Prometeia evidence and issues to resolve

Source: supplied **ATB ERM Diagnostic Status Meeting 18062026-5.pdf**, 30 pages. The title page says **19.06.2026**, although the filename contains 18.06.2026. Relevant collection material is on PDF pages 4 and 7–23. Other ERM and SME sections are outside this application's initial scope.

| Topic | What the supplied deck supports | Implementation consequence |
|---|---|---|
| Customer-level approach | Monthly customer observations; priority combines probability and total exposure. | Group loans by customer and coordinate one contact strategy. |
| Early delinquency | 1–3 DPD generally favors self-cure; 4–10 DPD uses a decision tree; later early-arrears buckets use empirical roll rates. | Separate probability source from chosen treatment; do not force all customers into one model. |
| Model | Five final indicators; eight risk classes; published class probabilities 8%, 11%, 14%, 16%, 22%, 28%, 36%, 42%. | Import a versioned model and show path, inputs, timestamp, and provenance. |
| Outcome definition | Deterioration to over 30 DPD within the next month, with some slides using "30+" wording. | Confirm the exact event threshold and monthly observation convention; do not equate it to lifetime default PD. |
| Economic score | Expected Roll Amount = roll probability × total exposure. | Label ERA clearly. It is neither expected credit loss nor proven recoverable cash. |
| Treatments | ERA buckets 1–4 digital, 5–6 robo/digital, 7 selective calling, 8–9 agent calling, 10 senior-agent calling. | Store model classes 1–8 and action buckets 1–10 as different dimensions. |
| Contact rules | Successful contact gives a minimum five-day agent-call cooldown; failed calls have bucket-specific retries. | Enforce this on the server and at dispatch, across all of a customer's loans. |
| Operational baseline | Six early-arrears agents; illustrative capacity of 80 successful contacts per agent; no current IVR or email collections; outcome tracking in Excel. | Use SMS plus dialer-connected agent conversations; confirm current CTI capabilities. Capacity inputs are editable historical assumptions. |
| Feature dictionary | Variable descriptions are high level, with inconsistent spelling for one count feature. | Obtain exact transformations, denominators, observation dates, null handling, and mappings. |
| DPD boundary | 4–10 model segment overlaps a table labeled [10,17); other pages say 11–30. | Demo uses 4–10 and 11–16, then 17–23 and 24–30; require confirmation before production. |
| Coverage | Initial scope mentions 1–45 DPD; detailed action design largely covers 1–30. | Keep 31–45 DPD visible in a separately governed queue. Do not invent an approved extension. |
| Tree discrepancy | Page 11's Class 7 leaf contains a ratio label inconsistent with its incoming count split and page 10's rule table. | Treat the page 10 rules as a draft demo transcription; require a signed executable model artifact before activation. |
| Quantiles | A chart shows average ERA values by ten buckets, not exact bucket cutoffs. | Do not use chart averages as thresholds. Offer reproducible demo deciles and explicit production cutoffs. |
| Effectiveness | Channel uplifts are stated as assumptions. | Measure actual treatment impact; do not label observed collections or ERA as incremental profit. |

## Reference sources

All links below are primary vendor or technical sources. Descriptions above are paraphrased.

1. QUALCO QCR and Accelerator: https://www.qualco.tech/systems/qualco-collections-recoveries
2. Experian PowerCurve Collections: https://www.experian.co.uk/business/platforms/powercurve/collections
3. C&R Debt Manager: https://www.crsoftware.com/products/debt-manager
4. C&R ownership clarification: https://blog.crsoftware.com/cr-software-is-not-fico-debt-manager.-heres-what-changed-and-why-it-matters
5. CRIF Clever: https://www.crif.com/business/solutions/collection/clever/
6. CGI Credit Studio: https://www.cgi.com/us/en-us/solutions/credit-studio/collections
7. TurnKey Lender platform: https://www.turnkey-lender.com/lending-management-platform/
8. Microsoft PMT reference: https://support.microsoft.com/en-us/excel/functions/pmt-function
9. Next.js documentation: https://nextjs.org/docs
10. Prisma Decimal types: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types
11. decimal.js: https://mikemcl.github.io/decimal.js/
12. pg-boss: https://github.com/timgit/pg-boss

---

# Part B — MASTER PROMPT TO GIVE CLAUDE CODE

## 1. Your role, goal, and working method

Act as a banking collections product architect, experienced full-stack engineer, UX designer, and test engineer. Build **ATB Collections**, an internal web application for managing collections on existing unsecured consumer cash loans with fixed-rate monthly annuity repayments in Azerbaijan.

Use the specification below and the supplied Prometeia PDF. The goal is a working, maintainable application with real persistence, calculations, decision traces, queues, contact outcomes, promises, and integration adapters. Treat Prometeia as a business model provider; do not assume it exposes a public API.

First inspect the repository, package files, existing architecture, and any AGENTS.md instructions. Preserve working conventions. If there is no application, use the default stack below. Record choices in an architecture decision document. Do not ask for routine implementation choices; use clearly labeled demo assumptions for missing business inputs. Ask only when an unresolved issue prevents even a reversible demo.

Produce a short plan, screen/route inventory, domain diagram, and assumptions register, then implement the first working slice. Continue through the phases rather than stopping after planning or creating a UI shell. If context is limited, maintain BUILD_STATUS.md and continue from it. Do not describe an unimplemented feature as complete.

Use synthetic data only. Run the application locally; do not deploy, connect to ATB systems, send real messages, place calls, or change real loan balances. Provide replaceable adapters and clear deployment documentation. Real integrations and policy/model activation require separate bank-controlled configuration and approval inside the product.

## 2. Product scope and success criteria

Primary users: collection agents, senior collectors, team leads, collections head, CRO/risk analysts, model owners, compliance/QA reviewers, integration operators, and system administrators.

Initial product: AZN unsecured consumer cash loan; fixed nominal annual interest; monthly annuity; individual borrower. A customer may hold several loans. Existing core banking owns contracts, schedules, postings, allocations, authoritative balances, DPD, and loan closure. The application owns collection cases, decisions, tasks, contacts, PTPs, workflow approvals, and operational history.

Support the full display and handover lifecycle: pre-due → current → 1–3 → 4–10 → 11–16 → 17–23 → 24–30 → 31–45 → 46–60 → 61–90 → 91+ → legal/recovery → cured/closed. These are operational labels, not automatic NPL, IFRS 9 stage, legal, or regulatory classifications. Import those classifications separately when available.

The detailed Prometeia model applies only to the approved early-arrears population. Later stages need separately versioned policy. Implement their visibility, ownership, tasks, and handover; do not manufacture a calibrated model.

Success means an agent can become Ready, receive the next eligible customer automatically from the connected or simulated dialer, understand why that customer is prioritized, review all loans and arrears, record a verified contact, agree a PTP, see the customer suppressed from calls, ingest a payment, and see the PTP/queue/report update consistently.

Out of initial scope: application scoring, loan approval, disbursement, card lending, mortgages/collateral, general ledger, automated legal actions, debt sale, production collection bots, and autonomous AI decisions.

## 3. Delivery levels

- **P0 — runnable demo:** complete the core flow end to end with synthetic persistence and adapter simulators. Build S28 (automatic agent home/call/ACW) and screens S01–S09 and usable basic versions of S12–S14, S17–S18, S20–S25. Use drawers/tabs where separate pages would add complexity.
- **P1 — controlled pilot readiness:** finish maker/checker, detailed model validation, import reconciliation, integration operations, monitoring, exception workflows, hardship approvals, and handover. Complete S10–S11, S15–S16, S19, S26 and harden all P0 screens. Real integrations still need their own approved contracts/configuration.
- **P2 — expansion:** S27 borrower self-service; supported IVR/email; enhanced restructuring execution; additional provider capabilities beyond the required dialer/CTI integration in Part C; optional reviewed AI summaries and policy search.

Finish the P0 vertical slice before building the long tail of administration. Do not advertise P0 as production-ready.

## 4. Architecture

For a new repository use a modular monolith: Next.js App Router and TypeScript, Tailwind and accessible component primitives, PostgreSQL, Prisma with explicit Decimal fields, Zod API validation, TanStack Table for dense operational grids, and a separately runnable background worker. Use decimal.js or Prisma.Decimal for all financial arithmetic. Use pg-boss for durable scheduled work if it fits the existing infrastructure; do not add Redis/Kafka or microservices merely for this demo.

Pin supported stable dependencies at implementation time. Follow current official documentation. Separate modules: identity/access; customer/loan projections; collections/cases; schedules/simulation; decisions/models; contact policy; dialer/CTI; communication; PTPs; arrangements/approvals; analytics; ingestion/reconciliation; audit.

Business rules must live in testable server-side services, not React components. Routes and worker handlers must use the same services. Add an integration boundary around core banking, customer master, payment feed, SMS, dialer, identity provider, model scoring, and BI export. Use mock providers by default. Run web, worker, and PostgreSQL locally through a documented development setup; include Docker Compose if useful.

Use explicit DEMO and INTEGRATION modes. Demo role switching and synthetic payment injection must never be accessible in a production build. No secrets, confidential content, or external paid services are required to run the demo. No customer data may be sent to external LLMs.

## 5. UX direction and navigation

Create an original ATB-branded banking operations interface. Use ATB purple #6F0BBB, deep-purple navigation #34035D, yellow primary actions #F4C900 with dark-purple text, white/light-neutral work areas, and pale-lavender selections #F8F0FE. Use subtle separators, readable tables, compact information density and clear hierarchy. Use the official supplied atb logo unchanged. Do not copy competitor artwork. Prioritize the queue and collector workspace over decorative dashboards.

Desktop targets: 1440px and 1280px; support 1024px with collapsible navigation. Keep essential operations usable on a tablet. Customer self-service later must work on mobile. Use semantic controls, keyboard navigation, visible focus, accessible validation, status text alongside color, and readable contrast.

Shell: left navigation grouped as Work, Portfolio, Strategy, Management, Administration. Top bar: global customer/loan search; environment; business date; source-data freshness; notifications; role/profile. Display Asia/Baku dates/times and AZN. Default UI English, with translation dictionaries ready for Azerbaijani and Russian. Keep currency and date formatting centralized.

Use persistent table filters, server pagination/sorting, column choices, saved views, permission-aware exports, and drilldowns. Expose loading, empty, error, stale-data, read-only, and permission-denied states. Show explanations close to blocked actions. Keep raw integration details in operator screens rather than agent flows.

### 5.1 ATB visual theme - required across all screens

Apply the same tokens to management screens, tables, dialogs, charts and S28 agent Home/Live call/After-call states. Use the supplied ATB_Collections_Theme.css and original logo assets if attached. Source anchors were verified against ATB's public website stylesheet on 28 October 2026; this is an application theme, not an assertion of a formal brand-manual specification.

| Role | Hex / rule |
|---|---|
| Brand purple / links / secondary actions | #6F0BBB |
| Deep-purple navigation / primary-button text | #34035D |
| Primary action / active navigation marker | #F4C900 yellow |
| Primary-action hover | #E4BB00, a derived application shade |
| Selected row / selected tab / soft brand fill | #F8F0FE lavender |
| Panel / workspace | #FFFFFF / #F7F7F7 |
| Main / muted text | #251631 / #6B6277 |
| Border | #E4DDEC |
| Success / verified / Ready | #16794B on #EAF6EF |
| Warning / deferred / wrap-up | #92621D on #FFF3DC |
| Critical / destructive / hang up | #A43649 on #FBEBEF; filled destructive buttons use white text on #A43649 |
| Information | #336EAC on #EAF1F9 |

Purple #6F0BBB and yellow #F4C900 are the website UI anchors; #34035D and #F8F0FE also occur in its CSS. Other neutral/status values are operational design choices. The original website SVG logo uses #6F0BB5 internally: preserve its geometry and fill without recoloring it to match the UI token. Source: https://atb.az/media/ ; CSS: https://atb.az/wp-content/themes/atb-theme/assets/css/style.css ; logo: https://atb.az/wp-content/uploads/2023/01/logo.svg .

Yellow CTAs must use dark-purple text rather than white. Keep success/warning/critical semantics independent of brand accents, with text labels and accessible contrast. A highlighted table row uses lavender rather than implying payment success. Verify hover, focus, disabled, selected, error and active-call states. End-call and destructive actions retain red styling. Apply this theme consistently to all 28 screen specifications; it does not change business rules or dialer behavior.

## 6. Screen specifications

Treat the following as product requirements. Each screen must have a real route or a deliberate nested tab/drawer, defined data contracts, and permission rules. State which features are implemented in each phase.

### S01 — Sign-in and role landing | /login | P0

- Bank-branded sign-in with an OIDC/SSO adapter boundary; secure local demo authentication only when explicitly enabled.
- Demo users: agent, senior agent, lead, risk analyst, model maker, independent approver, integration operator, auditor, admin.
- Route agents to S28 /agent with automatic Ready/call/ACW states, leads to Operations, risk to Portfolio. Show session-expired and access-denied states.
- Enforce permissions on the server. A disabled menu is not authorization. Local demo accounts cannot bypass production login checks.

### S02 — Collections overview | /overview | P0

- Top row: date/cohort/team filters, business date, data freshness.
- KPI row: overdue customers; overdue amount; outstanding principal of overdue customers; customers callable now; today’s received payments; PTPs due today. Each opens its underlying filtered population.
- Middle: exposure/customer distribution by DPD band; call coverage versus available capacity; payment and cure trend with explicit period definitions.
- Bottom: highest-priority eligible customers, broken PTPs, stale-feed alerts, and unresolved contact/payment exceptions.
- Separate live operational metrics from fixed-cohort performance. Never sum balances repeatedly across multiple loans and cases.

### S03 — My prioritized work queue | /work-queue | P0

- Header: assigned tasks, eligible now, callbacks due, senior-only cases, capacity and last refresh.
- Filters: queue, DPD, action bucket, model class, ERA range, PTP state, contact eligibility, owner, language, branch, source freshness, policy version.
- Columns: rank; customer/CIF; number of loans; max eligible DPD; overdue amount; total model exposure; roll probability/source; ERA; action bucket; recommended/effective action; next contact time; last outcome; PTP; owner.
- Normal agent flow: S28 receives a dialer-assigned eligible customer automatically. Get next customer remains a controlled manual/supervisor fallback that atomically claims work. Clicking an authorized row opens S04 with queue context preserved.
- Secondary actions: start approved call flow, callback, reasoned return/reassign, permitted export. Bulk calling or sending is not a default action.
- Show why blocked: cooldown until date/time, active PTP, wrong number, dispute, stale payment data, unavailable channel, unapproved strategy, customer already claimed.

### S04 — Customer 360 collector workspace | /customers/:id | P0

- Sticky identity header: synthetic name/CIF, verified contacts, language, max DPD, case owner, source freshness, contact restrictions.
- Financial summary: overdue due now; principal outstanding; accrued but not overdue interest; last verified payment; next due date; loans count. Avoid a misleading single "debt" figure.
- Three working areas: left customer/loan list; center loan tabs and chronological timeline; right persistent action panel. Collapse sensibly on smaller screens.
- Tabs: Overview, Loans, Payments, Contacts, Promises, Documents, Support/Disputes, Decision history.
- Decision panel: "Why this customer?" with probability source, feature timestamp, model/strategy version, ERA, action bucket, chosen action, eligibility, and reason codes. Distinguish recommended from effective action.
- Actions: verify right party; record outcome; create PTP; schedule callback; send approved SMS; request support/restructure; raise dispute; request escalation. Re-check eligibility immediately before any outreach.
- Show all related cash loans together. A second loan cannot create a duplicate call during customer-level suppression.

### S05 — Loan detail and annuity schedule | /loans/:id | P0

- Contract header: loan/core ID, origination/maturity dates, initial principal, nominal annual rate, frequency, tenor, product, source schedule version, authoritative DPD/status.
- Balances: principal, overdue principal, accrued interest, overdue interest, approved fees/penalties, unapplied funds, total overdue. Prevent principal double counting.
- Schedule grid: installment number, due date, opening principal, principal due, interest due, fee/penalty due, total due, paid/allocated, remaining overdue, status, closing principal.
- Tabs: contractual schedule, payments/allocations, changes, simulation. Imported financial data is read-only.
- Simulation inputs: principal, rate, months, first due date, payment timing/calendar policy. Show calculation basis and compare against core schedule without overwriting it.
- Support partial/missed/late installments, early repayments, final adjustment, and revised imported schedules. Show "Quote unavailable—request from core" when an authoritative settlement quote is missing.

### S06 — Contact outcome and agent script | drawer from S03/S04 | P0

- Before call: freshness/eligibility check, verified number, correct-party verification, approved language/script.
- Capture attempt ID, provider reference, start/end, channel/direction, dialed contact, connectivity, identity verification, disposition, reason for nonpayment, note, next action, and optional PTP.
- Outcomes: no answer, busy, unreachable, wrong number, third-party answer, verified customer conversation, PTP, already paid claim, dispute, hardship/support need, refused to discuss, deceased/legal-notification referral.
- Connectivity, identity verification, and disposition are separate fields. Answered is not automatically RPC. "Already paid" is a claim until reconciled.
- Save outcome atomically records the interaction, calculates restrictions/retries, updates tasks, and appends audit history. Require mandatory outcome fields and provider wrap-up acknowledgment before confirmed Ready. The dialer can then allocate the next call automatically; the UI never independently initiates a duplicate dial.
- Wrong number disables that number; private loan data stays hidden during third-party contact. Edit/correct outcomes through audit-preserving corrections.

### S07 — Promise-to-pay register | /promises | P0

- Views: due today, upcoming, kept, partially paid, broken, awaiting reconciliation, cancelled.
- Columns: customer, promise amount, currency, covered loan(s), creation date, due date/time, verified qualifying payments, remaining promise, owner, state, suppression end.
- Create drawer: one active promise per defined covered obligation set; record agreed amount/date, scope, customer confirmation, reminder plan. An incoming partial payment cannot be counted twice across promises.
- Detail shows payment attribution, reversals, status events, previous promises, and future contact eligibility.
- No silent extension or overwritten history. Changes need a reason. A late feed gives Pending reconciliation rather than a premature Broken status.

### S08 — Callback and task calendar | /tasks | P0

- Day/week/list views by owner, priority, customer, task type, due time, and blocked state.
- Show callbacks, PTP follow-ups, dispute reviews, reconciliation requests, approval tasks, and late handovers.
- Create callback with local time and reason; enforce contact policy, including a valid policy-controlled response to customer-requested callbacks.
- Reassignment preserves the audit trail. Customer restrictions supersede drag/drop rescheduling. Prevent duplicate callback tasks across loans.

### S09 — Payments and reconciliation | /payments | P0

- Tabs: verified posted payments, unallocated/unmatched, pending settlement, reversals, source discrepancies, and demo simulator.
- Columns: source transaction ID, loan/customer, event/value/posting dates, amount, currency, status, allocation, import batch, reconciliation result.
- Drill into installment/principal/interest allocations and PTP attribution. Match deterministically by approved identifiers; fuzzy matches require review.
- Simulate a payment, duplicate event, reversal, late event, and already-paid claim in DEMO mode. Recompute customer task eligibility after verified balance refresh.
- Manual correction creates a reviewed reconciliation decision, not a fabricated core posting. Display source lag and unresolved mismatch prominently.

### S10 — Hardship and repayment support | /arrangements | P1

- Intake: customer reason, income/expenses, other commitments, disposable income, evidence, proposed affordable amount, support flags, reviewer.
- Compare current schedule with a proposed arrangement or restructuring simulation. Show monthly payment, tenor, total payable, and assumptions; do not capitalize arrears silently.
- Distinguish temporary PTP/collection arrangement from a contractual restructure. Routes: draft → submitted → reviewed → approved/rejected → sent to core → core confirmed → active/failed.
- Bank product limits and approval authority are configuration. Core confirms the new contract/schedule before the app treats it as effective.
- Limit sensitive support details to authorized users. Never use vulnerability alone to intensify collection pressure.

### S11 — Approvals inbox | /approvals | P1

- Items: policy/model activation, manual financial reconciliation, waiver/restructure requests, restriction overrides, and controlled exports.
- Compare before/after values, rationale, impact population, evidence, validation results, maker, checker, proposed effective date, and rollback target.
- Approve/reject/request information. Block self-approval and authority-limit breaches. Role switching in a demo cannot circumvent the two-person rule.
- Version activation is transactional; preserve decisions under previous versions. Include a dedicated model/policy rollback workflow.

### S12 — Strategy designer | /strategies | P0 basic / P1 complete

- Left: versioned strategy list and status Draft/Tested/Approved/Active/Retired. Center: editable decision tables. Right: customer-level simulation and explanation.
- Configure population, DPD bands, model source, exposure definition, action bucket method, channels, retry/cooldown rules, capacity, fallback, and exception routes.
- Screen sections: eligibility → probability → exposure/ERA → action bucket → treatment → contact controls → capacity → dispatch. Do not let an action bypass restrictions.
- Validate no overlaps/gaps, valid probabilities, deterministic precedence, missing-input handling, and disabled channels. No arbitrary code execution from uploaded rules.
- Run a dry simulation: counts by treatment; unscored cases; blocked contacts; workload; score changes; channel costs; distribution differences versus active policy. Publish only via S11.

### S13 — Prometeia model and feature mapping | /models/prometeia | P0 basic / P1 complete

- Register: provider, model ID/version/checksum, owner, source, status, observation frequency, target population, target event/horizon, approval and validity dates.
- Import validated JSON/CSV rule package, map source columns to canonical feature names, inspect units/transforms/null rules, preview sample scores, and compare versions.
- Display the eight-leaf draft rule table below and a readable tree; do not infer model logic from OCR alone.
- Test case panel shows features, as-of date, decision path, class, probability, ERA, chosen action, and reason codes.
- Prominent unresolved-issues panel for the source conflicts. Missing or stale features produce Unscored and a manual queue, not an invented low probability.

### S14 — Action economics and capacity | /strategy/economics | P0

- Editable dated channel unit costs and conservative/base/upside uplift assumptions. Label units as per SMS, per IVR attempt, or per customer-day.
- Show break-even ERA, assumed benefit, net scenario benefit, eligible population, available agents/skills/shifts, attempts versus distinct customers versus successful contacts.
- Capacity controls: seniors/regulars, working hours, callbacks, expected RPC, handling time, reserve capacity, retry demand, and risk priority cut.
- Default capability: SMS enabled, structured calls enabled, IVR/email disabled. Explain fallback impact; unavailable IVR cannot automatically turn every digital case into an agent call.
- Compare scenarios without activating them. Never present assumed uplift as measured causal benefit.

### S15 — Campaign manager | /campaigns | P1

- Build SMS campaigns from approved strategy populations; inspect audience, exclusions, amount freshness, template version, language, deduplication, cost estimate, schedule, and approver.
- States: draft, reviewed, scheduled, running, paused, completed, failed. Preview a sample and exclusion reasons before release.
- Dispatch re-checks balance and contact policy, not just campaign creation time. Track sent/delivered/failed/unknown separately and handle opt-out or other restrictions under approved rules.
- Demo Send writes to a local outbound log only. Add pause/cancel before remaining messages are dispatched.

### S16 — Templates and scripts | /templates | P1

- Versioned AZ/EN/RU SMS templates, agent scripts, PTP reminders, support scripts, and later email/IVR.
- Allowed variables are schema-validated. Preview with synthetic customers; show message length/encoding and estimate segment count under the configured provider rules.
- Four-eye approval, effective dates, restricted sensitive content, channel scope, and fallback language. No real credentials, calls, or messages in demo.

### S17 — Team allocation and operations | /operations | P0

- Team grid: agent role/skills/language, shift/status, assigned unique customers, due callbacks, attempts, RPC, PTP, received cash attribution, and backlog.
- Allocate according to eligibility, seniority, language, shift, ownership, and capacity. Preserve customer grouping across loans and avoid duplicate claims.
- Actions: simulate/rebalance workload, assign/reassign, pause outbound work, inspect queue coverage and overflow. Reassignment requires reason for active cases.
- Compare productivity with case mix and exposure context; do not reward duplicate attempts or count the same payment for multiple agents.

### S18 — Portfolio and collection analytics | /analytics | P0 basic / P1 complete

- Tabs: DPD distribution, roll/cure matrices, fixed-entry cohorts, cash collected, PTP, RPC/contact outcomes, cost, action buckets, model classes, strategies, agent/team, vintage.
- Filters: snapshot/entry dates, product, branch, DPD, owner, risk class, action bucket, strategy version and campaign/experiment arm.
- Show counts and exposure measures separately; define numerator, denominator, maturation window, data freshness and scope on every ratio.
- Drill from a metric to customers and source events; export with an as-of timestamp and definition version. Do not call unadjusted comparisons treatment uplift.

### S19 — Model monitoring and validation | /model-monitoring | P1

- Population coverage, missing/stale inputs, unscored rate, class distribution, observed roll rates versus assigned probabilities, ranking performance, drift, and overrides.
- Preserve monthly target construction and matured observation windows. Prevent leakage from future data. Separate development, OOT, and live periods.
- Support GINI/AUC and calibration when valid labeled observations exist; show unavailable/insufficient sample rather than fake statistics.
- Historical deck values (36.6% train GINI, 40.4% OOT GINI) belong in model documentation, not the live-results panel. Show model/feature/policy versions with each result.

### S20 — Imports and data quality | /data/imports | P0

- Wizard: choose file/source → map columns → validate → dry-run → inspect/reconcile → commit → results.
- Datasets: customers, contacts/preferences, loans, schedule versions/installments, payments/allocations/reversals, arrears snapshots, model features, optional externally supplied scores.
- Display counts, amount totals by currency, duplicates, missing references, invalid dates, quarantined rows, schema/model mismatch, and source as-of date.
- Batch IDs and deterministic duplicate protection are mandatory. Invalid critical financial rows cannot silently enter the active projection. Show rollback/recovery behavior; imported history is retained.
- Supply downloadable synthetic CSV/JSON examples and human-readable error files. Guard exported cells against spreadsheet formula injection.

### S21 — Integrations and job health | /integrations | P0

- Source cards: core, customer master, payment feed, SMS, dialer, identity, Prometeia score/feature import, BI export.
- Show mode, last successful run, source watermark, lag, queue depth, errors, retry/dead-letter count, schema version, and reconciliation differences.
- Actions: test mock connection, dry-run, pause/resume, controlled replay, examine quarantined records, rotate secret reference through the chosen secret store.
- No raw credentials or unrestricted PII in logs. Replaying jobs cannot resend a message or double-apply a payment.

### S22 — Exception workbench | /exceptions | P0 basic / P1 complete

- Types: claimed already paid, unmatched/reversed payment, stale balances/features, missing model input, wrong number, duplicate CIF, dispute, expired policy/model, source mismatch, handover failure.
- Severity, customer, first/last seen, owner, SLA, evidence, affected outreach, resolution status.
- Actions: assign, request source refresh, inspect lineage, resolve with reason, and reopen. No unrecorded override of a contact block.
- Block only affected activity where possible; keep unscored customers visible in an owned manual-review queue.

### S23 — Audit and contact-control review | /audit | P0 basic / P1 complete

- Immutable chronological audit events with actor/service, time, customer/case, action, reason, changed fields, decision/version IDs, source/event/correlation IDs.
- Reviewer views: blocked actions, attempted overrides, customer-level frequency history, complaint/dispute handling, data exports, configuration/model promotions, and access changes.
- Explain "why contacted / why not contacted" at historical as-of dates. Normal admins cannot edit audit events or approve themselves.
- Restrict data access; audit sensitive views and exports. Export is scoped and recorded.

### S24 — Product and policy settings | /settings | P0

- Configure cash-loan product metadata, nominal-rate display, rounding, schedule simulation, business-day/calendar conventions, demo allocation policy, DPD tolerance, and currency.
- Contact-policy section: cooldowns, quiet hours, holidays, day/week/channel limits, PTP restrictions, support/dispute rules, legal flags, and source-freshness thresholds.
- Mark each parameter as Source-based, Demo assumption, or Bank-approved, with owner/version/effective date. Do not label assumed limits as Azerbaijani legal requirements.
- Separate clocks: business date for portfolio calculations and actual clock for dispatch restrictions. Historical simulation cannot authorize real outreach.

### S25 — Users, roles, and organizational access | /admin/users | P0

- Users, teams, roles, skills, language, branch/portfolio scopes, active status, identity mapping, and session controls.
- Define permissions for record access, contact, PTP, imports, reassignment, policy/model drafting, independent approval, audit, exports, and administration.
- No admin self-escalation into model approval or audit rewriting. Service accounts have narrowly scoped permissions.
- Include a permission matrix and automated API-level access tests.

### S26 — Late collection and legal handover | /recovery | P1

- Dedicated queues for 31–45 and later delinquency with explicit policy coverage and owners; no borrowed early model score.
- Case packet: verified loan balances/schedules, payment history, contact/notice evidence, active disputes/support/PTPs, documents, approvals, owner, deadline and receipt acknowledgment.
- Actions: request review, approve transfer, export packet, record receiving-team acceptance, return for corrections. Avoid automatic litigation or statutory notices.
- Customer-level ownership and contact restrictions persist during handover. A legal label is not generated merely because DPD crossed a number.

### S27 — Borrower self-service | /self-service | P2

- Secure bank-approved identity; mobile balance/overdue explanation; contractual schedule; approved payment link; PTP request; support request; complaint/contact preference update.
- Display payment status as pending until verified; a browser redirect is not proof of payment. No staff notes, risk class, ERA, or internal scores are visible to borrowers.
- Use a replaceable payment provider interface; do not collect card details in this application. Keep this module outside the P0 critical path.

## 7. Loan mathematics and financial data rules

### 7.1 Sources of truth

Imported core contract/schedule/balance/payment allocations are authoritative. Keep source values, source timestamps, and schedule versions. The local annuity engine is a demo generator and comparison/simulation tool. A local schedule mismatch becomes a reconciliation exception; it does not overwrite the core or change the customer's obligation.

Distinguish: original principal; outstanding principal; scheduled installment; overdue principal; overdue interest; current accrued interest; contractual fees/penalties; unapplied funds; overdue due now; settlement quote. Outstanding principal already includes overdue principal. Never add overdue principal to it again.

### 7.2 Regular monthly annuity

For equal monthly periods, fixed nominal annual rate j, end-of-period payments, principal P, and n installments:

`r = j / 12`

`A = P × r / (1 - (1 + r)^(-n))`

If r = 0, `A = P / n`. For period t: interest = opening principal × r; principal repayment = installment − interest; closing principal = opening principal − principal repayment. This simple formula does not represent irregular first periods, a daily-accrual contract, changing rates, insurance, or fees. Those require their explicit configured/core rules.

Use decimal arithmetic throughout; persist money as fixed-scale decimal or agreed minor-unit integers, never binary floating-point. Keep calculation precision separate from display rounding. Demo default: AZN cents, half-up rounding per installment/interest component; final installment is adjusted to clear the remaining principal exactly. Explain rounding and residuals. Validate positive principal, valid tenor/rate, and no unintended negative amortization.

Reference fixture: **P=10,000 AZN, j=18% nominal, n=24, monthly regular periods, no fees**. Unrounded A ≈ 499.2410196950872; display A=499.24. First interest 150.00; first principal 349.24; closing principal 9,650.76. Compute the remaining schedule and adjust the last payment. A zero-rate 1,200/12 fixture has 100.00 payments.

Nominal annual rate, effective annual rate, and fee-inclusive disclosed borrowing cost are separate. Do not label nominal rate as APR/EIR. A compliance disclosure calculation requires the bank-approved cash-flow methodology.

### 7.3 Dates, DPD, partial payments

- Use ISO local business dates for contractual due dates; store event timestamps in UTC and show Asia/Baku. Avoid UTC conversion changing an installment date.
- Demo DPD is calendar days from the oldest installment with a strictly overdue unpaid eligible balance above the configured tolerance. An installment due today has DPD 0; tomorrow it has DPD 1 if still unpaid. Core DPD remains authoritative in integration mode.
- Configure, version, and show due-date adjustment policy and holiday calendar. Keep contractual date, adjusted date, and actual payment date distinct. Do not shift dates silently.
- Partial payment does not cure the oldest installment until its remaining eligible due is satisfied. An old residual keeps DPD anchored to that installment, subject to an explicitly approved tolerance. Do not use the last-payment date as DPD.
- Payment allocation is contract/bank-defined. Demo-only example: oldest due installment first, then interest then principal, with no penalty/fee creation. Store the actual policy and allocation events. Production uses imported core allocations.
- Overpayments remain unapplied or are allocated by explicit core/product policy; do not invent automatic prepayment. Prepayment, payoff, and restructuring quotes come from core or are clearly labeled simulations.
- Handle same-day multiple payments, value/posting-date differences, duplicate events, reversals, refunds, late events, revised schedules, and loans paid off while tasks remain queued.
- A payment reversal can reopen arrears/PTP/case eligibility; it cannot erase prior history. Backdated events restate affected derived views with traceable processing times.
- Fees, penalty rates, penalty caps, grace periods, and capitalization are disabled/unset until supplied. No generic country assumption becomes a contractual charge.

## 8. Prometeia decision module

### 8.1 Separate objects and terminology

Keep separate: loan DPD; customer decision DPD; eight model risk classes; ten economic action buckets; probability of the specified roll event; ERA; recommended treatment; effective treatment; contact eligibility; queue rank. Do not reuse one "risk bucket" column for them all.

`ERA = P(defined roll event within defined horizon) × exposure under the model's approved definition`.

ERA is a risk-ranking amount. It has no LGD factor and is not IFRS 9 ECL, expected cash recovery, or incremental treatment benefit. Store exposure definition, population scope, and snapshot time. Do not add each loan's score when the calibrated model is customer-level.

Demo exposure: sum eligible active cash-loan principal outstanding once per customer, including principal on eligible current loans, with max DPD across eligible loans. Mark this assumption prominently; exact production exposure, performing-loan inclusion, accrued-interest treatment, and customer aggregation must match the approved model dictionary. Never aggregate across currencies without an approved dated FX policy.

### 8.2 Segment coverage

| Customer decision DPD | Probability source | Required behavior |
|---|---|---|
| 0 | No early-arrears score required | Optional approved pre-due/current reminders only. |
| 1–3 | Proposed max-DPD-in-last-three-months rule | Exact mapping is absent. Allow imported approved mapping. A demo-only placeholder must be tagged and cannot be activated for production. Default operational emphasis is self-cure/digital contact. |
| 4–10 | Eight-class tree below | Validate population, feature dates, and coverage; score only supported cases. |
| 11–16 | Draft empirical roll rate 19.8% | Boundary resolution is a demo assumption pending confirmation. |
| 17–23 | Draft empirical roll rate 26.9% | Preserve source/version. |
| 24–30 | Draft empirical roll rate 33.7% | Preserve source/version; clarify the exact target threshold. |
| 31–45 and later | No approved probability in supplied detailed design | Owned later-stage queue or bank-supplied policy; no invented calibrated probability. |

Do not use aggregate observed 1–3 DPD roll rate as an approved universal individual rule. If a synthetic demo needs numeric 1–3 probabilities, put them in a clearly named DEMO_ONLY policy file with probability provenance and no production activation path.

### 8.3 Draft transcription of page 10 model

Canonical feature names:

- `DPD_MAX_MAX12`: maximum observed DPD in the prior 12-month window, per the model's exact definition.
- `DPD_RATIO_ADJ_MAX12`: maximum adjusted delinquent exposure ratio over the required window.
- `DPD_RATIO_ADJ_V3LM`: the specified change versus the previous three-month maximum.
- `DPD30_ADJ100_CNT_L6M`: count of defined 30+ occurrences in six months. The PDF also writes `DPD_30_ADJ100_CNT_L6M`; require an explicit alias mapping.
- `DPD_RATIO_ADJ_VLM`: latest specified adjusted delinquency ratio.

Do not guess what ADJ/100, ratio denominators, zero balances, or month windows mean. Accept provider-computed features in the first version. Daily operational scoring may reuse only the approved latest complete monthly feature snapshot under the model policy; do not silently rebuild the model from daily values.

Draft mutually exclusive branches, for demo and validation only:

| Class | Probability | Rule |
|---|---:|---|
| 1 | 0.08 | `DPD_MAX_MAX12 <= 7 AND DPD_RATIO_ADJ_MAX12 > 0.025` |
| 2 | 0.11 | `7 < DPD_MAX_MAX12 <= 30 AND DPD_RATIO_ADJ_MAX12 > 0.03` |
| 3 | 0.14 | `DPD_MAX_MAX12 <= 30 AND DPD_RATIO_ADJ_MAX12 <= 0.025` |
| 4 | 0.16 | `7 < DPD_MAX_MAX12 <= 30 AND 0.025 < DPD_RATIO_ADJ_MAX12 <= 0.03` |
| 5 | 0.22 | `DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM > -0.4 AND DPD30_ADJ100_CNT_L6M <= 1 AND DPD_RATIO_ADJ_VLM <= 0.2` |
| 6 | 0.28 | `DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM > -0.4 AND DPD30_ADJ100_CNT_L6M <= 1 AND DPD_RATIO_ADJ_VLM > 0.2` |
| 7 | 0.36 | `DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM > -0.4 AND DPD30_ADJ100_CNT_L6M > 1` |
| 8 | 0.42 | `DPD_MAX_MAX12 > 30 AND DPD_RATIO_ADJ_V3LM <= -0.4` |

Page 11 contains a conflicting Class 7 leaf label and rounded empirical leaf values. Use the page 10 rule-table probabilities for this DRAFT implementation, not a silent mix. Model approval requires provider confirmation or a signed executable rule artifact with golden test cases. Preserve the deck/date as source metadata rather than presenting it as current approval.

Missing required path inputs, invalid values, expired model, unsupported population, stale features, or an unmapped alias must produce an explicit Unscored state, reason codes, and a manual-review route. Null is not zero. Build a safe typed rule interpreter; never evaluate arbitrary imported JavaScript.

### 8.4 Economic action buckets

The eight model classes do not map directly to ten treatment buckets. Compute ERA first and then apply a separately approved monetary-threshold or percentile policy across the common eligible portfolio.

Demo default: ten ascending snapshot ERA groups, bucket 1 lowest and bucket 10 highest. Rank customers once at daily snapshot creation. Record population, cutoff values, score timestamp, tie handling, and policy version. Keep identical ERA ties in the same bucket even if group sizes differ; document behavior for fewer than ten distinct values. Chart averages in the deck are not boundaries. Intraday payment/contact updates invalidate tasks immediately; rescore or rebucket only under the documented refresh policy to avoid unexplained churn.

| Action bucket | Source design | Effective Phase 1 behavior |
|---|---|---|
| 1–4 | Low intensity SMS/email; no agent call | Approved SMS and self-cure monitoring; no routine call. |
| 5–6 | Robo call plus supporting SMS/email; no agent call | SMS fallback because IVR/email are unavailable; show unavailable-channel reason. |
| 7 | Robo/SMS and selective call if capacity remains | SMS; agent only after higher-priority eligible work and within approved policy/capacity. |
| 8 | Regular agent call; supporting SMS/email | Regular agent task, subject to eligibility. |
| 9 | Higher-priority regular agent call | Regular agent priority, subject to eligibility. |
| 10 | Senior agent priority | Senior queue, subject to eligibility; flag senior-capacity overflow rather than silently downgrading. |

Keep self-cure preference for 1–3 DPD separately configurable; do not turn it into a blanket production ban or blanket calling rule without policy confirmation. High exposure can change economic priority. Cross-band scores are compared on common units; 11+ DPD does not automatically outrank every 4–10 DPD customer.

### 8.5 Costs, uplift assumptions, and capacity

Initial draft source assumptions: SMS 0.031 AZN/message; future IVR 0.20 AZN/attempt; manual follow-up 1.75 AZN/customer-day. Source scenario uplifts: SMS 0.1% / 0.3% / 0.5%; IVR 0.5% / 1.0% / 2.5%; agent 2.5% / 5.0% / 7.5%.

`breakEvenERA = actionUnitCost / assumedRelativeUplift`.

Calculate exact values; do not hard-code chart rounding. Base examples: SMS ≈10.3333 AZN; IVR 20 AZN; agent 35 AZN. Uplift must be positive to evaluate this expression. Compare alternatives using consistent units and document whether effects are incremental or overlapping. Do not sum SMS and call benefits as though independently additive without evidence.

Treat ERA × assumed uplift as scenario benefit in risk-amount units, not guaranteed AZN profit. Actual recovery impact and economic benefit require measured outcomes and an approved valuation method.

Source capacity is **6 agents × 80 successful contacts = 480 successful contacts/day**, not 480 attempts. Other source slides report approximately 219 daily attempts, 107 worked customers, and 82 reached customers per agent. These historical values are inputs to validate, not fixed targets. Keep attempts, distinct customer-days, RPC and contact rate separate. Higher failed-contact demand consumes capacity.

Queue selection order: restrictions → due callbacks/authorized follow-ups → eligible priority and skill → capacity → atomic claim. Preserve common ERA rank while showing operational overrides and reasons. Define stable tiebreakers (for example ERA descending, oldest overdue due date, customer ID) and record them.

## 9. Contact controls and workflow state

Implement one server-side contact-policy evaluator used at queue creation, task claim, manual action, campaign dispatch, and dialer integration. A UI button cannot bypass it. It returns eligible/blocked, reason codes, next allowed time, and policy version.

Precedence: paid/cured/closed loan and refreshed balances; stale critical payment/financial data; identity/contact validity; dispute/legal/support restrictions; customer-level frequency and time restrictions; verified-contact cooldown; active PTP policy; retry timing; capacity/skill. Where two restrictions apply, use the later permitted time and stronger restriction. Record why work was deferred. Bank-specific legal restrictions remain configuration pending approval.

After a verified right-party successful conversation, suppress unsolicited agent calls for **at least five full days** under a versioned policy. Demo interpretation: 120 hours from the interaction timestamp. The source does not settle calendar-day counting; list that as a production clarification. An answered call or third-party conversation does not automatically qualify. An earlier discretionary callback cannot bypass suppression unless a narrowly defined, evidenced customer-requested exception is approved under policy.

Active PTP protection is proposed in addition to the source cooldown. Demo: no routine calls until the later of the cooldown end and the promise deadline plus settlement allowance. Keep overdue broken promises visible even when temporarily blocked. Digital reminders follow separate limits; cooldown never means unlimited SMS.

Unsuccessful-call source rules:

- Bucket 9–10: retry at a different time on the same day, then next day.
- Bucket 8: retry after 1–2 days.
- Bucket 7: retry after 2–3 days and only with spare capacity.
- Buckets 1–6: no routine agent call.

Exact failed-call spacing and day/week caps are not given. Demo values must be labeled, editable, and server-enforced. Never schedule past an applicable quiet-hour/holiday/contact restriction. Wrong number blocks the contact; unreachable/busy/no answer do not reset successful-contact cooldown. Record customer-requested time/language preferences.

Task states: queued → eligible/deferred → claimed → in progress → completed/cancelled/expired. Use unique active task keys and leases/optimistic locking to prevent two agents claiming the same customer action. On an authorized payment event, refresh financial status, cancel or defer obsolete tasks, update PTP/reports, and record history. Partial payment may reduce the required amount without curing the case. A verified conversation logged on one loan affects the customer's other loans too.

PTP states: active → kept/partially paid/broken/cancelled; add pending reconciliation when source finality is unknown. Define qualifying payment window, event/value-date policy, amount tolerance, covered loans, settlement lag, and reversal behavior. Demo counts verified covered payments from creation through deadline under an explicit policy; prior unrelated cash cannot satisfy a new promise. Never count one monetary allocation twice.

## 10. Data model

Design relational entities with migrations and indexes, including:

| Entity | Essential fields / relationships |
|---|---|
| Customer | Internal ID, core CIF, synthetic identity, branch, language, status; canonical identifier mapping. |
| ContactPoint / Preference | Customer, type/value, verification/validity, restriction, source and as-of dates. |
| Loan / LoanSnapshot | Core ID, customer, product, dates, rate/terms, source schedule ID, balances, DPD, source timestamp/version; immutable historical snapshots. |
| ScheduleVersion / Installment | Loan, version/effective date; due dates and component amounts; imported versus simulation provenance. |
| Payment / Allocation / Reversal | Source event/transaction ID, loan/customer, amount/currency, event/value/posting times, status, allocation, reversal reference. |
| CollectionCase / Episode | Customer, portfolio, entry/exit dates, owner/status, linked loans, cure/handover reasons. |
| ModelVersion / FeatureSnapshot / Score | Definitions, approvals, checksum, source; features with observation/as-of dates; class/probability, trace, quality flags. |
| StrategyVersion / DecisionSnapshot | Population and policy configuration; DPD/exposure/ERA, model/action buckets, treatment, restrictions, rank, reasons, all version IDs. |
| WorkItem / Assignment | Customer/case, type, next eligible time, priority, owner/skill, status, lease, unique action key. |
| Interaction / OutcomeCorrection | Customer, optional loan, contact, channel/direction, connectivity, RPC verification, outcome, timestamps, source, amendment trail. |
| Promise / PromisePaymentLink | Customer, covered loans/obligations, amount/deadline, confirmation, rules/version, status and payment allocation references. |
| SupportCase / Dispute / Arrangement | Restricted details, reason, documents, state, proposed terms, reviewer, core confirmation. |
| Approval / ConfigurationChange | Maker/checker, change payload, before/after, authority, evidence, effective version, decision history. |
| Template / Campaign / OutboundMessage | Versioned text/variables/language, target snapshot, exclusions, provider reference, delivery lifecycle and unique deduplication key. |
| Agent / Team / Role / Permission | Identity mapping, organizational/record scope, skills/language, shift, explicit permissions. |
| ImportBatch / SourceWatermark / DataIssue | Schema, checksum, counts/control totals, source as-of date, row errors, reconciliation/processing status. |
| IntegrationEvent / Outbox / Job | Idempotency key, source/correlation/version, status, retries, next attempt, dead-letter details. |
| AuditEvent / MetricDefinition / ExperimentAssignment | Immutable actions, definition/versioned denominators, stable customer-level strategy assignment. |

Use precise decimal types for money/probability, explicit currency, and validated enum states. Add unique source-system IDs, foreign keys, source lineage, created/updated timestamps, and row versioning. Never delete historic financial/decision data to "fix" a demo. Apply retention and deletion through explicit bank policy with audit/legal-hold considerations.

## 11. Integration contracts and operational resilience

The following are proposed **application contracts**, not claims about real ATB or Prometeia endpoints. Implement versioned adapters with synthetic fixtures and document mappings needed from the bank.

- Inbound: customer/contact master; core loan/schedule/balance snapshots; payment/allocations/reversals; model features or signed probability outputs; identity and team mapping.
- Outbound: authorized task list to dialer; approved SMS requests; collection outcomes and reporting export; approved restructure requests to core; later self-service/payment requests.
- Support both validated CSV/JSON/SFTP-style batch boundaries and REST/event boundaries. Choose the actual transport only after source contracts are known.
- Idempotency: unique `(sourceSystem, sourceEventId, eventType)` plus version/sequence handling as required; payment business references provide an additional duplicate check. Message dispatch has a separate stable key and provider-reference reconciliation.
- Preserve occurredAt, receivedAt, effective/value date, schemaVersion, entity/source version, and correlationId. Reject or reconcile stale/out-of-order updates rather than overwriting newer financial state.
- In one database transaction, persist accepted state changes and an outbox record. A worker processes downstream effects with retries. Assume at-least-once delivery; idempotent handlers and reconciliation provide business correctness.
- Bounded retries with backoff, dead-letter visibility, controlled replay, import control totals, and observable failures. A provider timeout is Unknown until reconciled; do not blindly resend a possible SMS/call/payment request.
- Critical balance/payment freshness thresholds block automated amount-specific outreach for affected customers until refreshed. Maintain a documented degraded manual-review mode. A stale feed cannot silently label a payer delinquent.
- Reconcile daily counts and totals by source/currency; establish payment, loan, schedule, and customer-reference completeness checks. Record mismatch resolution without altering source facts.

Example application event:

```json
{
  "schemaVersion": "1.0",
  "eventId": "demo-event-000001",
  "eventType": "payment.posted",
  "sourceSystem": "CORE_DEMO",
  "sourceEventId": "demo-txn-001",
  "sourceVersion": "1",
  "occurredAt": "2026-10-27T07:00:00Z",
  "receivedAt": "2026-10-27T07:00:02Z",
  "businessDate": "2026-10-27",
  "customerId": "C-DEMO-001",
  "loanId": "L-DEMO-001",
  "payload": {
    "amount": "250.00",
    "currency": "AZN",
    "valueDate": "2026-10-27",
    "status": "POSTED"
  }
}
```

Suggested REST routes: GET customers/search; GET customer/:id; GET loans/:id/schedule; GET work-items; POST work-items/claim-next; POST interactions; POST promises; GET promises; POST imports/validate and /commit; POST integration-events; POST strategies/simulate; POST approval-requests; POST approval decisions; GET analytics; GET audit. Validate object-level permissions and use idempotency keys/concurrency guards on mutations. Define OpenAPI or equivalent typed contracts.

## 12. Reporting definitions and experiment design

Implement a metric dictionary and show its version/as-of date:

- **Attempts:** recorded outbound attempts. Deduplicate provider callbacks for the same attempt.
- **Distinct customers attempted:** unique customers with at least one qualifying attempt in the defined period; customer-days are a different unit.
- **RPC rate:** verified right-party conversations / qualifying attempts for a clearly identified attempt-based metric. Also offer distinct-customer RPC with its own denominator. Do not mix both.
- **Coverage:** distinct eligible customers worked / distinct eligible customers assigned in the defined snapshot or cohort; disclose exclusions.
- **PTP conversion:** promises obtained / verified eligible conversations under the defined period/cohort.
- **Kept PTP rate:** kept promises / matured eligible promises, excluding not-yet-due and showing pending reconciliation separately. Display amounts and counts.
- **Cure:** fixed entry cohort returning to defined performing/zero-overdue status within an observation window; report count and entry-exposure weighted versions. Cure does not close the loan contract.
- **Roll-forward:** fixed entry cohort crossing the specified threshold within the defined horizon. Use entry exposure for exposure-weighted rates; show matured/immature observations separately.
- **Cash received:** verified settled/posted qualifying inflows net of reversals under the displayed posting/value-date convention, scope and currency; no inferred amounts from PTPs or paid claims.
- **Agent-attributed cash:** report the documented attribution rule once per allocation; keep it separate from causal incremental impact and bank total cash.
- **Cost:** distinguish SMS units, IVR attempts and agent customer-days. Report actual cost where available and scenario cost where assumed.

For later champion/challenger trials, randomize consistently at customer level, preserve assignment across loans, predefine eligible population and outcomes, retain holdouts, and prevent simultaneous conflicting treatments. Observational before/after differences are not automatically causal uplift. Avoid experimental escalation for protected/special-handling populations without approved policy.

## 13. Security, audit, and operational controls

Implement authenticated server-side access, least privilege, object/portfolio scopes, maker/checker separation, secure sessions/cookies, input validation, protection for state-changing requests, rate limiting where appropriate, safe document handling, and bounded pagination/exports. Mask contacts/identity where the role does not need them. No PII or secrets in telemetry, URL query strings, or client debug logs.

Use TLS for integrations, secret references rather than hardcoded credentials, encrypted managed storage/database as deployment requirements, backup/restore instructions, health checks, dependency locking, and auditable administrative changes. Do not claim any certification or compliance automatically.

Audit events are append-only through normal application permissions. Corrections add new events. Log policy/model version, reason, actor and source for decisions and overrides. Add production guidance for tamper resistance, retention, SIEM export, incident ownership, recovery targets, and restore testing; values must be set by ATB.

Provide a kill switch for outbound execution and pause controls by campaign/channel. Emergency restriction changes may pause work immediately through an authorized action; resuming uses the approved active policy. Feature flags for real connectors and future AI default off.

## 14. Synthetic dataset and demonstration

Seed a reproducible demo business date of **27 October 2026** in Asia/Baku, with an explicit clock abstraction. Generate at least 250 synthetic customers, approximately 300–400 cash loans, sufficient prior monthly feature/history data, mixed delinquency stages, and deterministic expected outcomes. Names and identifiers must be clearly synthetic. Never reuse actual customer information from source documents.

Include examples for all eight model leaves; all ten action buckets where distinct scores permit; multiple loans per customer; 1–3 self-cure; high-ERA 4–10 outranking low-ERA later arrears; verified contact cooldown; failed-call retry; wrong number; third-party answer; active/broken/partially met PTP; late payment feed; duplicate payment; reversal; early repayment; schedule mismatch; missing/stale model features; 31–45 unmodeled queue; hardship; dispute; unapproved policy; and senior-capacity overflow.

Seed dates, source snapshots, score inputs and financial amounts consistently. No charts with unrelated hardcoded numbers. Provide DEMO_SCENARIOS.md explaining a five-minute walkthrough: open agent desktop → confirm Ready → receive automatic assignment and customer screen pop → inspect why prioritized → view annuity schedule → record RPC and PTP → verify suppression → inject verified payment → verify PTP/queue/metrics → replay event to prove no duplication.

## 15. Tests and acceptance scenarios

Use unit tests for financial/decision/contact logic, integration tests for transactions/idempotency/access, and browser tests for the critical flow. Do not replace behavior tests with snapshots of implementation details.

Acceptance cases:

1. The 10,000/18%/24 annuity fixture matches the reference first payment/split; principal amortizes exactly with a disclosed final adjustment. Zero-rate fixture works.
2. Due today is DPD 0; tomorrow is 1 when unpaid. Partial payment leaves the oldest installment and correct DPD until satisfied under policy. Asia/Baku midnight does not create date errors.
3. Imported core schedule is unchanged by simulation. Mismatches create traceable exceptions. No fees or penalties appear without configuration.
4. Tests reach all eight tree classes and verify boundaries at 7, 30, 0.025, 0.03, -0.4, 1, and 0.2. Missing data is not silently zero. Unsupported population remains unscored.
5. DPD 10 is scored once through the draft 4–10 segment; DPD 11 uses the explicitly marked later-band assumption. DPD 31 never receives a made-up early model score.
6. A 4–10 customer with 0.42 probability and 10,000 exposure has ERA 4,200; a later customer with 0.337 and 1,000 exposure has ERA 337. The first can outrank the second subject to contact policy/skill. ERA is never labeled ECL.
7. Model class and action bucket are stored separately. Repeated runs on identical snapshot/policy produce identical scores, ties, and ranks.
8. A customer with two loans has one coordinated customer call task and one exposure aggregation. Two agents requesting the next item concurrently cannot claim the same work.
9. RPC at 27 Oct 10:00 Baku suppresses routine calls until at least 1 Nov 10:00 under the 120-hour demo convention. A new loan does not bypass it. Same rule is enforced in API and dispatch.
10. An answered third-party call does not count as verified RPC. Wrong number suppresses that contact. Failed retries obey bucket timing plus configured limits; no low-bucket routine call is created.
11. An active PTP respects its protection window. A qualifying partial payment updates remaining promise without double counting. A late source feed gives Pending reconciliation; a reversal reopens the applicable status with history.
12. Verified full arrears payment refreshes the customer's balances, removes obsolete outreach, and cures the collection episode while leaving an active non-matured loan open. A paid claim alone cannot do this.
13. Replaying a payment event/import/worker job twice does not duplicate amounts, allocations, PTP credit, tasks, metrics, or messages. Out-of-order events do not replace newer state incorrectly.
14. A payment arriving between queue generation and dispatch is rechecked and stops an obsolete contact. Unknown provider response does not trigger an unsafe duplicate send.
15. IVR/email disabled means explicit SMS fallback; it does not silently call all buckets 5–6. Senior-only overflow is visible and owned.
16. Unapproved/expired models and strategies cannot drive live execution. The maker cannot approve the same change; an agent cannot change score rules or view an out-of-scope customer by guessing an ID.
17. Import validation detects missing loan IDs, invalid dates, duplicates and control-total differences, quarantines critical errors, and reports complete row-level results.
18. Historical decisions retain their original model/strategy/input versions after a new version becomes active. Rollback is auditable and does not overwrite previous decisions.
19. Dashboard/exports reconcile to underlying rows. No duplicated customer exposure; roll/cure use fixed matured cohorts; not-yet-due PTPs are excluded from kept-rate denominators.
20. No real external message, phone call, loan mutation, or payment occurs in demo. Production rejects demo identity/role switching and payment injection endpoints.

Run type checking, linting, appropriate tests, and the browser critical path. Fix meaningful errors and report exact executed checks. Take screenshots of the core screens after rendering at desktop and narrower widths; resolve clipped actions, unreadable tables, overlaps, and inaccessible dialogs.

## 16. Implementation sequence and deliverables

**Slice 1:** schema/migrations/seed; secure demo identities; core adapter fixtures; annuity schedule; Customer 360; deterministic decision service; eligible queue and atomic task claim; simulated dialer automatic reservation/screen pop; agent availability and ACW; contact outcome with provider acknowledgment; PTP; mock posted payment; queue/suppression refresh; tests. This must work before the management dashboard is polished.

**Slice 2:** usable S02 analytics, S08 callbacks, team allocation, strategies/models/economics, CSV import/validation, integration health, data quality, exceptions, settings, RBAC, and audit. Complete P0.

**Slice 3:** pilot controls, approvals, campaign/template governance, feature/model monitoring, hardship workflow and later-stage handover. Document real interface contracts and unresolved production gates. Complete P1 without pretending the real integrations are connected.

**Slice 4:** approved future capabilities behind flags. Do not spend P0 effort implementing LLMs, robo callers or borrower payments.

Deliver source code; migrations; seed data; .env.example with no secrets; setup/run commands; worker setup; API/data contracts; permission matrix; model/policy JSON examples; CSV templates; tests; screenshots; README; BUILD_STATUS.md; ASSUMPTIONS.md; MODEL_CARD.md; INTEGRATION_MAPPING.md; METRIC_DICTIONARY.md; DEMO_SCENARIOS.md; and a production-readiness checklist that identifies actual missing inputs.

The readiness checklist must cover: approved executable model and golden cases; exact feature dictionary and snapshot policy; roll-event threshold/horizon; 1–3 probabilities; DPD 10 boundary; 31–45 policy; exposure scope; economic bucket cutoffs; core payment allocation and schedule rules; PTP/cooldown/frequency/quiet-hours policy; actual source interfaces and data freshness; identity/permissions; final templates; security/performance/restore validation; operational support ownership. Do not ask the user to approve a vague design before producing the working demo.

When reporting completion, give the functioning screens and flow first, then test evidence and material limitations. List placeholders and disabled adapters honestly. Do not call the application production-ready until the bank's separate requirements and validations are met.

**Begin implementation now.**


---

# Part C - AUTOMATIC DIALER AND AGENT DESKTOP EXTENSION

# ATB Collections - dialer integration and agent desktop

Prepared for Tural Hasanov | 27 October 2026 | ATB theme updated 28 October 2026

## Instruction to Claude Code

Implement this extension to the ATB Collections master specification. **Automatic dialer distribution is the normal agent workflow.** Agents log in, become Ready, receive assigned calls, see the customer's collection workspace and script automatically, select structured outcomes, and complete wrap-up. Manual customer selection is a controlled exception. This specification takes precedence over earlier wording that made manual "Get next customer" the normal agent action or treated dialer integration as a future optional module.

Preserve all existing annuity, core-banking, Prometeia, customer-level contact, approval, and reconciliation requirements. Build a functioning simulated dialer in P0; production connectivity needs the actual bank dialer, supported APIs/SDK, configuration, and interface testing. No real call is authorized by this build prompt.

## 1. Product design and system ownership

Build **S28 - Agent desktop**, route `/agent`, as the landing page for soft-collection agents. It has Home/Ready, Reserved/Dialing, Live conversation, and After-call work states. Reuse S04 for the customer context and S06/S07 for outcome and promise capture. Enhance S17 with live agent/campaign supervision and S21 with CTI health. There are now 28 screen specifications, with several states within S28.

| Component | Owns | Does not infer or overwrite |
|---|---|---|
| Core banking | Contracts, schedules, posted payments/allocations, authoritative balances/DPD | A claimed payment is not a posting. |
| Collections backend | Eligible customers, Prometeia score/ERA, treatment priority, contact restrictions, routing authorization, outcome dictionary, PTPs, next actions, operational audit | A telephony Answered event is not verified right-party contact or a payment. |
| Dialer / PBX / contact centre | Dial attempts, carrier and voice media, agent routing availability, call legs/bridging, telephony results, supported call controls and call-detail records | It cannot independently recycle customers in violation of collection restrictions. |
| CTI adapter | Provider authentication, normalized commands/events, correlation, status synchronization, reconciliation and provider outcome mappings | It does not invent events or claim unsupported provider capabilities. |
| Agent frontend | Authorized customer context, script, visible confirmed telephony state, structured response capture and wrap-up | The browser is not the source of truth for balances, actual call state, or enforcement of eligibility. |

CTI means computer-telephony integration: the connection between the voice platform and the agent's collection workspace.

Prefer an official embedded dialer control/softphone SDK if the existing platform supports it. Otherwise, keep the existing softphone or desk phone and use server-side CTI events to open the correct customer and synchronize outcomes. An existing dialer agent desktop can also host the collection workspace in a supported embedded panel. Choose the least disruptive supported option after capability discovery; do not replace the bank's telephony platform by assumption.

Voice stays in the dialer/PBX and its supported media path. Do not build SIP routing, a predictive pacing engine, or call recording infrastructure into the collections React app. For browser voice, use the provider's supported SDK and short-lived authorized session credentials; for a desk phone, show the mapped extension/device and actual state.

## 2. Normal automatic workflow

1. The agent authenticates, maps to a dialer identity/extension, and joins authorized campaign queues. Check CTI connectivity, customer-data freshness and the ability to save outcomes. Agent becomes Ready only when both application and provider confirm the effective state.
2. Collections selects the next eligible customer under the approved strategy. Apply payment freshness, customer restrictions, cooldown/PTP, callbacks, skill/language, seniority and capacity before routing. Preserve cross-DPD ERA ranking where appropriate; do not replace it with an arbitrary "oldest DPD first" dialer list.
3. Create a short-lived routing reservation linking customer, work item, campaign, phone contact, required skills, policy/model/decision versions and a correlation ID. There is one active voice reservation per customer across campaigns and one per voice agent.
4. The supported integration authorizes dialing. In the demo, use progressive routing: reserve an available agent, dial one eligible customer, then bridge the answered customer to that agent. In production, integrate the bank's supported mode; predictive/power pacing needs separate capability and operational evaluation. "Automatic distribution" does not require predictive dialing.
5. On assignment/reservation, load the correct customer workspace and pinned script. On provider call events, update Dialing/Ringing/Connected. Show the profile before or at connection where the platform supports this timing; measure screen-pop delay and alert on failures. Never identify a customer only by a shared phone number or from untrusted URL parameters.
6. During the conversation, the agent verifies the right party, follows the script, selects reason/outcome dropdowns and optionally records a PTP, callback, dispute or support request. Auto-save a recoverable draft to the backend; final submission still validates it.
7. On call end, enter After-call work (ACW). The dialer supplies call times and technical result. Agent supplies the business outcome. Mandatory fields and conditional details must be complete before automatic distribution can resume.
8. Save the outcome and collection effects atomically, then synchronize the provider's wrap-up/disposition. Apply customer-wide suppression, PTP/reminder rules and next action. A provider acknowledgment or defined reconciled terminal state is required before releasing the agent to another voice call.
9. If the agent has enabled automatic continuation, return to confirmed Ready after successful wrap-up; otherwise remain Not ready. Break/logoff requests made during a call take effect after wrap-up. The next customer is then allocated automatically without browsing a loan list.

Unanswered/busy/machine-detected attempts are normally recorded from reliable provider results, rather than forcing agents to classify calls they never spoke on. Machine detection is not perfect and must not be treated as verified customer contact. Preserve technical results and later corrections.

**Visual theme:** inherit the required ATB palette in Part B section 5.1: purple navigation, yellow CTAs with dark-purple text, pale-lavender selection, and separate semantic status colours. Use the original atb logo unchanged across S28 and supervisor screens.

## 3. S28A - personal home dashboard / Ready screen

Use a simple role-specific workspace. Agents must not land on bank-wide strategy, model or integration administration screens.

**Persistent availability bar**

- Agent name, team/role, campaign/skill queues, extension/device, language and shift.
- Requested versus confirmed state: Offline, Not ready, Ready, Reserved/Dialing, Talking, After-call work, Break, or Connection problem. Show elapsed time in the current state.
- Ready / Not ready / Break / End shift controls; reason required where bank policy specifies it. Never show Ready optimistically before provider confirmation.
- CTI connection, device/headset readiness where observable, financial-data freshness, and outcome-save connectivity. A heartbeat proves browser connectivity, not headset health.
- Automatic continuation after wrap-up toggle, only where permitted. Manual redial and number changes are controlled privileges rather than the primary action.

**Personal metrics - today's scoped work**

- Attempts handled and unique customers worked, shown separately.
- Verified right-party conversations and defined RPC rate.
- Promises obtained, promised amount, and promises due today.
- Qualifying verified cash attributed under a documented rule, explicitly distinct from incremental agent impact.
- Kept PTP rate for matured promises only, with its period and denominator.
- Average talk and ACW time, unresolved wrap-ups, and quality result only when a valid QA feed exists. Do not invent a score or incentivize short calls at the expense of correct outcomes.

**Work panels**

- My callbacks: due time, customer, reason, eligibility, and whether ownership must be honored. No callback bypasses a contact restriction.
- My promises due / broken / awaiting reconciliation, with remaining amount and follow-up status.
- My open disputes/support/reconciliation tasks and deadlines.
- Recent conversations with saved dispositions and task states.
- Queue/service status: active assigned campaign, waiting state and relevant updates. Do not expose an unrestricted customer calling list for agents to cherry-pick.

Access is scoped to currently assigned interactions, approved callback ownership and authorized follow-up populations. Re-check access on every API request; a stale browser tab cannot retain access after an authorized handover or loss of assignment.

## 4. S28B - live conversation workspace

Open automatically for the assigned interaction. Use a three-column desktop layout plus a persistent call strip.

| Area | Required content |
|---|---|
| Call strip | Confirmed state, elapsed talk/ring time, campaign, agent/device, masked number, customer/case/call identifiers, connection health, provider-supported mute/hold/transfer/end controls. Disable unsupported actions. |
| Left: customer context | Name/CIF, identity-verification status, preferred language, valid contact, all eligible loans, max DPD, total overdue and component split, outstanding principal, next installment, most recent verified payment, active PTP, previous contact/outcome, restrictions and relevant support/dispute flags. |
| Center: guided script | Published template/version/language, current step, amounts/dates bound to a fresh snapshot, branching based on verification and reason. Tabs for loan/schedule, payment history, contacts and documents without losing the active call. |
| Right: structured responses | Identity verification, disposition, reason for nonpayment, payment intention/ability, conditional PTP amount/date/covered obligations, callback date/time, support/referral or dispute route, short additional note. |
| Outcome strip | Draft-save state and validation errors. No accidental final submission or navigation to a new customer while the call remains active. |

Scripts should be deterministic approved templates for P0, not live LLM-generated debt advice. Suggested steps: opening/right-party verification -> explain overdue installment -> establish reason -> agree next step/support -> confirm commitment -> close. Hide customer-facing debt disclosures until verification; do not hide necessary internal context from authorized agents. A third-party answer switches to an appropriate privacy-preserving script and cannot become RPC.

Bind the script to both the interaction and template version. A mid-call policy/template deployment does not rewrite what the agent is reading. If a verified payment arrives mid-call, show a clear balance-update notice and adjust the conversation; do not automatically hang up. If source data becomes stale or a customer mismatch appears, keep the provider's call controls accessible and tell the agent how to handle the issue, rather than revealing another customer's information.

## 5. S28C - After-call work and dropdown dictionary

Show the last customer and call summary with system-derived talk/hold/ring/ACW durations. Preserve the draft when the call ends or the page reconnects. Agents do not manually type durations or technical connection outcomes already supplied by the dialer.

Use controlled, versioned dropdowns with conditional validation:

| Field | Example values | Entered by / rule |
|---|---|---|
| Technical result | Answered, no answer, busy, unreachable, failed, machine/voicemail, cancelled | Provider-derived; corrections are auditable. These are not business outcomes. |
| Identity/contact status | Right party verified, third party, verification failed, wrong person/number, not established | Agent input for meaningful connected calls; provider answer detection cannot fill RPC automatically. |
| Main business outcome | PTP, partial-payment commitment, no commitment, customer-requested callback, already-paid claim, dispute, repayment support needed, refused discussion, special-case referral | Exactly one primary code, with optional independent flags. Preserve source dictionary and provider code mappings. |
| Reason for nonpayment | Salary timing, temporary cash shortfall, income interruption, affordability difficulty, forgot, technical payment issue, disputed debt, other, not stated | Required only for applicable conversations; sensitive details restricted. A reason is not itself a final disposition. |
| Next action | Monitor PTP, eligible callback, reconcile claimed payment, dispute review, support referral, policy-based retry, no further action for now | Computed from outcome/policy with controlled overrides and reasons. |
| Additional note | Concise factual explanation | Optional by default; required for Other, exceptional changes and specified referrals. Avoid unnecessary sensitive narrative. |

Conditional fields:

- PTP/partial commitment: positive amount, currency, deadline, covered loan/obligations, explicit agreement, reminder rule and qualifying-payment window. An installment commitment does not rewrite the contract.
- Callback: customer request/time window, timezone, channel/number validity, authorized owner, eligibility check and any permitted exception evidence. It cannot automatically bypass the five-day cooldown.
- Already paid: claimed amount/date/channel/reference where provided; open reconciliation and apply the approved temporary contact hold. Do not mark Paid.
- Wrong number: invalidate only the relevant contact point pending approved source updates; do not mark all customer numbers invalid without evidence.
- Support/dispute: create the corresponding case and apply its approved special-handling policy; do not turn every support flag into a payment refusal.

Before saving, show a next-action preview: business outcome, PTP/callback details, exact next permissible call time, digital reminder plan, and any owner/referral. Use one normal action: **Save outcome & return Ready**. It means: validate -> persist outcome/effects -> acknowledge provider wrap-up -> confirm readiness. No next call while save or synchronization is unresolved. A safer **Save & stay Not ready** action is available for break or issue handling.

Provider and business codes are separate. If the provider accepts a single wrap-up code, map the primary business disposition to it and retain richer fields in the collections database. A provider campaign recycle must never erase the application's customer-level suppression.

## 6. Availability, business state and call state

Do not implement one overloaded status field. Maintain:

- Agent requested state and last provider-confirmed availability.
- Aggregate interaction state and individual provider call legs.
- Business disposition draft/submission/confirmation state.
- Case/PTP/contact restriction state.

Proposed voice lifecycle: Not ready -> Ready -> Reserved -> Dialing/Ringing -> Connected -> Ended -> ACW -> Outcome saved -> Provider wrap-up acknowledged -> Ready or Not ready. Failed attempts can skip the conversation/agent wrap-up path according to provider behavior; they still consume retry/frequency limits.

Only effective Ready agents with valid skills, an active CTI session, no existing voice reservation and no unresolved required wrap-up may receive a new call. Availability changes can race with dialing; handle reservation cancellation and provider reconciliation. Do not release a customer lock merely because a browser lease/heartbeat expires while the provider still reports an active call.

Configure the provider so that a wrap-up timeout does not automatically return an unsaved agent to Ready. If this cannot be enforced in the selected platform, expose it as a pilot-blocking capability gap or use a demonstrably effective server-side Not ready/reservation mechanism. UI disabling alone is insufficient.

Transfers use the same parent interaction with per-agent segments, provider call-leg IDs and ownership changes. Preserve the original contact and outcome history; do not count a transfer as a new customer dial attempt. Inbound callbacks and agent-requested outbound calls must join the same customer-level restriction/interaction coordination where the provider permits it.

## 7. Provider-neutral integration contract

These are proposed application interfaces, not existing ATB/vendor endpoints.

```ts
interface DialerAdapter {
  capabilities(): Promise<DialerCapabilities>;
  getAgentState(agentRef: string): Promise<ConfirmedAgentState>;
  setAgentState(command: AgentStateCommand): Promise<CommandReceipt>;
  authorizeOrPublishWork(ticket: RoutingTicket): Promise<CommandReceipt>;
  withdrawWork(command: WithdrawCommand): Promise<CommandReceipt>;
  requestCallControl(command: SupportedCallControl): Promise<CommandReceipt>;
  submitWrapUp(command: WrapUpCommand): Promise<CommandReceipt>;
  getInteraction(providerInteractionId: string): Promise<ProviderInteraction>;
  reconcile(since: string): Promise<ReconciliationResult>;
}
```

Implement a MockDialerAdapter first. A real adapter may be a provider SDK, CTI server connector, or controlled list/campaign integration. Expose actual capabilities: event subscription, screen-pop metadata, agent state control, call controls, wrap-up, pre-dial eligibility hook, contact withdrawal/acknowledgment, priority preservation, callbacks and reconciliation. Do not return success for an unsupported capability.

**Commands to provider:** join authorized queue / state change; publish or authorize a limited eligible work set; withdraw/suppress queued contact; supported call control; wrap-up submission; authorized callback. Every command has a stable idempotency key, explicit actor/scope, expiry where relevant and a receipt state Requested/Confirmed/Rejected/Unknown.

**Normalized inbound events:** agent state changed; reservation assigned/released; attempt started; customer leg ringing; answered/connected; agent bridged; call ended; wrap-up started/completed; command rejected; provider connectivity lost/recovered. Map actual provider semantics carefully: carrier answer, bridge to agent and verified customer identity are different facts.

Use server-side authenticated events or supported trusted SDK sessions. A browser-reported event is not automatically an authoritative provider event. Verify signatures/token scopes, event IDs, tenant/source, timestamps and replay handling as appropriate to the chosen platform. Push role-authorized state to the agent UI using WebSocket or SSE; do not poll an unrestricted global stream from every browser.

Routing metadata should include workItemId, collectionCaseId, customerId/CIF reference, interactionCorrelationId, campaignId, dialerAgentId, contactPointId, reservation expiry, strategy/model/decision versions and a server-side authorization reference. Do not include unnecessary financial or identity details in the provider record. Do not trust plain phone-number lookup to resolve a screen pop.

Persist ProviderAgentMapping, AgentSession, RoutingReservation, DialAttempt, Interaction, InteractionSegment/CallLeg, DispositionVersion, ScriptVersion, ProviderEvent and CommandReceipt in addition to the master data model. Correlate IDs across provider retries/transfers. Keep separate occurred/received/processed times and duplicate guards.

## 8. Freshness, suppression, race conditions and degraded operation

- Re-evaluate eligibility immediately before authorizing an outbound attempt. Prefer a provider pre-dial hook or just-in-time reservation flow. If the provider only supports preloaded lists, use controlled short batches, prompt withdrawal and confirmed suppression; explicitly document the remaining delay/race and validate its acceptability before pilot use.
- Maintain one cross-campaign customer contact policy. Provider auto-retry, multiple numbers and campaign recycle must not bypass it. Synchronize blocked contacts and the allowed next time into the actual executing dialer.
- A payment/cure before dialing cancels eligible pending work and requests provider withdrawal. Treat unacknowledged withdrawal as unresolved. If the call has already started, attempt only supported safe cancellation; do not claim it was prevented. If already connected, update the agent rather than automatically terminating a conversation.
- Connectivity loss or unknown agent state pauses new allocation for the affected agent. Existing voice can continue on the PBX while the app recovers. Restore state from the provider and backend, not from an empty local browser screen.
- Failed outcome save keeps the agent in ACW/Not ready and preserves the draft. Business save success plus provider wrap-up failure is a distinct pending synchronization state; retry idempotently and reconcile without duplicating PTPs or calls.
- Browser refresh/multiple tabs must not duplicate reservations, start another phone call or open a mismatched customer. Use an authoritative active-session policy and recover the current interaction after reconnect.
- If the customer screen is not ready when a call arrives, display a restricted recovery state with the correct correlation ID and provider controls; pause new routing until recovered. Never display an unrelated customer's data as a fallback.
- Provider call recordings, if already supported and approved, remain in their authorized storage; retain permission-checked references. Recording retention, notices, monitoring and supervisor listen/whisper/barge are separate bank policy/capability decisions, not automatically enabled features.

## 9. S17 enhancement - supervisor live view

Show agent name/role/skills, provider-confirmed state and elapsed time, current interaction/customer reference, queue, ring/talk/ACW duration, submitted versus pending outcome, and CTI/device status. Show eligible backlog and senior-capacity overflow, overdue callbacks, unsaved wrap-ups, screen-pop delays and suppression synchronization failures.

Actions within permission: pause campaign/new allocations, change authorized agent queue membership, reassign eligible follow-ups, assist with a stuck wrap-up, inspect event/command correlation, and escalate a provider outage. Do not allow a supervisor to silently alter a historical outcome or erase an agent's draft. Provider timeout and readiness mismatches must be visible and owned.

Personal productivity and supervisor reporting use the same metric definitions. Count attempts, unique customers, verified RPC, PTPs, matured kept PTPs, attributed verified cash, talk/ACW time and quality context separately. Do not compare agents solely on raw attempts or promised amounts.

## 10. Mock dialer and acceptance tests

The demo must simulate normal automatic routing without any real telephony account. Include controls for Ready/Not ready, assignment/reservation, ringing, busy/no answer, connected, transferred, ended, ACW, save acknowledgment failure, payment arriving before dialing, CTI disconnect and reconnection. Use a seeded event sequence and an injectable clock.

Acceptance scenarios in addition to the master prompt:

1. Agent logs in, confirms Ready once, and receives a simulated eligible call automatically; no customer search or "Get next" click is needed.
2. The correct Customer 360 and script load from trusted customer/work/interaction IDs, including for two unrelated customers sharing a phone number.
3. Two available agents/campaigns cannot obtain concurrent outbound reservations for the same customer. The dialer cannot assign a second voice call to an agent already talking or wrapping up.
4. Assigned campaign, language and seniority govern routing without corrupting the approved ERA priority. Unscored/later-stage cases remain in their authorized separate policy flow.
5. Provider Answered/Connected does not mark RPC. Busy/no answer outcomes are captured without an invented customer conversation or PTP.
6. Ending a call opens ACW. A PTP outcome requires valid conditional fields. The next call waits until business save and provider wrap-up/readiness acknowledgment complete.
7. Clicking Save twice or replaying call events does not duplicate the interaction, PTP, cooldown, metrics or provider disposition.
8. Saving verified RPC suppresses all customer loan/campaign call entries under the applicable cooldown and PTP rules; changing a number or recycling a campaign cannot bypass it.
9. A verified payment before dial authorization withdraws pending work. A payment after connection updates the active agent screen without dropping the conversation.
10. Browser refresh, lost events and CTI disconnection recover the active call and pending draft; a stale Ready indication cannot authorize another call.
11. A pending wrap-up or failed provider acknowledgment blocks automatic continuation, with visible supervisor recovery and idempotent replay.
12. Break requested during a conversation is applied after required wrap-up. A transfer preserves parent interaction/segments and does not double-count attempts or customer exposure.

Implement this automatic lifecycle as part of the first vertical slice. The real-provider pilot additionally needs verified endpoint/security mapping, test extension/campaign, event samples, pre-dial/suppression behavior, wrap-up timeout configuration, transfer/reconnect tests and operational owners. The actual dialer **brand, version, deployment, API/CTI documentation and licensed capabilities are still unknown**.

## 11. Primary references for implementation patterns

These demonstrate integration patterns, not a recommendation to purchase a replacement dialer. Validate the documentation for the actual selected bank system.

- Genesys campaign workflow: screen pop, scripts and disposition codes - https://help.genesys.cloud/articles/agents-process-campaign-calls/
- Genesys dialing modes, including progressive routing - https://help.genesys.cloud/articles/dialing-modes/
- Genesys wrap-up mapping and contact/number callability - https://help.genesys.cloud/articles/wrap-code-mappings-page/
- Amazon Connect Streams: embeddable call controls and agent/contact events - https://github.com/amazon-connect/amazon-connect-streams
- Amazon Connect third-party application patterns - https://docs.aws.amazon.com/connect/latest/adminguide/3p-apps.html
- Asterisk AMI event/call-leg/bridge semantics - https://docs.asterisk.org/Configuration/Interfaces/Asterisk-Manager-Interface-AMI/AMI-v2-Specification/

Build provider-neutral behavior first; map the real bank dialer only after its actual capabilities are established.

---

# Part D - OPERATING PROCESS AND DELIVERY PRIORITIES

This part consolidates the operating process discussed after the screen pack. Implement it together with Parts B and C. It clarifies workflow and delivery priority; it does not approve a production contact policy or replace the model-validation gaps in Part A. Where an illustrative screen or earlier general navigation wording conflicts with this workflow, use this part and Part C for behavior, and Part B section 5.1 for branding.

## 1. Operating objective and ownership

Optimize verified cures and qualifying net cash recovered per productive agent-hour, with appropriate customer treatment and contact controls. Promised amounts and raw dial counts are intermediate measures. ERA is the initial risk-ranking signal; actual incremental treatment benefit must be measured rather than inferred from ERA or attributed cash.

Keep one coordinated collection case per customer within the defined portfolio scope, with linked loan-level obligations. Permit only one active outbound voice reservation for that customer across campaigns. An ordinary call can be pooled among eligible agents; an agreed callback can have a named owner and a documented fallback if that owner is unavailable. A handover preserves history, restrictions and the promise state.

| Component | Operational responsibility |
|---|---|
| Core banking | Authoritative contract, schedule, balances, payment allocations, reversals, DPD and loan status |
| Collections services | Case state, score/ERA, treatment, eligibility, queue rank, promises, callbacks, referrals and next action |
| Dialer/PBX | Voice connection, routing availability, call legs, timestamps, technical attempt result and supported call controls |
| CTI adapter | Correlated commands/events, state synchronization, suppression/withdrawal and reconciliation |
| Agent | Right-party verification, approved conversation, business outcome and agreed commitment/support details |
| Supervisor | Capacity, exceptions, service quality, recovery from stuck states and authorized overrides |

## 2. Daily preparation and intraday changes

At the beginning of the business day, import or refresh the customer/contact master and authoritative financial projections. Validate source timestamps, completeness and control totals before enabling affected automated outreach. Calculate the approved daily decision snapshot and stable initial ranking. Record the business date, model/policy versions and data-as-of time.

During the day, process supported payment, reversal, restriction, contact, promise and callback events as they arrive. Invalidate obsolete work immediately after an accepted event; do not wait until the next daily queue rebuild. Re-score/rebucket according to the documented snapshot policy, preserving explanations for priority changes. A daily source reconciliation remains necessary even when event delivery is available. For a batch-only source, show its actual freshness and limitations; do not label it real time.

The same server-side contact-policy service must run when a queue is generated, when a work item is reserved, immediately before dialing/sending, and on a controlled manual action. It returns eligibility, reason codes, next permissible time and policy version. Stale critical financial data, active restrictions and unresolved provider state must have a visible operational route rather than silent execution.

## 3. Treatment and queue construction

Use customer-level ERA = probability of the defined roll event multiplied by the approved exposure. Keep the eight model classes separate from the ten action buckets. Use a common economic ranking across supported DPD segments, then apply authorized due-follow-up priority, language/seniority skills and capacity. Record the reason for operational overrides.

The proposed operational treatment follows the supplied design:

| Segment | Normal proposed treatment |
|---|---|
| DPD 1-3 | Emphasize self-cure and approved digital reminders; exact scoring and exceptions remain bank inputs |
| Action buckets 1-4 | Approved digital reminders and monitoring; no routine agent call |
| Action buckets 5-6 | SMS fallback initially; future IVR/digital only when that channel is supported and approved |
| Action bucket 7 | Selective agent work after higher-priority eligible work, within available capacity |
| Action buckets 8-9 | Regular agent calls under the common ranking and contact rules |
| Action bucket 10 | Senior-agent queue; visible senior-capacity overflow |
| DPD 31-45 and later | Separately owned later-stage policy and handover; do not extrapolate the early model |
| Dispute/support/special handling | Appropriate governed referral and contact treatment |

Due callbacks, broken promises and unresolved paid claims are operational states with their own eligibility checks; they do not bypass restrictions. An unanswered attempt is not a verified conversation. The same customer's other loan, another telephone number, or a reloaded dialer campaign cannot reset contact history.

## 4. Agent work as a single continuous workspace

Route a collection agent to `/agent` after authentication. The main journey has Ready/Home, Reserved/Connecting, Live conversation, and After-call work states. Global settings, models and bank-wide analytics belong to other authorized roles. A secondary task/history view is available without losing the current interaction.

1. Agent signs in, is mapped to the correct extension/provider identity, joins authorized queues and requests Ready. Confirm effective provider readiness and healthy outcome saving before routing.
2. Collections selects an eligible customer, reserves both the customer and agent, and rechecks current payment/restriction state. The demo uses progressive dialing: reserve an agent, dial one customer, connect the answered call. Automatic allocation is the normal operation.
3. Open the trusted customer workspace and script on reservation/assignment. Show the customer's loans, overdue components, latest verified payment, DPD, previous outcome, active promise, restrictions and why the customer was selected. Correlate using trusted case/work/interaction IDs, including when different customers share a phone number.
4. The agent verifies the right party, follows the published script, and captures responses during the conversation. Save recoverable drafts. A third-party answer follows a privacy-preserving script and is not verified right-party contact.
5. Call end enters After-call work. The provider supplies technical results and durations; the agent supplies the business outcome. Display only the additional fields relevant to the selected outcome.
6. `Save outcome & return Ready` validates and persists the business result and next-action effects, synchronizes provider wrap-up, and confirms readiness. `Save & stay Not ready` supports breaks and issues. No second call can arrive while required wrap-up, saving or provider state is unresolved.

Use the S28B three-column screen: customer facts on the left, conversation script in the middle, structured responses on the right. Keep call controls, confirmed availability, elapsed time, connection state and draft-save state visible. Load schedules and payment history in tabs or drawers without replacing the active call context. Buttons and administrative navigation must reflect the user's permissions.

Start with short structured fields: verification/contact status, main business outcome, applicable reason for nonpayment, and conditional PTP/callback/referral details. Notes are optional except for Other or an approved exception. Do not ask agents to retype core balances, call timestamps or provider technical results. Preserve the richer business result even if a provider accepts only one disposition code.

## 5. Outcome-to-next-action rules

Every completed interaction or reliable failed-attempt event produces a next action or an explicit reason for no action. Show a preview before saving a business outcome.

| Result | State update | Next action |
|---|---|---|
| Busy/no answer/unreachable | Store provider technical result; no RPC or invented promise | Retry only within bucket timing, frequency and permitted hours |
| Wrong number/person | Flag the evidenced contact point; retain audit history | Contact-data correction and any eligible alternative contact |
| Verified conversation, no commitment | Save business outcome/reason and successful-contact time | Apply cooldown; calculate the next permitted treatment |
| PTP/partial-payment commitment | Save amount, currency, covered obligations, agreed deadline and qualifying-payment window | Protect the promise under policy; reminders and payment monitoring |
| Requested callback | Save permitted time window, owner and contact preference | Scheduled eligible callback with explicit reassignment/fallback |
| Already-paid claim | Save claim details, with no invented accounting posting | Reconciliation task and the approved temporary contact hold |
| Dispute | Create an owned dispute case and appropriate restriction | Specialist review and governed resumption |
| Repayment difficulty | Create an owned support/referral case | Approved support assessment; no unapproved contract rewrite |
| Qualifying posted payment | Import authoritative allocations/balances and reconcile promise state | Withdraw obsolete outreach; update residual arrears or cure |
| Promise deadline reached without fresh payment data | Preserve uncertainty | Pending reconciliation, then reassess once source data is sufficient |

The source's minimum five-day successful-contact cooldown is represented as 120 hours in the demo, with its convention labeled. Proposed PTP protection extends routine-call suppression to the later of the cooldown end and promise deadline plus settlement allowance. Exact duration, exceptions, callbacks, channel caps and contact hours are configurable demo assumptions until approved. A claimed payment is not a posted payment, and an expired promise with a stale source is not automatically a broken promise.

## 6. Payments, cure and race conditions

A verified payment before dial authorization must trigger re-evaluation and cancellation/withdrawal of obsolete work. Reconcile an already-dispatched attempt with the provider rather than assuming it disappeared. A payment during an active conversation updates the customer view and notifies the agent; it does not automatically disconnect the call.

Credit promises using the documented qualifying-allocation rule once, with original payment/loan references. Separate promise fulfillment from account cure: a customer can keep a partial-payment promise while arrears remain. Let core allocations determine which installment remains unpaid. Clearing arrears closes the collection episode, while a continuing loan remains active. A reversal can reopen the relevant derived state with history intact.

Customer-initiated inbound calls should open the same case and history when identity is established. An inbound number match is only a lookup hint, not proof of identity. The adapter contract should document how inbound routing competes with outbound reservation; a reserved agent cannot be counted as free for both. Inbound handling and a requested outbound callback have different policy semantics and must not silently bypass outbound limits.

## 7. Supervisor cadence and measures

At shift start, review data health, available agents and senior coverage, due callbacks/promises, eligible backlog and restricted work. Throughout the shift, handle missed callbacks, stuck wrap-ups, provider disconnects, suppression failures, support referrals and capacity overflow. At day end, reconcile payments, outcomes, unresolved cases and source/provider differences. Review strategy and quality on an agreed periodic cadence.

Use consistent metrics with explicit denominators: attempts, distinct customers, verified right-party conversations, matured kept promises, net qualifying cash, cohort cure/roll outcomes, cost, productive time, talk/ACW time and quality/complaints. Agent-attributed cash is not proven incremental impact. The source's six agents x 80 successful contacts is a planning scenario, not a guaranteed throughput target or an attempt count. Size work using observed contact rates and handle times, preserving time for quality and exceptions.

## 8. Orange, provider choice and the first release

The user currently uses a local Orange voice application and has not selected a dialer. Its exact identity, underlying PBX, version, deployment, API and routing capabilities are unknown. Do not invent an Orange endpoint or assume that Orange is OrangeLine. Preserve the option to keep its supported voice client while adding CTI. VICIdial, 3CX or another provider can be evaluated without changing the collection-domain services.

Before a real-provider pilot, prove the following supported capabilities: agent identity/readiness; reservation and automatic routing; customer/work correlation; technical call events; business disposition mapping; wrap-up gating; pre-dial eligibility and suppression/withdrawal; active-call lookup after reconnect; and reconciliation of uncertain commands. Determine whether inbound/blended calls or transfers affect reservation behavior. If a required behavior needs an add-on or custom controller, describe the gap and cost responsibility; do not label a generic PBX integration a finished outbound workflow.

P0 implements a provider-neutral mock dialer and a complete automatic call cycle. Create adapter interfaces, capability flags, proposed event/command schemas, fixture payloads and the mapping checklist. Real credentials, live calls, commercial software installation and provider procurement are outside the demo. Predictive pacing, custom SIP infrastructure, recording infrastructure and production AI calling are not P0 work.

## 9. Delivery and evidence

First deliver the complete vertical slice in Part B section 16, with the automatic S28 workflow from Part C. Complete remaining P0 screens and operations next. Implement the separately identified P1 workflow/control scope after P0 is stable. Keep P2 explicitly deferred. A P1 feature built with mock contracts remains a demo feature, not an approved live integration.

Use the existing 20 core acceptance scenarios and 12 CTI scenarios as the foundation. Add coverage for partial-promise fulfillment without cure, already-paid reconciliation with a stale feed, named callback fallback within eligibility, payment arriving in each dispatch/call state, and inbound/outbound reservation contention where implemented. Screens must show real persisted synthetic state, with dashboard totals tracing to underlying records.

Demonstrate: agent Ready -> automatic eligible assignment -> correct screen pop -> verified conversation -> valid PTP -> saved outcome and provider acknowledgment -> customer suppression -> injected mock posted payment -> promise/arrears/case/dashboard update -> duplicate-event replay with no duplicate effect. Also demonstrate one failed-attempt retry and one blocked/stale-data case. Provide a working local run path, actual test results, screenshots and a precise inventory of incomplete or disabled functionality.
