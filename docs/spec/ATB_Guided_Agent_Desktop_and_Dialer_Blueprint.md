# ATB Collections - guided agent desktop and dialer integration

Prepared for Tural Hasanov | 28 October 2026

## Purpose and recommendation

Design the normal agent job as: become Ready, receive an automatically assigned customer, read a prepared conversation guide, talk, record a small set of observed/customer-stated facts, and confirm one structured outcome. The application determines the subsequent treatment and scheduling under the bank's policy.

For ATB's initial small-team scenario, use progressive dialing with an agent reservation. Add supported voice auto-accept or an equivalent supported agent connection mode after capability testing. Present a guided workspace and conditional outcome cards. Make technical call data automatic. Use deterministic rules and templates for P0. Evaluate more aggressive pacing and AI assistance separately after measuring the operating results.

This is a proposed implementation refinement to the existing master, especially S28 and Parts C/D. Preserve its core-banking, annuity, Prometeia, contact-policy, access, audit and payment rules. The current Orange application/platform has not been identified precisely. No live telephony integration or new production policy is claimed here.

## 1. What a dialer does

A softphone is the agent's calling client. A PBX/voice platform connects and routes calls. An outbound dialer adds campaign execution, pacing and assignment. A contact-center platform may combine these functions. Their exact boundaries depend on the product and configuration.

The conceptual sequence is: authorize an eligible customer attempt, obtain available voice capacity, place the customer call through the configured carrier, determine the technical result, connect it to the reserved/selected agent, and publish call lifecycle events. Voice remains in the supported telephony path. CTI (computer-telephony integration) exchanges call control, identifiers and state with the collection application.

| Mode | Basic behavior | ATB design judgment |
|---|---|---|
| Preview | Agent sees a record and initiates the call, sometimes after a configured timer | Useful for exceptional cases needing preparation |
| Progressive | Automatically calls against available agents, with reservation available in some products | Recommended starting mode with one reserved agent/customer |
| Power | Can dial multiple contacts per available agent | Assess later against contact quality and capacity |
| Predictive | Anticipates availability and can dial while agents are still occupied | Assess only after sufficient data and a suitable agent pool |

Genesys documents these distinctions and an agent-reservation option for progressive mode. Its guidance recommends at least 15 agents per predictive campaign for reliable prediction; this is Genesys-specific guidance rather than a universal threshold. [S1]

Answer/machine analysis can help route attempts, but an answered line, detected human voice or an agent bridge does not prove borrower identity. Treat technical answer, agent-connected conversation and verified right-party contact as separate facts.

## 2. What each system owns

| Owner | Authoritative responsibilities |
|---|---|
| Core banking | Contract, schedule, balances, posted payment allocations, DPD and loan status |
| Collections | Customer case, priority, treatment, contact eligibility, promises, callbacks, referrals, next action and operational history |
| Voice provider | Actual call legs, agent availability, connection events, technical outcomes and supported controls |
| CTI adapter | Trusted correlation, provider commands/events, normalization, capability flags and reconciliation |
| Agent | Approved identity verification, meaningful conversation observations and explicit customer statements/agreements |

Collections authorizes who can be called and when. The provider executes the authorized work using its supported routing mode. The agent does not choose portfolio priority or a retry delay during ordinary work. The browser does not independently enforce restrictions or initiate duplicate calls.

## 3. A smooth normal interaction

