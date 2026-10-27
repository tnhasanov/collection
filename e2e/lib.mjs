// Shared helpers for the browser flows (Playwright is pre-installed globally in the dev container).
import { createRequire } from "node:module";
// Playwright is installed globally in the dev container; resolve it through require so no project install is needed.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export const BASE = process.env.APP_URL ?? "http://localhost:3000";

export async function launch() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  return browser;
}

export async function login(page, username, password = "demo1234") {
  await page.goto(`${BASE}/login`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
}

export async function waitForText(page, text, timeout = 60000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

export function log(step, detail = "") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}${detail ? " — " + detail : ""}`);
}
