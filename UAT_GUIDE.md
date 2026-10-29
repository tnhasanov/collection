# UAT guide — controlled pilot (synthetic data, mock integrations)

Audience: collection head, team leads, agents and the integration operator taking part in the pilot. Everything runs
on synthetic customers and mock providers: no real call, SMS, payment or loan change can happen. Default UI language
is Azerbaijani; switch to English or Russian from the topbar.

## 0. Before you start

| Step | Who | How |
|---|---|---|
| Receive your personal identity | everyone | The pilot coordinator runs `npm run pilot:users` and hands you a username and a one-time password privately. |
| First sign-in | everyone | `/login` → enter username and the temporary password → set a personal password (10+ characters, letter and digit). |
| Check the environment | coordinator | `/api/health/ready` returns `ok: true` with `checks.worker.online: true`; the topbar shows `PİLOT · sintetik` and no "Worker offline" badge. |

## 1. Agent shift (agents, 20 minutes)

1. Open **Mənim panelim** (`/agent`), click **Dialerə qoşul**, then **Hazır ol**. Expected: the header chip shows the
   provider-confirmed state and the time in state; nothing is assigned until the provider confirms Ready.
2. Wait for the automatic reservation. Expected: the header shows the customer in one line (name, CIF, language,
   loans, DPD, overdue amount) with the chips **Məlumat aktualdır** and **Əlaqəyə icazə var**, the call chip changes
   from "Zəng edilir" to "Bağlantı var" with a timer; the script opens at reading size; **Cavablar** open when the
   customer is connected.
3. Capture during the call: who is speaking → reason → outcome. Try each of these:
   - **Ödəniş vədi** with a date within 30 days: pick a suggested amount and date, tick the explicit confirmation.
     Expected: the sticky bar shows the factual summary and "Saxlanılacaq nəticə".
   - A date **beyond 30 days** ("Başqa tarix"): expected warning "Bu tarix vəd siyasətindən kənardır …" with the
     button **İstisna təklifi kimi qeyd et**; after clicking, the outcome becomes "Siyasətdən kənar tarix (istisna)".
   - **Ödəniş təlimatı** tab → **Ödəniş təlimatını göndər** (only after "Borcalan təsdiqləndi"). Expected: toast with
     segment count and estimated cost; the message appears under "Son mesajlar".
   - **Əlaqəli şəxslər** tab: expected roles, verification and "Kredit məlumatı verilmir: yalnız mesaj" where
     disclosure is not allowed.
4. Call controls: **Səssiz** / **Gözlətmə** show "…" while pending and settle when the provider confirms. **Zəngi
   bitir** ends the call. Expected: after-call work with the timer; one **Yadda saxla və növbəti zəng** or **Yadda
   saxla və fasilə**; the next call is blocked until the wrap-up is acknowledged.
5. Overdue cleared during a call: the coordinator posts a payment for your current customer from `/payments`
   (simulator, "POST verified payment" for the full overdue). Expected: a success banner "Gecikmə bağlanıb…"; the
   outcome **Gecikmə bağlanıb** appears and no promise is required.
6. Death report: on a third-party answer choose **Xüsusi hal** → "Vəfat barədə məlumat", pick who reported it.
   Expected: saved as reported (not confirmed); routine contact stops; a lead sees a verification item.
7. **Təqib işləri**: callbacks, promises with reminder status (scheduled / sent / delivered), tasks and failed
   contacts (retried centrally, nothing to redial).

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
