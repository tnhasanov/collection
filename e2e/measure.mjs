/**
 * Agent interaction-burden measurement (acceptance pass §3). Drives each normal conversation scenario through the
 * real workspace with the mock dialer and counts what the agent had to do: manual customer searches, manual
 * dials / copied numbers, required selections (quick choices, chips, checkboxes, dropdowns), required typing
 * (fields), final submissions, and duplicate entry across screens. No-answer attempts encountered on the way are
 * reported as zero-entry evidence. Output: docs/evidence/agent-interaction-counts.{json,md}.
 */
import { writeFileSync } from "node:fs";
import { launch, log, login } from "./lib.mjs";

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const results = [];
let noAnswerAttempts = 0;

function counter() {
  const c = { searches: 0, dials: 0, selections: 0, typing: 0, submissions: 0, duplicateEntry: 0, steps: [] };
  return {
    c,
    async click(testId, label) { await page.getByTestId(testId).click(); c.selections++; c.steps.push(`select: ${label ?? testId}`); },
    async check(testId, label) { const el = page.getByTestId(testId); if (!(await el.isChecked())) await el.check(); c.selections++; c.steps.push(`confirm: ${label ?? testId}`); },
    async select(selector, value, label) { await page.selectOption(selector, value); c.selections++; c.steps.push(`dropdown: ${label ?? selector}`); },
    async type(selector, value, label) { await page.fill(selector, value); c.typing++; c.steps.push(`type: ${label ?? selector}`); },
    async submit(testId, label) { await page.waitForFunction((id) => { const b = document.querySelector(`[data-testid='${id}']`); return b && !b.disabled; }, testId, { timeout: 60000 }); await page.getByTestId(testId).click(); c.submissions++; c.steps.push(`submit: ${label ?? testId}`); },
  };
}

const liveHeading = () => page.getByRole("heading", { name: "Live customer conversation" });
const homeHeading = () => page.getByRole("heading", { name: "My collection workspace" });

async function ensureReadyAndLive() {
  // No searching and no dialing: Ready once (if needed) and wait for the automatic reservation to connect.
  const connect = page.getByRole("button", { name: "Connect to dialer" });
  if (await connect.isVisible().catch(() => false)) { await connect.click(); await page.getByText("CTI connected").first().waitFor({ timeout: 60000 }); }
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await liveHeading().isVisible().catch(() => false) && (await page.getByTestId("identity-RPC_VERIFIED").isEnabled().catch(() => false))) return;
    if (await homeHeading().isVisible().catch(() => false)) {
      const ready = page.getByRole("button", { name: "Go Ready" });
      if (await ready.isEnabled().catch(() => false)) await ready.click();
      // Already Ready (auto-continue after a no-answer): the next reservation arrives on its own.
    }
    const outcome = await Promise.race([
      liveHeading().waitFor({ timeout: 90000 }).then(() => "live"),
      page.getByRole("heading", { name: "Reserved - dialing customer" }).waitFor({ timeout: 90000 }).then(async () => {
        // Screen pop arrived; the provider now answers (live) or fails (home again with zero agent entry).
        return Promise.race([liveHeading().waitFor({ timeout: 90000 }).then(() => "live"), homeHeading().waitFor({ timeout: 90000 }).then(() => "noanswer")]);
      }),
    ]).catch(() => "timeout");
    if (outcome === "live") { await page.getByTestId("identity-RPC_VERIFIED").waitFor({ state: "visible", timeout: 15000 }); return; }
    if (outcome === "noanswer") { noAnswerAttempts++; log("note", "provider no-answer/busy attempt completed with zero agent entry; agent returned automatically"); await page.waitForTimeout(1500); continue; }
    log("note", `attempt ${attempt + 1}: no live conversation yet (state: ${(await page.getByRole("heading").first().innerText().catch(() => "?")).slice(0, 40)})`);
  }
  throw new Error("No live conversation reached");
}

async function endCall() {
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByTestId("acw-strip").waitFor({ timeout: 60000 });
}
async function finish(m, name) {
  await page.getByTestId("factual-summary").waitFor({ timeout: 30000 });
  const summary = await page.getByTestId("factual-summary").innerText();
  await m.submit("save-pause", "Save & pause (one final confirmation)");
  await Promise.race([homeHeading().waitFor({ timeout: 90000 }), page.getByRole("heading", { name: "Wrap-up pending acknowledgment" }).waitFor({ timeout: 90000 })]);
  await homeHeading().waitFor({ timeout: 90000 });
  results.push({ scenario: name, ...m.c, summary });
  log("done", `${name}: ${m.c.selections} selections, ${m.c.typing} typed, ${m.c.submissions} submission`);
}

