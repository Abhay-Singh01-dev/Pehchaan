// Playwright global setup: open the app once so the dev server compiles every screen before the first journey
// (a cold Vite server takes long enough on the first page loads to eat into a journey's time limit).
import { chromium, type FullConfig } from "@playwright/test";

export default async function warmUp(config: FullConfig): Promise<void> {
  const use = config.projects[0]!.use;
  const browser = await chromium.launch(use.channel ? { channel: use.channel } : {});
  try {
    const page = await browser.newPage();
    await page.goto(`${use.baseURL}/`, { waitUntil: "load", timeout: 180_000 });
    // The app preloads the critical screens itself; give it the time to, then walk the setup screens' chunks.
    await page.waitForTimeout(5000);
    for (const path of ["/setup/language", "/family", "/verify/who", "/settings", "/diagnostics"]) {
      await page.goto(`${use.baseURL}${path}`, { waitUntil: "load", timeout: 120_000 });
    }
  } finally {
    await browser.close();
  }
}