1. **Ready once at shift start.** Sign in, map the extension/provider identity, load authorized queues, establish the supported audio session and confirm the ability to save outcomes. Show actual confirmed readiness. A browser heartbeat alone does not prove the headset/audio works.
2. **Reserve and prepare automatically.** Select an eligible customer under the approved priority, language and seniority rules. Reserve the agent and customer. Fetch the customer summary, fresh amounts, prior contact, active promise and published script.
3. **Confirm usable context.** Where provider integration permits it, acknowledge that the correct workspace is loaded before authorizing the dial. If this timing is unsupported, document and test the alternative so a connected customer is not left with an unprepared agent. A failed/mismatched context load must have an effective pause/recovery route.
4. **Place the call automatically.** Recheck current eligibility immediately before execution. Use supported agent auto-accept or an equivalent supported voice-session arrangement if available, with the appropriate configured agent cue/whisper. Measure actual connection behavior; do not assume Orange supports it.
5. **Guide the conversation.** Show the current script step and only relevant quick choices. The agent records verified identity and customer-stated information while talking. Autosave drafts without treating them as final commitments.
6. **End and review.** Enter After-call work (ACW) on confirmed call end. Most fields are already captured. Display the structured outcome and derived next action for review.
7. **Save once.** `Save & next call` validates and persists the business result and required restrictions/tasks, synchronizes provider wrap-up and confirms readiness. The next eligible call then routes automatically. `Save & pause` supports breaks and exceptions.

Providers already implement comparable building blocks: Amazon Connect documents contact-start screen pops, branching guides, voice auto-accept and post-contact disposition forms. These are evidence for the interaction pattern, not a recommendation that ATB must buy Amazon Connect. [S2-S5]

Reserve an agent against both outbound and blended inbound availability. A reserved agent cannot also be counted as free for an inbound call. Cancel/reconcile a lost reservation correctly; a browser timeout alone is insufficient evidence that an active call ended.

## 4. The single conversation workspace

| Area | Content and behavior |
|---|---|
| Persistent call strip | Confirmed state, customer/case reference, elapsed time, audio/CTI health and supported hold/mute/end/transfer controls |
| Left: facts | Customer and language, all eligible loans, overdue due now with component split, DPD, next installment, last verified payment, previous outcome, active promise and restrictions |
| Center: guide | Current published script step and bound amounts/dates; expandable schedule/history; clear route for special handling |
| Right: responses | Small quick-choice cards, conditional fields and draft-save state |
| Bottom: review | Generated factual summary, next action/contact eligibility, `Save & next call`, `Save & pause` |

Use ATB assets and palette already supplied. Keep the active conversation on one page. Show full details through drawers/tabs when needed. Keep the summary stable and visible; alerts for a new payment or restriction must be conspicuous.

Label monetary concepts clearly. Overdue amount due now differs from outstanding principal and from a settlement quote. An annuity installment is already split between interest and principal; do not add overdue principal to principal outstanding again. The agent reads authoritative amounts rather than calculates or edits them.

No routine copying of phone numbers, searching for the assigned borrower, opening a separate loan record, retyping balances, setting retry dates, or entering the same disposition in two applications should be required.

## 5. Structured conversation tree

Use quick buttons for frequent answers and a searchable dropdown for longer lists. Keep options stable and keyboard accessible. Avoid a flat dropdown containing dozens of mutually overlapping codes.

### Step A - establish who is speaking

| Choice | Result |
|---|---|
| Borrower identity verified under the approved procedure | Continue with debt-specific conversation |
| Third party | Privacy-preserving script; no verified borrower contact |
| Verification incomplete/failed | Appropriate script and follow-up; no verified borrower contact |
| Wrong person/number | Evidence-based contact correction; block the affected contact point as appropriate |

`Verified` must require the bank's actual approved procedure, rather than a provider answer event or a phone-number match. No answer is preselected. Authorized agents can view necessary internal facts, while customer-facing disclosure scripts remain gated by verification.

### Step B - record the customer's explanation when stated

Examples: salary not yet received; temporary cash shortfall; income interruption; forgot; payment-channel problem; debt/payment disputed; other; not stated/declined.

Record these as customer statements with provenance. Do not make the agent choose labels such as honest/dishonest, difficult, good/bad customer, high risk or likely to pay. Do not force an invented explanation to satisfy a required field. `Other` can require a short factual note.

### Step C - record the agreed outcome

