/** Screenshots of the agent workspace in each state (home, reserved/dialing, live, after-call work, review) at two widths. */
import { BASE, launch, log, login } from "./lib.mjs";

const browser = await launch();
for (const width of [1440, 1024]) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  await login(page, "agent.a");
  const connect = page.getByRole("button", { name: "Connect to dialer" });
  if (await connect.isVisible().catch(() => false)) { await connect.click(); await page.getByText("CTI connected").first().waitFor({ timeout: 60000 }); }
  if (await page.getByText("After-call work").first().isVisible().catch(() => false)) {
    await page.getByTestId("identity-RPC_VERIFIED").click(); await page.getByTestId("reason-NOT_STATED").click(); await page.getByTestId("outcome-NO_COMMITMENT").click();
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='save-next']"); return b && !b.disabled; }, null, { timeout: 60000 });
    await page.getByTestId("save-pause").click();
    await page.getByText("My collection workspace").first().waitFor({ timeout: 60000 });
  }
  await page.screenshot({ path: `docs/screenshots/agent-home-${width}.png` });
  const ready = page.getByRole("button", { name: "Go Ready" });
  await ready.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Go Ready"); return b && !b.disabled; }, null, { timeout: 60000 });
  await ready.click();
  await page.getByText(/Reserved - dialing customer|Live customer conversation/).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: `docs/screenshots/agent-reserved-${width}.png` });
  await page.getByText("Live customer conversation").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `docs/screenshots/agent-live-${width}.png`, fullPage: true });
  // Capture facts during the call
  await page.getByTestId("identity-RPC_VERIFIED").click();
  await page.getByTestId("reason-SALARY_TIMING").click();
  await page.getByTestId("outcome-PTP").click();
  await page.getByTestId("ptp-amount-overdue").click();
  await page.getByTestId("ptp-date-3days").click();
  await page.getByTestId("ptp-confirm").check();
  await page.getByTestId("factual-summary").waitFor({ timeout: 30000 });
  await page.screenshot({ path: `docs/screenshots/agent-live-captured-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByTestId("acw-strip").waitFor({ timeout: 60000 });
  await page.getByTestId("factual-summary").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/agent-acw-${width}.png`, fullPage: true });
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='save-next']"); return b && !b.disabled; }, null, { timeout: 60000 });
  await page.getByTestId("save-pause").click();
  await page.getByText(/My collection workspace|Wrap-up pending acknowledgment/).first().waitFor({ timeout: 90000 });
  log("shot", `agent states @${width}`);
  await context.close();
}
await browser.close();
console.log("agent state screenshots written");
