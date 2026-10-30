/**
 * Agent workspace redesign journey (synthetic data, mock telephony) with screenshots in docs/screenshots/redesign:
 *   dashboard → call workspace → Ready → live call → identity → reason → custom promise (amount/date) → the script,
 *   fields and bottom summary agree → reload restores the custom values and the explicit agreement → follow-ups page
 *   shows the return-to-call indicator and live blockers → back to the call with the draft intact → End → after-call
 *   work → save. Measures page height, decision/script font sizes and that the sticky bar never covers a focused input.
 * Prerequisites: web app on APP_URL (default http://localhost:3000) and the worker against the demo database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, launch, log, login } from "./lib.mjs";

const OUT = "docs/screenshots/redesign";
mkdirSync(OUT, { recursive: true });
const report = { checks: [], measurements: {} };
const check = (name, ok, detail = "") => {
  report.checks.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}`, detail);
};
const shot = (page, name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const enabled = (page, testId, timeout = 60000) => page.waitForFunction((id) => { const b = document.querySelector(`[data-testid='${id}']`); return b && !b.disabled; }, testId, { timeout });
const isoAdd = (iso, d) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const azDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const px = (sel) => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
    return {
      pageHeight: document.documentElement.scrollHeight,
      viewport: `${innerWidth}x${innerHeight}`,
      horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
      choiceFont: px(".choice"),
      chipFont: px(".chip"),
      scriptFont: px(".script-passage"),
      titleFont: px(".page-title"),
      bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      buttonHeight: (() => { const b = document.querySelector("[data-testid='save-next']") ?? document.querySelector(".btn"); return b ? Math.round(b.getBoundingClientRect().height) : null; })(),
    };
  });
  report.measurements[label] = m;
  log(`measure ${label}`, JSON.stringify(m));
  return m;
}

/** The focused input must be fully visible above the sticky bottom bar. */
async function notCovered(page, testId) {
  const el = page.getByTestId(testId);
  // Focusing an element that already has focus does not scroll it; start from an unfocused page like a user would.
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await el.focus();
  await page.waitForTimeout(250);
  return page.evaluate((id) => {
    const input = document.querySelector(`[data-testid='${id}']`).getBoundingClientRect();
    const bar = document.querySelector(".slim-bar")?.getBoundingClientRect();
    return { inputBottom: Math.round(input.bottom), barTop: bar ? Math.round(bar.top) : null, ok: !bar || input.bottom <= bar.top };
  }, testId);
}

