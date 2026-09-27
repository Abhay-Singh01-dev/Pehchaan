// F-27 (spec 23: "Vercel down → the installed app still opens from its cache"). Loads a production build once so the
// service worker installs and precaches the app, then cuts the network completely and opens the app again: the
// shell must render from the cache, with no page error. Usage: node tests/e2e/offline-check.mjs <preview-url>
// (run against `vite build` + `vite preview`, like csp-check.mjs). Exits 1 on failure.
import { chromium } from "@playwright/test";

const base = process.argv[2];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const context = await browser.newContext();
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

// Never hang: a stuck step is a failure.
setTimeout(() => {
  console.error("offline-check: timed out");
  process.exit(1);
}, 90_000).unref();

// 1. Online: the service worker installs and precaches. Like a person opening the app a second time, the next load
//    is the one the worker controls.
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
await page.reload({ waitUntil: "networkidle" });
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
if (!controlled) problems.push("the service worker did not control the page after installing");
const onlineText = (await page.locator("#root").innerText()).trim();

// 2. The host is gone (Vercel down, or no network at all): open the app again, and a deep link too.
await context.setOffline(true);
const failed = [];
page.on("requestfailed", (r) => failed.push(new URL(r.url()).pathname));
const opened = [];
for (const path of ["/", "/diagnostics"]) {
  const response = await page.goto(base + path, { waitUntil: "load" }).catch((e) => e);
  if (response instanceof Error) problems.push(`${path}: ${response.message}`);
  // React renders after the module scripts run: give it up to 10 s.
  await page
    .waitForFunction(() => (document.querySelector("#root")?.textContent ?? "").trim().length > 0, null, {
      timeout: 10_000,
    })
    .catch(() => {});
  const text = (
    await page
      .locator("#root")
      .innerText()
      .catch(() => "")
  ).trim();
  if (!text) problems.push(`${path}: nothing rendered offline`);
  opened.push({
    path,
    fromServiceWorker: !(response instanceof Error) && response?.fromServiceWorker(),
    chars: text.length,
  });
}
await browser.close();
console.log(JSON.stringify({ onlineChars: onlineText.length, opened, failedOffline: failed, problems }, null, 2));
process.exitCode = problems.length || onlineText.length === 0 ? 1 : 0;
