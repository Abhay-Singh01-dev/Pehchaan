import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PHONE = { width: 390, height: 844 };

/** Opens a simulated phone (?device=<name>) and waits for it to reach Home. */
export async function openPhone(ctx: BrowserContext, device: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.setViewportSize(PHONE);
  await page.goto(`/?device=${device}`);
  await page.waitForURL("**/home");
  return page;
}

export async function newContext(browser: Browser) {
  return browser.newContext({ viewport: PHONE, hasTouch: true });
}

/** Maa: Verify a caller → {who} → Money ₹50,000 → Ask. Ends on the waiting screen. */
export async function askFromHome(page: Page, who: RegExp = /Arjun/) {
  await page.bringToFront();
  await page.goto("/home");
  await page.getByRole("button", { name: /Verify a caller/ }).click();
  await page.waitForURL("**/verify/who");
  await page.getByRole("button", { name: who }).first().click();
  await page.waitForURL("**/verify/what");
  await page.getByRole("button", { name: "₹50,000" }).click();
  await page.getByRole("button", { name: /Ask .*phone/ }).click();
  await page.waitForURL("**/verify/waiting/**");
}

/** Arjun: answer the incoming request and unlock with the simulated fingerprint. */
export async function answer(page: Page, decision: "yes" | "no") {
  await page.waitForURL("**/request/**");
  await page.bringToFront();
  await page.getByRole("button", { name: decision === "yes" ? /Yes, it's me/ : /NO, NOT ME/ }).click();
  await page.getByRole("button", { name: /Fingerprint sensor/ }).click();
  await page.waitForURL("**/sent");
}

/** Waits for the verdict screen and returns its headline. */
export async function verdict(page: Page): Promise<string> {
  await page.waitForURL("**/verify/result/**");
  await page.bringToFront();
  // The outgoing screen is still animating out for a moment: wait until the verdict's heading is the only one.
  await expect(page.locator("h1")).toHaveCount(1);
  const h1 = page.locator("h1").first();
  await expect(h1).toBeVisible();
  return (await h1.textContent())?.trim() ?? "";
}