| Quick choice | Additional information |
|---|---|
| Payment promise | Explicitly agreed amount, date/deadline and covered obligations; full/partial coverage is derived against current obligations |
| Requested callback | Agreed time window, valid contact and any required owner; system checks policy |
| Already paid | Claimed date, amount/channel/reference where supplied; reconciliation route |
| No payment commitment | Applicable neutral subreason, including not stated |
| Dispute | Dispute category and referral fields required by policy |
| Repayment support | Appropriate support/referral fields; no unapproved contract variation |
| Customer declines discussion | Factual outcome and policy-derived follow-up |

Keep identity status, reason and outcome separate. Permit independent referral/dispute flags when appropriate so that selecting a primary outcome does not erase other facts.

Dates and amounts may be suggested from approved options or existing data, but a promise must be explicitly confirmed as the customer's actual agreement. A prefilled installment and a clicked date are not automatically an agreed PTP. Configure allowed commitment options and exceptions; the agent cannot freely waive fees, restructure a loan or change the repayment schedule.

### Step D - review the generated summary

Generate the routine summary deterministically from the selected facts. Example synthetic wording:

> Borrower verified. Customer reported salary delay. Agreed payment: 499.24 AZN by 30 October 2026. Payment pending verification. Next action: monitor promise under the active contact policy.

Show the provenance of statements and verified financial data. Avoid turning a paid claim into a verified payment in generated text. Notes are optional by default, with short factual details required only for defined exceptions/referrals.

### Step E - confirm once

One final save commits the outcome and next-action effects. Autosaving a draft cannot silently submit an agreement. Do not preselect PTP, verified identity or a positive result merely to reduce clicks. If saving or provider acknowledgment fails, preserve the draft and hold the agent outside the next-call pool.

## 6. Minimize judgment through clear data ownership

| Data class | Examples | Capture/control |
|---|---|---|
| Provider-observed | Dial/ring/connect/end timestamps, busy/no answer, duration, provider call IDs | Automatic; preserve raw source and auditable corrections |
| Bank-verified | Balances, DPD, installment schedule, posted payments | Imported from core, with source/as-of information |
| Customer-stated | Reason, paid claim, payment date/amount agreement, requested callback | Structured agent capture; explicitly label provenance |
| Policy-derived | Priority, restrictions, retry, next permissible contact, reminder/task routing | Versioned server-side rules |
| Authorized exception | Approved override/correction/referral action | Named permission, reason and append-only history |

The agent's ordinary role is to verify and record, with enough room for a truthful unknown or exceptional case. An unanswered technical attempt can normally complete with zero agent data entry. For a simple connected call, aim for a small set of choices and one final confirmation; a PTP adds its necessary amount/date confirmation. Treat this as a product-design goal and measure the actual interaction burden.

Hold calibration reviews in which two reviewers classify the same permitted sample of calls. Disagreements reveal ambiguous definitions and training needs. Improve the dictionary rather than force confidence in uncertain observations. Automated transcripts or suggestions, if added later, require confirmation and an evidence trail; they must not silently establish identity, payment, intent or agreement.

## 7. Every outcome must drive the application

| Event/outcome | Automatic consequence |
|---|---|
| Busy/no answer, reliable provider result | Record attempt and schedule only an eligible retry |
| Wrong number | Apply contact-point suppression/correction, retaining customer history |
| Verified conversation | Apply the approved customer-wide successful-contact controls |
| Valid PTP | Create/update promise and permitted reminders; protect under policy |
| Requested callback | Schedule eligible callback with ownership/fallback |
| Already-paid claim | Reconciliation task and approved temporary hold |
| Dispute/support | Owned specialist task and appropriate handling restriction |
| Posted payment | Refresh authoritative financial projection, reassess case/PTP and withdraw obsolete queued outreach |
| Partial payment | Update the remaining obligations and promise independently; cure only when the defined arrears condition is met |
| Reversal | Reconcile/reopen applicable derived states with history |

Retain the master's proposed minimum successful-contact cooldown and PTP protection, without treating demo conventions as approved production rules. All channels, campaigns, alternate numbers and controlled manual calls use the same central eligibility service.

