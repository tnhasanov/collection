/**
 * One customer = one compact row (synthetic data): customer list and work queue at 1366×768, 1440×900 and 390×844.
 * Checks one row per customer id, one text line per cell, 44–48 px rows with 14 px text, no horizontal page scroll,
 * the detail panel (keyboard open, "N kredit" opens the loans section, Escape closes, focus and list position kept),
 * and that opening details claims nothing. Screenshots: docs/screenshots/customer-rows/after-*.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, launch, log, login } from "./lib.mjs";

const OUT = "docs/screenshots/customer-rows";
mkdirSync(OUT, { recursive: true });
const report = { checks: [], measurements: {} };
const check = (name, ok, detail = "") => {
  report.checks.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}`, detail);
};

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-testid='customer-row']")];
    const ids = rows.map((r) => r.getAttribute("data-customer"));
    const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
    // A cell wraps when its content box is taller than one line (text is nowrap; this catches stacked blocks too).
    const wrapped = [...document.querySelectorAll("[data-testid='customer-row'] td")].filter((td) => getComputedStyle(td).display !== "none" && td.scrollHeight > td.clientHeight + 1).length;
    const name = document.querySelector("[data-testid='row-open']");
    return {
      rows: rows.length,
      uniqueIds: new Set(ids).size,
      rowHeightMin: Math.min(...heights),
      rowHeightMax: Math.max(...heights),
      wrappedCells: wrapped,
      nameFont: name ? parseFloat(getComputedStyle(name).fontSize) : null,
      horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
      visibleColumns: [...document.querySelectorAll("[data-testid='customer-rows'] thead th")].filter((th) => getComputedStyle(th).display !== "none").length,
    };
  });
  report.measurements[label] = m;
  log(`measure ${label}`, JSON.stringify(m));
  return m;
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
await login(page, "lead");

for (const [w, h, tag] of [[1366, 768, "1366"], [1440, 900, "1440"], [390, 844, "390"]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const [path, name] of [["/customers", "customers"], ["/work-queue?queue=all", "work-queue"]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.getByTestId("customer-rows").waitFor();
    await shot(page, `after-${name}-${tag}`);
    if (w < 768) {
      await page.getByTestId("customer-rows").scrollIntoViewIfNeeded();
      await shot(page, `after-${name}-${tag}-list`);
    }
    const m = await measure(page, `${name}-${tag}`);
    check(`${name} ${tag}: one row per customer id`, m.rows > 0 && m.rows === m.uniqueIds, `${m.rows} rows`);
    check(`${name} ${tag}: every cell on one line`, m.wrappedCells === 0, `${m.wrappedCells} wrapped`);
    check(`${name} ${tag}: no horizontal page scroll`, !m.horizontalScroll);
    if (w >= 1366) {
      check(`${name} ${tag}: rows 44–48 px, 14 px text`, m.rowHeightMin >= 44 && m.rowHeightMax <= 48 && m.nameFont === 14, `${m.rowHeightMin}-${m.rowHeightMax}px, ${m.nameFont}px`);
    }
  }
}
await page.setViewportSize({ width: 1366, height: 768 });

async function shot(p, name) {
  await p.screenshot({ path: `${OUT}/${name}.png` });
}

// ---- the seeded customer with a call AND a callback appears once in the queue, on one page only
let seen = 0;
for (let pg = 1; pg <= 10; pg++) {
  await page.goto(`${BASE}/work-queue?queue=all&page=${pg}`, { waitUntil: "networkidle" });
  const n = await page.locator("[data-customer='C-DEMO-025']").count();
  seen += n;
  if ((await page.getByTestId("customer-row").count()) < 25) break;
}
check("customer with a call and a callback appears once across all queue pages", seen === 1, `${seen}`);

// ---- detail panel from the customer list: keyboard, loans section, Escape, focus and position kept
await page.goto(`${BASE}/customers?filter=active&sort=loans&dir=desc`, { waitUntil: "networkidle" });
await page.evaluate(() => window.scrollTo(0, 300));
const scrollBefore = await page.evaluate(() => window.scrollY);
const firstRow = page.getByTestId("customer-row").nth(3);
const rowCustomer = await firstRow.getAttribute("data-customer");
const loanText = await firstRow.getByTestId("row-loans").innerText();
const claimedBefore = await page.evaluate(async () => (await fetch("/api/agent/active").then((r) => r.json()).catch(() => null))?.data ?? null);
await firstRow.getByTestId("row-open").focus();
await page.keyboard.press("Enter");
await page.getByTestId("customer-detail-panel").waitFor();
await page.getByTestId("detail-loans").waitFor({ timeout: 15000 });
check("Enter on the customer name opens the detail panel", true);
await page.waitForTimeout(300);
await shot(page, "after-detail-panel-1366");
const loanCount = await page.getByTestId("detail-loan").count();
check("panel lists the customer's individual loans", loanCount >= Number(loanText.match(/\d+/)?.[0] ?? 0), `${loanText} → ${loanCount} loan cards`);
check("panel shows promises, last contact and next work", (await page.getByTestId("detail-promises").isVisible()) && (await page.getByTestId("detail-last-contact").isVisible()) && (await page.getByTestId("detail-work").isVisible()));
await page.keyboard.press("Escape");
await page.getByTestId("customer-detail-panel").waitFor({ state: "detached" });
await page.waitForTimeout(150);
const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
const scrollAfter = await page.evaluate(() => window.scrollY);
const stillSelected = await page.locator(`[data-customer='${rowCustomer}']`).getAttribute("data-selected");
check("Escape closes the panel; focus returns to the row; list position and selection kept", focusBack === "row-open" && Math.abs(scrollAfter - scrollBefore) < 2 && stillSelected === "true", `focus=${focusBack} scroll ${scrollBefore}→${scrollAfter} selected=${stillSelected}`);
await firstRow.getByTestId("row-loans").click();
await page.getByTestId("detail-loan").first().waitFor();
await page.waitForTimeout(400);
const focusedLoans = await page.evaluate(() => document.activeElement?.id);
check(`"${loanText}" opens the panel at the loans section`, focusedLoans === "cd-loans", `focus=${focusedLoans}`);
await shot(page, "after-detail-loans-1366");
await page.getByTestId("detail-close").click();
const claimedAfter = await page.evaluate(async () => (await fetch("/api/agent/active").then((r) => r.json()).catch(() => null))?.data ?? null);
check("opening details claims, reserves or dials nothing", JSON.stringify(claimedBefore) === JSON.stringify(claimedAfter));

// ---- "+N" opens the panel at the work section, listing the customer's other open work
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
const more = page.getByTestId("row-more-work").first();
check("a customer with several open work items shows one row with \"+N\"", (await more.count()) > 0);
await more.click();
await page.getByTestId("detail-other-work").waitFor({ timeout: 15000 });
await page.waitForTimeout(300);
check("other open work of a customer is listed in the panel", (await page.getByTestId("detail-other-work").locator("li").count()) > 0);
await shot(page, "after-other-work-panel-1366");
await page.keyboard.press("Escape");

// ---- narrow: the panel takes the full width and closes again
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await page.getByTestId("row-open").first().click();
await page.getByTestId("detail-summary").waitFor({ timeout: 15000 });
await shot(page, "after-detail-panel-390");
const panelW = await page.getByTestId("customer-detail-panel").evaluate((el) => Math.round(el.getBoundingClientRect().width));
check("narrow: panel uses the full width", panelW === 390, `${panelW}px`);
await page.keyboard.press("Escape");

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
const failed = report.checks.filter((c) => !c.ok);
log(`done: ${report.checks.length - failed.length}/${report.checks.length} checks passed`, failed.map((f) => f.name).join("; "));
process.exit(failed.length ? 1 : 0);