async function finishLeftovers(page) {
  // An earlier run may have left after-call work open; complete it so the shift starts from Ready.
  if (await page.getByTestId("acw-strip").isVisible().catch(() => false)) {
    if (await page.getByTestId("identity-RPC_VERIFIED").isVisible().catch(() => false)) await page.getByTestId("identity-RPC_VERIFIED").click();
    if (await page.getByTestId("reason-NOT_STATED").isVisible().catch(() => false)) await page.getByTestId("reason-NOT_STATED").click();
    if (await page.getByTestId("outcome-NO_COMMITMENT").isVisible().catch(() => false)) await page.getByTestId("outcome-NO_COMMITMENT").click();
    await enabled(page, "save-pause");
    await page.getByTestId("save-pause").click();
    await page.waitForFunction(() => !document.querySelector("[data-testid='acw-strip']"), null, { timeout: 90000 });
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
await login(page, process.env.AGENT ?? "agent.a");

// ---- dashboard
await page.goto(`${BASE}/agent`);
await page.getByTestId("dash-workload").waitFor();
await page.waitForTimeout(500);
await shot(page, "dashboard-1366");
const dash = await measure(page, "dashboard-1366");
check("dashboard has no screen codes in navigation", !(await page.locator("#app-sidebar").innerText()).match(/S2[0-9][AB]?/));

// ---- call workspace
await page.goto(`${BASE}/agent/call`);
const connect = page.getByTestId("connect-dialer");
if (await connect.isVisible().catch(() => false)) {
  await connect.click();
  await page.getByTestId("compact-header").waitFor({ timeout: 60000 });
}
await page.getByTestId("compact-header").waitFor({ timeout: 60000 });
await finishLeftovers(page);
for (let i = 0; i < 90 && !(await page.getByTestId("identity-RPC_VERIFIED").isVisible().catch(() => false)); i++) {
  const ready = page.getByTestId("go-ready");
  if ((await ready.isVisible().catch(() => false)) && (await ready.isEnabled().catch(() => false))) await ready.click().catch(() => null);
  await page.waitForTimeout(2000);
}
await enabled(page, "identity-RPC_VERIFIED", 120000);
await page.waitForTimeout(600);
await shot(page, "active-call-1366");
await measure(page, "active-call-1366");
check("mock telephony is labelled", await page.getByTestId("telephony-mode").isVisible().catch(() => false));
check("save is disabled while the call is live", await page.getByTestId("save-next").isDisabled());

await page.getByTestId("identity-RPC_VERIFIED").click();
await page.getByTestId("reason-SALARY_TIMING").click();
await page.getByTestId("outcome-PTP").click();
await page.getByTestId("ptp-amount-other").click();
const maxAmount = await page.getByTestId("promise-fields").innerText();
await page.getByTestId("ptp-amount-input").fill("137.50");
await page.getByTestId("ptp-date-other").click();
const dateInput = page.getByTestId("ptp-date-input");
const min = await dateInput.getAttribute("min");
const max = await dateInput.getAttribute("max");
const date = isoAdd(min, 2) <= (max ?? "9999") ? isoAdd(min, 2) : min;
await dateInput.fill(date);
await page.waitForTimeout(400);
const scriptText = await page.getByTestId("script-confirm").innerText().catch(() => "");
check("confirmation script shows the custom amount and date", scriptText.includes("137.50") && scriptText.includes(azDate(date)), scriptText);
check("consent is not set by entering terms", !(await page.getByTestId("ptp-confirm").isChecked()));
await page.getByTestId("ptp-confirm").check();
await page.waitForFunction(() => document.querySelector("[data-testid='outcome-line']")?.textContent?.includes("137,50") || document.querySelector("[data-testid='outcome-line']")?.textContent?.includes("137.50"), null, { timeout: 15000 });
const line = await page.getByTestId("outcome-line").innerText();
check("bottom summary shows the same amount and date", (line.includes("137,50") || line.includes("137.50")) && line.includes(azDate(date)), line);
const cover = await notCovered(page, "ptp-amount-input");
check("sticky bar does not cover the focused amount input", cover.ok, JSON.stringify(cover));
await shot(page, "promise-form-1366");
await shot(page, "promise-form-1366-full", true);
await measure(page, "promise-form-1366");
log("promise fields", maxAmount.replace(/\s+/g, " ").slice(0, 160));

// ---- reload restores the custom values and the explicit agreement
await page.waitForTimeout(1500); // draft autosave (900 ms debounce)
await page.reload();
await page.getByTestId("stage-outcome").waitFor({ timeout: 60000 });
await page.getByTestId("ptp-amount-input").waitFor({ timeout: 30000 });
check("custom amount restored after reload", (await page.getByTestId("ptp-amount-input").inputValue()) === "137.50");
check("custom date restored after reload", (await page.getByTestId("ptp-date-input").inputValue()) === date);
check("explicit agreement restored after reload", await page.getByTestId("ptp-confirm").isChecked());
check("identity stage collapsed into a summary", (await page.getByTestId("stage-identity").innerText()).length < 120);

// ---- another page: indicator, follow-ups with live blockers; then back with the draft intact
await page.goto(`${BASE}/agent/follow-ups`);
await page.getByTestId("active-call-indicator").waitFor({ timeout: 15000 });
check("follow-ups page shows the return-to-call indicator", true);
await page.waitForTimeout(300);
await shot(page, "follow-ups-1366");
await measure(page, "follow-ups-1366");
const rows = await page.getByTestId("follow-up-row").count();
check("follow-up list renders", rows > 0, `${rows} rows`);
const order = await page.$$eval("[data-testid='follow-up-row']", (els) => els.map((e) => e.getAttribute("data-due")));
const rank = { OVERDUE: 0, TODAY: 1, LATER: 2, NONE: 3 };
check("overdue and due-today items first", order.every((d, i) => i === 0 || rank[order[i - 1]] <= rank[d]), order.slice(0, 12).join(","));
await page.getByTestId("active-call-indicator").getByRole("link").click();
await page.getByTestId("ptp-amount-input").waitFor({ timeout: 30000 });
check("returning to the call keeps the draft", (await page.getByTestId("ptp-amount-input").inputValue()) === "137.50" && (await page.getByTestId("ptp-confirm").isChecked()));

// ---- the dashboard shows the way back but does not pull the agent into a call they already opened
await page.goto(`${BASE}/agent`);
await page.getByTestId("active-call-indicator").waitFor({ timeout: 15000 });
await page.waitForTimeout(7000); // more than one indicator poll
check("dashboard does not re-open a call the agent already saw", new URL(page.url()).pathname === "/agent");
await shot(page, "dashboard-during-call-1366");
await page.goto(`${BASE}/agent/call`);
await page.getByTestId("ptp-amount-input").waitFor({ timeout: 30000 });

// ---- the same live call at 1440×900 and at phone width (stacked: conversation first, details after)
for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(500);
  await shot(page, `promise-form-${tag}`);
  const m = await measure(page, `promise-form-${tag}`);
  check(`no horizontal page scroll at ${w}px (call)`, !m.horizontalScroll);
  const c = await notCovered(page, "ptp-confirm");
  check(`sticky bar does not cover the agreement checkbox at ${w}px`, c.ok, JSON.stringify(c));
}
await page.setViewportSize({ width: 1366, height: 768 });

// ---- end the call: after-call work, then the single save
await page.getByTestId("ctl-end").click();
await page.getByTestId("acw-strip").waitFor({ timeout: 90000 });
check("End leads to after-call work", true);
await enabled(page, "save-next", 30000);
await page.getByTestId("outcome-details").click();
await page.getByTestId("factual-summary").waitFor();
await shot(page, "outcome-details-1366");
await page.keyboard.press("Escape");
await page.getByTestId("save-pause").click();
await page.getByTestId("wrapup-state").or(page.getByTestId("idle-state")).waitFor({ timeout: 90000 });
check("outcome saved; next call waits for the provider wrap-up", true);
await page.waitForTimeout(1500);
await shot(page, "after-save-1366");

// ---- other sizes: dashboard and follow-ups at 1440×900 and a phone width
for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/agent`);
  await page.getByTestId("dash-workload").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `dashboard-${tag}`);
  const m = await measure(page, `dashboard-${tag}`);
  check(`no horizontal page scroll at ${w}px (dashboard)`, !m.horizontalScroll);
  await page.goto(`${BASE}/agent/follow-ups`);
  await page.getByTestId("follow-up-list").or(page.getByText(/Təqib ediləcək iş yoxdur|Nothing to follow up/)).first().waitFor();
  await shot(page, `follow-ups-${tag}`);
  const f = await measure(page, `follow-ups-${tag}`);
  check(`no horizontal page scroll at ${w}px (follow-ups)`, !f.horizontalScroll);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
const failed = report.checks.filter((c) => !c.ok);
log(`done: ${report.checks.length - failed.length}/${report.checks.length} checks passed`, failed.map((f) => f.name).join("; "));
log("dashboard height at 1366×768", String(dash.pageHeight));
process.exit(failed.length ? 1 : 0);
