# UAT guide — controlled pilot (synthetic data, mock integrations)

Audience: collection head, team leads, agents and the integration operator taking part in the pilot. Everything runs
on synthetic customers and mock providers: no real call, SMS, payment or loan change can happen. Default UI language
is Azerbaijani; switch to English or Russian from the topbar.

## 0. Before you start

| Step | Who | How |
|---|---|---|
| Receive your personal identity | everyone | The coordinator reads the one-time passwords from the deploy log (Render → Logs, block "One-time temporary passwords"; identities are defined in `pilot-users.json`) and hands you your username and password privately. |
| First sign-in | everyone | `/login` → enter username and the temporary password → set a personal password (10+ characters, letter and digit). |
| Check the environment | coordinator | `/api/health/ready` returns `ok: true` with `checks.worker.online: true`; the topbar shows `PİLOT · sintetik` and no "Worker offline" badge. |

## 1. Agent shift (agents, 20 minutes)

1. Open **Mənim panelim** (`/agent`): today's workload, due callbacks (callable now, or the restriction and the time
   it ends), promises needing attention and your results. Click **Zənglərə başla** to open **Cari zəng**
   (`/agent/call`), click **Dialerə qoşul**, then **Hazır ol**. Nothing is assigned until the provider confirms Ready.
2. Wait for the automatic reservation. Expected header: name, CIF, overdue, DPD, "Məlumat aktualdır" (click for
   details), the call status with a timer, **Sınaq telefoniyası** (mock telephony: no real call is placed), the call
   controls and, separated on the right, **Fasilə** / **Növbəni bitir**.
3. Follow the conversation on the left: **Şəxsiyyət** → **Səbəb və müzakirə** → **Nəticə və təsdiq**. Finished
   stages collapse into a one-line summary with **Dəyiş**. Nothing is preselected.
   - **Ödəniş vədi** → **Başqa məbləğ** (e.g. 137.50) and **Başqa tarix**. Expected: the confirmation passage of the
     script shows exactly that amount and date; a partial amount shows how much stays overdue; tick the agreement
     only after the customer agrees. Changing the amount, date or loans removes the tick with a notice.
   - Reload the page (F5) or open **Təqib işləri** and come back with **Zəngə qayıt**. Expected: same stage, same
     custom amount/date, agreement still ticked.
   - **Geri zəng tələbi**: time shortcuts or another time; **Artıq ödənilib (iddia)**: claim details (a claim is not a
     verified payment).
   - **Üçüncü şəxs**: no debt details; only "Söhbət olmayıb" or "Xüsusi hal". Switching back to "Borcalan
     təsdiqləndi" restores the earlier answers.
4. **Yadda saxla və davam et** stays disabled while the call is live. **Zəngi bitir** → after-call work →
   **Təfərrüat** shows the full summary → save. The next customer comes only after the provider acknowledges the
   wrap-up. If an End is not confirmed, the header shows **Yenidən bitir** and **Zəngin vəziyyətini yoxla**; the call is
   never closed by a timeout.
5. Overdue cleared during a call: the coordinator posts a verified payment for the full overdue from `/payments`.
   Expected: a success banner, "Ödəniş vədi" is disabled and **Gecikmə bağlanıb** is offered.
6. **Təqib işləri**: callbacks, promises, tasks and failed contacts in one list, overdue and due-today first, each with
   the next step or the restriction that applies now and when it ends.

## 2. Team lead (15 minutes)

1. Sign in → **Əsas səhifə** (`/home`): "Qərarımı gözləyir" lists promise-date exceptions, death reports to verify,
   calls the provider did not end and failed wrap-ups; team-now and today's attributed cash (rule ATTRIB-1).
2. **Təsdiqlər**: open a `PTP exception`, read the rationale, **Approve** or **Reject** with a note. Expected: on
   approval a promise appears for the agent (reminder scheduled); on rejection the agent gets a notification. Your own
   requests cannot be approved by you.
3. **İstisnalar** → `DECEASED_VERIFICATION` → **Confirm death report** / **Not confirmed** with a note. Expected:
   confirmation cancels promises and withdraws work; rejection returns the customer to the process.
4. **Komanda əməliyyatları**: live monitor with provider-confirmed states; for an open call whose End was refused,
   **Force end call** with a reason moves it to after-call work and resolves the exception.
5. Scope check: open `/customers/<id>` of a customer handled only by another team's agent as a lead (allowed) and
   ask an agent to open the same link (expected: access denied, audited).

## 3. Collections head (10 minutes)

1. `/home`: portfolio totals, pending approvals by type, outbound controls.
2. `/analytics?tab=agents`: attributed cash per agent equals the team grid and the agents' own dashboards (same
   ATTRIB-1 rows); export CSV.
3. `/settings`: review the draft policy values (`promise.policy`, `reminders.sendTimeBaku`,
   `attribution.windowDays`, `access.scopedHistoryDays`) and note the ones to confirm with the bank.

## 4. Integration operator / admin (10 minutes)

1. `/integrations`: outbox, dead letters, worker heartbeat with provider capabilities.
2. `/payments`: simulator — search any active loan (CIF, loan id, name), post a verified payment, a late value date,
   a claim-only, a replay (expected DUPLICATE) and a reversal (expected attribution removed).
3. `/audit`: filter by `special_case.confirmed`, `call.force_ended`, `auth.login.failed`, `payment.attributed`.

## 5. What to record

For each step: tester, time (Baku), expected vs observed, screenshot if different. Known limits: no real provider,
transfer unsupported, management screens partly English, roll/cure matrices need two daily runs. Report in the
pilot channel with the customer id and correlation id shown to leads in the diagnostics line.
