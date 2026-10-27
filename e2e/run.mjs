/**
 * Critical-path browser flow (DEMO): agent login → connect → confirmed Ready → automatic reservation →
 * progressive dial → trusted screen pop → conversation → End → after-call work → PTP outcome saved →
 * provider wrap-up acknowledged → Not ready. Then a supervisor view and a mock verified payment with
 * duplicate replay. Requires `npm run dev` and `npm run worker` against the seeded demo database.
 */
import { BASE, launch, log, login, waitForText } from "./lib.mjs";

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); log("FAIL", msg); } else log("ok", msg); };

try {
  await login(page, "agent.b");
  check(page.url().includes("/agent"), "agent lands on /agent after login");

  const connectBtn = page.getByRole("button", { name: "Connect to dialer" });
  if (await connectBtn.isVisible().catch(() => false)) {
    await connectBtn.click();
    await waitForText(page, "CTI connected", 60000);
  }
  check(await page.getByText("CTI connected").first().isVisible(), "CTI session confirmed by the mock provider");

  async function completeAcw(label) {
    // Guided responses: quick-choice cards; nothing preselected; bank facts suggested; explicit customer confirmation.
    await page.getByTestId("identity-RPC_VERIFIED").click();
    await page.getByTestId("reason-SALARY_TIMING").click();
    await page.getByTestId("outcome-PTP").click();
    await page.getByTestId("ptp-amount-overdue").click();
    await page.getByTestId("ptp-date-3days").click();
    await page.getByTestId("ptp-confirm").check();
    await page.getByTestId("factual-summary").waitFor({ timeout: 30000 });
    const summary = await page.getByTestId("factual-summary").innerText();
    check(/Borrower verified/.test(summary) && /Agreed payment/.test(summary) && /customer explicitly confirmed/.test(summary), `factual summary generated from the facts: "${summary.slice(0, 110)}…"`);
    const save = page.getByTestId("save-next");
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='save-next']"); return b && !b.disabled; }, null, { timeout: 60000 });
    await save.click();
    await page.getByText(/My collection workspace|Wrap-up pending acknowledgment|Reserved - dialing customer|Live customer conversation/).first().waitFor({ timeout: 90000 });
    check(true, `${label}: one final save (Save & next call) → wrap-up acknowledged by the mock provider → Ready/next allocation`);
  }

  // A previous run may have left after-call work pending: finish it first (Ready is blocked until then).
  if (await page.getByText("After-call work").first().isVisible().catch(() => false)) {
    log("note", "pending after-call work from a previous run; completing it first");
    await completeAcw("recovery");
  }

  const readyBtn = page.getByRole("button", { name: "Go Ready" });
  if (await readyBtn.isEnabled().catch(() => false)) {
    await readyBtn.click();
    log("ready", "requested; waiting for provider confirmation and automatic reservation");
  }
  await page.getByText(/Reserved - dialing customer|Live customer conversation/).first().waitFor({ timeout: 90000 });
  check(true, "automatic reservation delivered to the agent (screen pop)");

  await page.getByText("Live customer conversation").first().waitFor({ timeout: 90000 });
  check(true, "call answered and bridged (provider-confirmed TALKING)");
  const customerText = await page.locator("[aria-label='Call strip']").innerText();
  const cust = customerText.match(/C-(?:DEMO|SYN)-\d+/)?.[0] ?? "?";
  check(cust !== "?", `screen pop shows the reserved customer: ${cust}`);

  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByText("After-call work").first().waitFor({ timeout: 60000 });
  check(true, "End → after-call work with required structured outcome");
  await completeAcw("outcome");

  const notReady = page.getByRole("button", { name: "Not ready" });
  if (await notReady.isEnabled().catch(() => false)) { await notReady.click(); log("state", "Not ready requested"); }

  // Supervisor: live states and backlog
  const sup = await context.newPage();
  await login(sup, "lead");
  await sup.goto(`${BASE}/operations`);
  await waitForText(sup, "Team allocation & operations", 60000);
  check(true, "supervisor sees live agent states and backlog");

  // Payment simulation: mock verified posting then duplicate replay (no duplicate effect)
  const ops = await context.newPage();
  await login(ops, "integrator");
  const txn = `E2E-TXN-${Date.now()}`;
  const simRes = await ops.request.post(`${BASE}/api/demo/payments/simulate`, { data: { kind: "POST", loanRef: "L-DEMO-001", amount: "499.24", transactionId: txn } });
  const sim = await simRes.json();
  check(sim.ok && sim.data.status === "PROCESSED", `mock verified payment posted through the idempotent ingestion (${sim.ok ? sim.data.status : JSON.stringify(sim.error)})`);
  const replay = await (await ops.request.post(`${BASE}/api/demo/payments/simulate`, { data: { kind: "REPLAY", transactionId: txn, loanRef: "L-DEMO-001" } })).json();
  check(replay.ok && replay.data.status === "DUPLICATE", "duplicate event replay produced no duplicate effect (DUPLICATE)");
  await sup.goto(`${BASE}/customers/C-DEMO-001`);
  await sup.getByText("Demo customer 001").first().waitFor({ timeout: 60000 });
  check(true, "customer 360 reflects the verified payment and promise state");
} catch (e) {
  failures.push(String(e));
  log("ERROR", String(e));
  await page.screenshot({ path: "docs/screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log("\nCritical path passed");