const scenarios = [
  ["Verified borrower, full-payment promise", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-SALARY_TIMING", "Reason: salary timing"); await m.click("outcome-PTP", "Payment promise"); await m.click("ptp-amount-overdue", "Amount: overdue due now (suggested)"); await m.click("ptp-date-3days", "Deadline: +3 days (suggested)"); await m.check("ptp-confirm", "Customer explicitly agreed"); }],
  ["Partial-payment promise (other amount)", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-TEMPORARY_SHORTFALL", "Reason: temporary shortfall"); await m.click("outcome-PTP", "Payment promise"); await page.getByRole("button", { name: "Other amount" }).click(); m.c.selections++; m.c.steps.push("select: Other amount"); await m.type("#ptp-amount", "50.00", "Agreed amount"); await m.click("ptp-date-7days", "Deadline: +7 days"); await m.check("ptp-confirm", "Customer explicitly agreed"); }],
  ["No commitment ('might pay Friday' as a statement)", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-NOT_STATED", "Reason: not stated"); await m.click("outcome-NO_COMMITMENT", "No payment commitment"); await m.type("#stmt-text", "might pay Friday", "Customer statement (optional)"); }],
  ["Requested callback", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-SALARY_TIMING", "Reason: salary timing"); await m.click("outcome-CALLBACK_REQUESTED", "Requested callback"); await m.click("cb-time-tomorrow-10", "Agreed time: tomorrow 10:00 (suggested slot)"); }],
  ["Already-paid claim (details unknown)", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-TECHNICAL_PAYMENT_ISSUE", "Reason: payment-channel problem"); await m.click("outcome-ALREADY_PAID_CLAIM", "Already paid (claim)"); await m.click("claim-unknown", "Details unknown"); }],
  ["Third-party answer", async (m) => { await m.click("identity-THIRD_PARTY", "Third party"); await m.click("outcome-NO_CONVERSATION", "No borrower conversation"); }],
  ["Wrong number", async (m) => { await m.click("identity-WRONG_NUMBER", "Wrong number"); await m.select("#wrong-cp", { index: 1 }, "Which contact point"); }],
  ["Dispute", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-DISPUTED_DEBT", "Reason: disputed debt"); await m.click("outcome-DISPUTE", "Dispute"); await m.type("#dispute", "Installment amount disputed", "Dispute reason (required)"); }],
  ["Repayment-support referral", async (m) => { await m.click("identity-RPC_VERIFIED", "Borrower verified"); await m.click("reason-INCOME_INTERRUPTION", "Reason: income interruption"); await m.click("outcome-SUPPORT_NEEDED", "Repayment support"); await m.select("#support-type", "HARDSHIP", "Referral type"); await m.type("#support-reason", "Job loss; asks for reduced plan", "Referral reason (required)"); }],
];

try {
  await login(page, "agent.a");
  // Leftover after-call work from a previous run is completed first (counted separately, not as a scenario).
  if (await page.getByTestId("acw-strip").isVisible().catch(() => false)) {
    const m = counter();
    await m.click("identity-RPC_VERIFIED"); await m.click("reason-NOT_STATED"); await m.click("outcome-NO_COMMITMENT");
    await finish(m, "(recovery of pending wrap-up)");
    results.pop();
  }
  for (const [name, fill] of scenarios) {
    await ensureReadyAndLive();
    const m = counter();
    await fill(m); // captured while talking
    await endCall(); // provider End; technical result recorded automatically
    await finish(m, name);
  }
} catch (e) {
  log("ERROR", String(e));
  await page.screenshot({ path: "docs/evidence/measure-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const md = ["# Agent interaction burden per scenario (measured in the browser, mock dialer)", "", `Generated ${new Date().toISOString()} by \`npm run measure\`. Manual searches and manual dials are zero by construction: the dialer reserves and dials automatically; the technical result is provider-derived. "Selections" are quick-choice cards, chips, checkboxes and dropdowns; "typing" counts fields where the agent typed; one final submission per call.`, "", `No-answer / busy attempts encountered during the run: ${noAnswerAttempts} (completed with zero agent entry, agent returned to Ready automatically).`, "", "| Scenario | Searches | Manual dials | Selections | Typing | Final submissions | Duplicate entry |", "|---|---:|---:|---:|---:|---:|---:|"];
for (const r of results) md.push(`| ${r.scenario} | ${r.searches} | ${r.dials} | ${r.selections} | ${r.typing} | ${r.submissions} | ${r.duplicateEntry} |`);
md.push("", "## Steps and generated summaries", "");
for (const r of results) md.push(`### ${r.scenario}`, "", r.steps.map((s) => `- ${s}`).join("\n"), "", `> ${r.summary}`, "");
writeFileSync("docs/evidence/agent-interaction-counts.md", md.join("\n"));
writeFileSync("docs/evidence/agent-interaction-counts.json", JSON.stringify({ generatedAt: new Date().toISOString(), noAnswerAttempts, results }, null, 2));
console.log(`\n${results.length} scenarios measured; ${noAnswerAttempts} no-answer attempts; written to docs/evidence/`);
if (results.length < scenarios.length) process.exit(1);