An outcome label alone does not enforce calling restrictions. Genesys documents that wrap-up mappings affect contact/number callability, and that changing a wrap-up later does not rerun those mapping actions. Its system outcomes can also be retried on campaign recycle. Therefore explicitly test provider recycle, recall, callback and corrected-disposition behavior. Temporary bank-policy holds need timed release/re-evaluation; they must not be confused with a permanent contact prohibition. [S6-S7]

## 8. Practical integration contract

Use the existing modular services and provider adapter. Keep the business workflow portable and expose capabilities rather than pretend all providers behave alike.

Minimum identifiers: customerId, caseId, workItemId, reservationId, interactionId, agentId/provider identity, provider call/leg IDs, contact-point ID and model/policy/script versions. Never use a phone number alone to identify a case.

Minimum operations: get capabilities; get/set confirmed agent state; authorize/reserve/dispatch; withdraw/cancel eligible queued work; supported call controls; submit/reconcile wrap-up; look up an active interaction; reconcile events after reconnect. Push normalized state to the frontend through the established SSE/WebSocket mechanism. Keep provider credentials on the server or in supported short-lived client sessions.

Persist an outcome, restriction/task changes and an outbox record in one application transaction. Process provider effects reliably, then require acknowledgment or a defined reconciled terminal state before returning to Ready. A timeout means an uncertain command, not permission to submit a duplicate call. Do not implement a distributed database transaction across an external PBX.

A small recently authorized work window with revalidation is preferable to an unmanaged daily Excel dial list. Where a provider requires campaign lists, use supported callable-state/rule/withdrawal mechanisms and reconcile their actual effect. If the selected integration cannot reliably stop an obsolete payment-suppressed call, record a concrete pilot capability gap.

Preferred interface: supported provider voice controls embedded in the ATB workspace. Alternative: keep the supported Orange/other voice client and use CTI to control/observe it while the agent works in ATB Collections. Another supported option is embedding ATB's workspace in the provider's agent desktop. One primary user workspace does not require deleting every supporting telephony session.

Provider notes reviewed for this design:

- **3CX:** documented REST call controls and WebSocket events can support a custom integration. The current guide specifies an 8SC+ AI license for Call Control. Validate reservation, automatic distribution, wrap-up gating and suppression in the actual deployment; API access alone is not proof of those end-to-end behaviors. [S8]
- **VICIdial:** the Agent API exposes pause/resume, disposition and hangup functions. Functions operate against an agent session, and several require a logged-in agent interface. Validate the supported session/embedding approach before attempting a custom headless replacement. [S9]
- **Orange:** identity/platform/version and licensed CTI capabilities remain unknown. Obtain actual API/event documentation and prove a small interaction before deciding to retain or replace it.

## 9. Acceptance tests and pilot measures

Add these to the existing master/CTI scenarios:

1. An agent becomes Ready once and receives the automatic call cycle without searching, copying a number or re-entering an outcome elsewhere.
2. A correct workspace/script is available at the required connection point; failed loads and mismatches trigger the documented recovery.
3. A reliable no-answer result completes without invented agent input, RPC or PTP.
4. Identity status is unselected until verified and a shared number cannot load the wrong customer's case.
5. Only relevant response fields appear; required fields are enforced server-side and invalid defaults cannot create a promise.
6. `Not stated` is accepted where appropriate; reason and business outcome remain distinct.
7. The factual summary distinguishes customer statements from verified financial data and exactly matches stored fields.
8. A partially fulfilled/kept partial promise can coexist with residual arrears; the UI and next action remain consistent.
9. A later outcome correction re-evaluates bank policy and reconciles provider callability explicitly.
10. Campaign recycle, recall, alternate numbers, scheduled callbacks and manual actions cannot bypass a current restriction.
11. Payment immediately before dispatch prevents or reconciles obsolete work; payment during a call updates context without automatically hanging up.
12. Saving twice or replaying an event does not duplicate the promise, next action, attempt, payment credit or metric.
13. Required wrap-up cannot expire into an unsaved Ready state; browser refresh and connection loss recover the active call/draft.
14. Reserved outbound agents cannot simultaneously receive blended inbound work; break requests take effect after required wrap-up.

