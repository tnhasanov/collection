/**
 * Pilot browser journeys with "after" screenshots at 1366×768 and 1440×900 (docs/screenshots/after).
 *   1. Agent shift: connect → Ready → reserved/live → capture (identity, reason, promise) → End → after-call work → save
 *   2. Team lead: home (decisions) → operations (live monitor, force-end control) → approvals → exceptions
 *   3. Head: home → overview → analytics
 *   4. Admin: users, settings, integrations; sign-in page in the Azerbaijani default
 * Prerequisites: web app on APP_URL (default http://localhost:3000) and the worker running against the demo database.
 */
import { BASE, launch, log, login } from "./lib.mjs";

const OUT = "docs/screenshots/after";
const SIZES = [[1366, 768], [1440, 900]];
const shot = (page, name, w, full = false) => page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: full });
const enabled = async (page, testId, timeout = 60000) => page.waitForFunction((id) => { const b = document.querySelector(`[data-testid='${id}']`); return b && !b.disabled; }, testId, { timeout });

const browser = await launch();
for (const [w, h] of SIZES) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  // ---- sign-in page (Azerbaijani default UI language)
  const p0 = await context.newPage();
  await p0.goto(`${BASE}/login`);
  await shot(p0, "login", w);
  await p0.close();

  // ---- agent shift
  const agent = await context.newPage();
  await login(agent, "agent.a");
  await agent.waitForURL((u) => u.pathname.startsWith("/agent"), { timeout: 30000 });
  const connect = agent.getByTestId("connect-dialer");
  if (await connect.isVisible().catch(() => false)) { await connect.click(); await agent.getByTestId("compact-header").waitFor({ timeout: 60000 }); }
  // Clear any leftover after-call work from an earlier run so the shift starts from Ready.
  if (await agent.getByTestId("acw-strip").isVisible().catch(() => false)) {
    await agent.getByTestId("identity-RPC_VERIFIED").click(); await agent.getByTestId("reason-NOT_STATED").click(); await agent.getByTestId("outcome-NO_COMMITMENT").click();
    await enabled(agent, "save-next"); await agent.getByTestId("save-pause").click();
    await agent.waitForFunction(() => !document.querySelector("[data-testid='acw-strip']"), null, { timeout: 90000 });
  }
  await agent.waitForTimeout(800);
  await shot(agent, "agent-home", w);
  // Reach a call: click Go Ready when it becomes available, otherwise wait for the allocation of an already-Ready agent.
  for (let i = 0; i < 90 && !(await agent.getByTestId("call-strip").isVisible().catch(() => false)); i++) {
    const ready = agent.getByTestId("go-ready");
    if ((await ready.isVisible().catch(() => false)) && (await ready.isEnabled().catch(() => false))) await ready.click().catch(() => null);
    await agent.waitForTimeout(2000);
  }
  await agent.getByTestId("call-strip").waitFor({ timeout: 120000 });
  await shot(agent, "agent-reserved", w);
  await agent.getByTestId("identity-RPC_VERIFIED").waitFor({ timeout: 120000 }); // live: responses open when connected
  await agent.waitForTimeout(600);
  await shot(agent, "agent-live", w);
  await agent.getByTestId("identity-RPC_VERIFIED").click();
  await agent.getByTestId("reason-SALARY_TIMING").click();
  await agent.getByTestId("outcome-PTP").click();
  await agent.getByTestId("ptp-amount-overdue").click();
  await agent.getByTestId("ptp-date-3days").click();
  await agent.getByTestId("ptp-confirm").check();
  await agent.getByTestId("factual-summary").waitFor({ timeout: 30000 });
  // Related persons and payment instructions tabs
  await agent.getByRole("tab", { name: /Əlaqəli şəxslər|Related persons/ }).click();
  await agent.waitForTimeout(300);
  await shot(agent, "agent-live-captured", w);
  await agent.getByRole("tab", { name: /Ödəniş təlimatı|Payment instructions/ }).click();
  await enabled(agent, "send-pay-instructions", 15000).catch(() => null);
  if (await agent.getByTestId("send-pay-instructions").isEnabled().catch(() => false)) { await agent.getByTestId("send-pay-instructions").click(); await agent.waitForTimeout(800); }
  await shot(agent, "agent-pay-instructions", w);
  await agent.getByTestId("ctl-end").click();
  await agent.getByTestId("acw-strip").waitFor({ timeout: 60000 });
  await agent.getByTestId("factual-summary").waitFor({ timeout: 30000 });
  await agent.waitForTimeout(1200);
  await shot(agent, "agent-acw", w);
  await enabled(agent, "save-next");
  await agent.getByTestId("save-pause").click();
  await agent.waitForFunction(() => !document.querySelector("[data-testid='acw-strip']"), null, { timeout: 90000 });
  await agent.goto(`${BASE}/agent/follow-ups?tab=promises`, { waitUntil: "networkidle" });
  await shot(agent, "agent-follow-ups", w);
  await agent.goto(`${BASE}/agent/results`, { waitUntil: "networkidle" });
  await shot(agent, "agent-results", w);
  log("journey", `agent shift @${w}`);
  await agent.close();

  // ---- team lead
  const lead = await context.newPage();
  await login(lead, "lead");
  await lead.waitForURL((u) => u.pathname === "/home", { timeout: 30000 });
  await lead.waitForTimeout(500);
  await shot(lead, "lead-home", w);
  for (const [path, name] of [["/operations", "lead-operations"], ["/approvals?status=pending", "lead-approvals"], ["/exceptions", "lead-exceptions"], ["/promises", "lead-promises"], ["/customers/C-DEMO-001", "lead-customer-360"], ["/work-queue?queue=all", "lead-work-queue"]]) {
    await lead.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await lead.waitForTimeout(400);
    await shot(lead, name, w);
  }
  log("journey", `team lead @${w}`);
  await lead.close();

  // ---- collections head
  const head = await context.newPage();
  await login(head, "head");
  await head.waitForURL((u) => u.pathname === "/home", { timeout: 30000 });
  await head.waitForTimeout(500);
  await shot(head, "head-home", w);
  for (const [path, name] of [["/overview", "head-overview"], ["/analytics?tab=agents", "head-analytics-agents"], ["/payments", "head-payments"]]) {
    await head.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await head.waitForTimeout(400);
    await shot(head, name, w);
  }
  log("journey", `head @${w}`);
  await head.close();

  // ---- admin
  const admin = await context.newPage();
  await login(admin, "admin");
  for (const [path, name] of [["/admin/users", "admin-users"], ["/settings", "admin-settings"], ["/integrations", "admin-integrations"], ["/audit", "admin-audit"]]) {
    await admin.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await admin.waitForTimeout(400);
    await shot(admin, name, w);
  }
  log("journey", `admin @${w}`);
  await admin.close();
  await context.close();
}
await browser.close();
console.log(`pilot journeys completed; screenshots in ${OUT}`);
