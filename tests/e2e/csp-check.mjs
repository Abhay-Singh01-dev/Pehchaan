// A one-off check (not part of the suites): loads a production build under its meta CSP and reports any Content
// Security Policy violation or page error. Usage: node tests/e2e/csp-check.mjs <preview-url>
import { chromium } from "@playwright/test";

const base = process.argv[2];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
const problems = [];
page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
for (const path of ["/", "/install", "/lab", "/guard", "/diagnostics"]) {
  await page.goto(base + path, { waitUntil: "networkidle" });
}
const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()));
await browser.close();
console.log(JSON.stringify({ csp, bootScriptRan: Boolean(theme), serviceWorker: sw, problems }, null, 2));
process.exitCode = problems.length ? 1 : 0;