Measure manual searches/dials per normal interaction, selections/typing burden, workspace-ready timing and p95 screen-pop delay, customer connection delay/abandonment, ACW time, unsaved outcomes, provider synchronization failures, classification disagreement and contact-control violations. Track these alongside verified cash, matured kept PTPs, cohort cure/roll outcomes and customer-treatment quality. Set time targets through the pilot; the fewest clicks or shortest calls alone are insufficient evidence of a better collection process.

## 10. Instruction to Claude Code for the running project

Apply this blueprint as a refinement of the current ATB Collections implementation, especially S28 and Parts C/D of the master. Preserve existing working architecture, financial logic, Prometeia boundaries, access controls, contact rules and mock-provider defaults. Continue the existing build rather than restart it.

Implement the guided sequence: confirmed Ready -> reserved agent/customer -> trusted customer/script context -> automatic progressive dial/connection -> identity verification -> customer-stated reason where applicable -> structured outcome -> conditional promise/callback/referral fields -> deterministic factual summary and next-action preview -> one final save -> provider wrap-up acknowledgment -> confirmed Ready or pause.

Use quick-choice buttons for frequent options and dropdowns for longer lists. Capture provider technical results automatically. Remove duplicate entry and routine manual searching/dialing. Keep Unknown/Not stated honest. Do not default identity, a PTP or a positive outcome merely to reduce clicks. Prepopulate bank facts, not unconfirmed customer agreements.

Support voice auto-accept only through the actual provider's supported mechanism. The mock must demonstrate the intended experience. Maintain capability flags and document gaps for Orange/other real providers. No live calls, production integration or provider purchase is authorized.

Keep the live call on one page with facts left, script center, responses right and persistent call controls. Save recoverable drafts during conversation. One `Save & next call` action validates and commits the result and derived policy effects, synchronizes the provider and confirms readiness. Saving, pending wrap-up, stale critical data or uncertain provider state must not silently authorize a new call.

Implement and run the acceptance cases in this blueprint. Demonstrate one normal PTP call, a zero-entry no-answer attempt, a wrong-number flow, a paid-claim reconciliation and a payment/cooldown suppression case. Record actual checks, interaction steps/clicks and limitations in BUILD_STATUS.md and the handover. Do not weaken rules or fabricate confirmed outcomes to make the happy path faster.

## Sources

Official technical sources reviewed 28 October 2026. Public capabilities are examples, not proof of ATB deployment compatibility. Most of this document is the proposed ATB operating and UI design; the vendor-specific claims are identified above.

- [S1: Genesys - dialing modes](https://help.genesys.cloud/articles/dialing-modes/)
- [S2: Amazon Connect - contact-start context/screen pop](https://docs.aws.amazon.com/connect/latest/adminguide/display-contact-attributes-sg.html)
- [S3: Amazon Connect - step-by-step guides](https://docs.aws.amazon.com/connect/latest/adminguide/step-by-step-guided-experiences.html)
- [S4: Amazon Connect - auto-accept](https://docs.aws.amazon.com/connect/latest/adminguide/enable-auto-accept.html)
- [S5: Amazon Connect - disposition codes after contact](https://docs.aws.amazon.com/connect/latest/adminguide/disposition-codes-sg.html)
- [S6: Genesys - wrap-up mapping and callability](https://help.genesys.cloud/articles/use-wrap-up-codes-with-outbound-dialing/)
- [S7: Genesys - system-assigned outbound wrap-ups](https://help.genesys.cloud/?p=90605)
- [S8: 3CX - Call Control API](https://www.3cx.com/docs/call-control-api/)
- [S9: VICIdial - Agent API](https://www.vicidial.org/docs/AGENT_API.txt)
