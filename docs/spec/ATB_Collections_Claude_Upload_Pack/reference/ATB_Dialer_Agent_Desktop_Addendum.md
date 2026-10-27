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
