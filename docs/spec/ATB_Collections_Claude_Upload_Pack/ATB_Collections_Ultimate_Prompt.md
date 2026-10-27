Build ATB Collections using the supplied project pack. Work in the repository with your file and terminal tools and implement the application. Continue beyond planning to a working, tested local application.

## Read the pack first

Find `ATB_Collections_Claude_Upload_Pack/` in the project, or locate the same files supplied as attachments:

1. `ATB_Collections_Claude_Master_Prompt.md` - the authoritative specification. Read all of Parts B, C and D. Part A provides benchmark context and source/model caveats.
2. `ATB_Collections_Screen_References.pdf` - 12 core screen references.
3. `ATB_Dialer_Agent_Desktop_Screens.pdf` - four agent/supervisor screen states.
4. `Prometeia_ATB_Collections_Source.pdf` - the original project deck, renamed for this pack; relevant collection material is on PDF pages 4 and 7-23.
5. `brand/` - official ATB logo, CSS tokens, JSON palette and usage notes. `screens/` contains all 16 PNG references and an index.

Inspect the repository, package files and AGENTS.md instructions before choosing an implementation approach. Preserve working project conventions. Follow the master specification for behavior, Parts C/D for automatic agent workflow and delivery priority, and Part B section 5.1 plus the supplied assets for branding. The 16 images illustrate selected states within 28 screen specifications; implement the written requirements for screens without a picture. Reference numbers and graphs are synthetic examples; derive application values from persisted data.

## Product and financial scope

Create an internal web application for ATB Azerbaijan to collect existing unsecured AZN consumer cash loans with fixed-rate monthly annuity repayments. It is a collections operating layer integrated through adapters with existing core banking and the Prometeia design. Core banking owns contracts, schedules, posted payments/allocations, balances, DPD and loan status. Collections owns cases, priority, treatments, contacts, promises to pay (PTPs), callbacks, referrals, approvals and operational history. Coordinate all eligible loans under one customer case.

Implement decimal financial arithmetic and the documented annuity simulation. Verify the 10,000 AZN / 18% nominal / 24-month fixture: regular payment 499.24, first interest 150.00, first principal 349.24 and first closing principal 9,650.76. Adjust the final installment under the documented rounding policy. Preserve imported core schedules; partial payment does not automatically cure arrears. Do not invent charges, penalty rates or accounting postings.

Use synthetic data and mock integrations by default. Provide a complete local web/worker/database setup. No live bank connection, real call/SMS/payment, procurement or deployment is part of this build. Do not require paid provider accounts or production secrets to demonstrate it.

## Required operating flow

Refresh source data -> validate freshness -> create/update one customer case -> score and select treatment -> apply contact restrictions -> route digital or agent work -> record structured outcome -> schedule next action -> reconcile posted payment -> update promise, arrears, queue and reporting.

Use Prometeia ERA as the initial priority signal, keeping its eight model classes separate from ten treatment buckets. Model classes, ERA, DPD, action buckets and contact eligibility are distinct fields. Implement source-derived rules with provenance and clearly labeled demo assumptions. Preserve the documented unresolved model issues; an unknown feature, missing probability mapping or unsupported later-arrears population must not become an invented approved score. Queue selection must respect restrictions, eligible due follow-ups, economic priority, skills and capacity.

Enforce customer-wide contact rules on the server at scheduling, reservation and immediately before dispatch. Include cooldowns, PTP protection, permitted times, retry limits, invalid contacts, disputes, support cases and financial-data freshness. A new loan, different number or new campaign cannot bypass these controls. A paid claim opens reconciliation; only verified core postings change financial state. Payments and reversals must update eligibility during the day, with reliable reconciliation and idempotent processing.

## Automatic dialer and agent desktop are core requirements

The user has not selected a dialer and currently uses a local Orange voice application whose exact integration capabilities are unknown. Create a provider-neutral adapter and deterministic mock provider. Do not assume an Orange API, install a commercial dialer, or hardcode 3CX/VICIdial as a purchased service.

Agents land on `/agent`. Normal flow: log in -> confirmed Ready -> reserve one eligible customer and agent -> progressive automatic dial -> trusted customer screen pop -> conversation -> After-call work -> validated outcome saved -> provider wrap-up acknowledged -> confirmed Ready or Not ready.

