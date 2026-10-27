/** Screenshots of the main screens at desktop and narrower widths (docs/screenshots). */
import { BASE, launch, log, login } from "./lib.mjs";

const WIDTHS = [1440, 1280, 1024];
const PAGES = [
  ["lead", "/overview", "overview"], ["lead", "/work-queue", "work-queue"], ["lead", "/customers/C-DEMO-001", "customer-360"], ["lead", "/loans/L-DEMO-001", "loan-detail"],
  ["lead", "/promises", "promises"], ["lead", "/tasks", "tasks"], ["lead", "/payments", "payments"], ["lead", "/operations", "operations"], ["lead", "/analytics", "analytics"],
  ["lead", "/exceptions", "exceptions"], ["lead", "/settings", "settings"], ["lead", "/approvals", "approvals"], ["lead", "/arrangements", "arrangements"], ["lead", "/recovery", "recovery"],
  ["risk", "/strategies", "strategies"], ["risk", "/models/prometeia", "models"], ["risk", "/strategy/economics", "economics"], ["risk", "/model-monitoring", "model-monitoring"],
  ["head", "/campaigns", "campaigns"], ["head", "/templates", "templates"],
  ["integrator", "/integrations", "integrations"], ["integrator", "/data/imports", "imports"], ["admin", "/audit", "audit"], ["admin", "/admin/users", "users"],
];
const browser = await launch();
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const sessions = new Map();
  for (const [user, path, name] of PAGES) {
    let page = sessions.get(user);
    if (!page) { page = await context.newPage(); await login(page, user); sessions.set(user, page); }
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/screenshots/${name}-${width}.png`, fullPage: false });
    log("shot", `${name} @${width}`);
  }
  // Agent desktop (home state) and login page
  const agent = await context.newPage();
  await agent.goto(`${BASE}/login`);
  await agent.screenshot({ path: `docs/screenshots/login-${width}.png` });
  await login(agent, "agent.a");
  await agent.waitForTimeout(800);
  await agent.screenshot({ path: `docs/screenshots/agent-home-${width}.png` });
  log("shot", `agent-home @${width}`);
  await context.close();
}
await browser.close();
console.log("screenshots written to docs/screenshots");