Use one active outbound voice reservation per customer across campaigns and one voice interaction per agent. Manual selection/redial is a controlled exception. No new call may route while wrap-up, saving or provider state is unresolved. A provider Answered event is not verified right-party contact. Failed technical attempts are captured automatically without inventing a conversation. Include reconnect, duplicate events, unknown command results, payment-before-dial cancellation, payment-during-call updates and break-after-wrap-up behavior.

The live workspace has customer/loan/payment facts on the left, a published branching script in the center, and structured responses on the right. Keep confirmed call state, supported controls, timer and save state visible. Capture verification, primary business outcome and applicable reason for nonpayment; show conditional fields for PTP, callback, paid claim, dispute or support referral. Auto-save recoverable drafts. `Save outcome & return Ready` persists the outcome and next-action effects, synchronizes provider wrap-up and confirms availability.

Every outcome produces the next action automatically: eligible retry, contact correction, cooldown, protected PTP monitoring, permitted callback, reconciliation or specialist referral. Give agents their own callbacks, promises, tasks and scoped results. Give supervisors live team states, eligible backlog, senior overflow, missed callbacks, stuck wrap-ups and integration exceptions.

## Design and implementation

Apply ATB purple #6F0BBB, dark-purple navigation #34035D, yellow primary actions #F4C900 with dark-purple text, pale lavender #F8F0FE and the supplied unchanged official logo. Retain distinct accessible success/warning/danger colors. Build a compact professional operations interface with readable tables, clear forms, keyboard access and responsive layouts. Use Asia/Baku, AZN, English initially and centralized Azerbaijani/Russian translation dictionaries.

For an empty project, use the modular-monolith stack in the master: Next.js/TypeScript, PostgreSQL, Prisma Decimal/decimal.js, Zod, accessible components, table tooling and a durable background worker. Confirm supported stable package versions from official documentation at implementation time. Keep financial, decision, eligibility and workflow logic in shared server-side services. Implement actual persistence, migrations, seeded demo identities, server-side role/object access, audited mutations, atomic reservations, idempotent event handling, an outbox, durable jobs and visible retry/reconciliation failures. Every visible control must work within its stated demo scope or be explicitly disabled with a reason.

## Delivery order and proof

1. Inspect and briefly plan; record assumptions and screen/route inventory. Immediately build the first vertical slice: synthetic core projections, model/queue, automatic mock dialer, agent screen, valid outcome/PTP, suppression and mock posted payment reconciliation.
2. Complete the remaining P0 scope: dashboards from real seeded records, customer/loan views, promises, callbacks, payments, basic strategy/model/economics, team operations, imports, integration health, exceptions, settings, roles and audit.
3. Continue into the defined P1 governance/support/handover scope after P0 is stable. Track completed, partial, mocked and deferred work explicitly. Keep P2 deferred and document the actual inputs needed for a live pilot.

Run the master acceptance scenarios plus the CTI cases and the Part D workflow cases. Verify calculations, concurrent reservations, object access, contact suppression, required wrap-up, payment/reversal handling, replay safety and reporting reconciliation. Run available type checks, lint, integration tests and critical browser flows. Inspect rendered screens at desktop and narrower widths; fix clipping, inaccessible dialogs and lost call context. Report checks you actually executed and any execution limitations.

Deliver runnable source, migrations/seed, local setup commands, environment template without secrets, worker instructions, adapter/API contracts, mapping templates, policy/model examples, permissions, tests and screenshots. Maintain README, BUILD_STATUS.md, ASSUMPTIONS.md, MODEL_CARD.md, INTEGRATION_MAPPING.md, METRIC_DICTIONARY.md and DEMO_SCENARIOS.md. Keep unresolved production inputs visible without blocking a reversible synthetic demo. If context runs low, update BUILD_STATUS.md with exact next steps and a continuation prompt.

Demonstrate this complete journey: Ready -> automatic assignment -> correct customer and script -> verified conversation -> PTP -> save and wrap-up acknowledgment -> suppressed routine calls -> mock verified payment -> consistent promise/arrears/case/queue/dashboard updates -> duplicate event with no duplicate effect. Also demonstrate a failed-attempt retry and a blocked/stale-data case.

Begin implementation now. Use reasonable documented demo assumptions for routine missing inputs. Do not stop at a plan, a static dashboard or disconnected screens, and do not describe mocked or unfinished functionality as a live production integration.
