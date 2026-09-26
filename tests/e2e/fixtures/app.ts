// Driving the real app like a person would, for the journeys (spec 21.3). Each phone is a browser context with
// its own storage and its own virtual passkey authenticator; everything goes through the real relay.
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addVirtualAuthenticator, type VirtualAuthenticator } from "./webauthn";

export interface Phone {
  ctx: BrowserContext;
  page: Page;
  /** Absent for a phone that can't create passkeys. */
  auth?: VirtualAuthenticator;
  name: string;
  /** Uncaught exceptions and unhandled promise rejections in the app: every journey must end with none. */
  errors: string[];
}

/** A new, empty phone (its own context, storage and passkey authenticator), on the app's start screen.
 *  `beforeLoad` runs first, e.g. to route its relay connection through the test (context.routeWebSocket). */
export async function newPhone(
  browser: Browser,
  name: string,
  o: { beforeLoad?: (ctx: BrowserContext) => Promise<unknown>; passkeys?: boolean } = {},
): Promise<Phone> {
  const ctx = await browser.newContext();
  await o.beforeLoad?.(ctx);
  if (o.passkeys === false) {
    // A phone whose browser has no user-verifying platform authenticator (FC-24).
    await ctx.addInitScript(() => {
      if (typeof PublicKeyCredential !== "undefined") {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
      }
    });
  }
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  const auth = o.passkeys === false ? undefined : await addVirtualAuthenticator(page);
  await page.goto("/");
  return { ctx, page, ...(auth ? { auth } : {}), name, errors };
}

/** Goes through first-launch setup (A1–A8) to Home. `verifiable` creates a passkey (A6); `alerts` turns alerts on
 *  at A8 (otherwise "Not now"). */
export async function setUp(p: Phone, o: { verifiable: boolean; phone?: string; alerts?: boolean }): Promise<void> {
  const { page } = p;
  // The splash decides where a fresh phone starts (install hint on some platforms, then the language).
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 });
  for (let i = 0; i < 20; i++) {
    const path = new URL(page.url()).pathname;
    if (path === "/home") break;
    if (path === "/install") await page.getByRole("button", { name: /Continue in browser/ }).click();
    else if (path === "/setup/language")
      await page
        .getByRole("radio", { name: /English/ })
        .first()
        .click();
    else if (path === "/setup/welcome") await page.getByRole("button", { name: "Skip" }).click();
    else if (path === "/setup/name") {
      await page.getByLabel("Your name").fill(p.name);
      if (o.phone) await page.getByLabel(/Phone number/).fill(o.phone);
      await page.getByRole("button", { name: "Continue" }).click();
    } else if (path === "/setup/role") {
      const choice = o.verifiable ? /Yes, set up my key/ : /No, I only check others/;
      await page.getByRole("radio", { name: choice }).click();
      await page.getByRole("button", { name: "Continue" }).click();
    } else if (path === "/setup/key") {
      await page.getByRole("button", { name: /Create my key/ }).click();
      await expect(page.getByText(/Your key is ready/)).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
    } else if (path === "/setup/done") {
      await page.getByRole("button", { name: "Later" }).click();
    } else if (path === "/setup/notifications") {
      await page.getByRole("button", { name: o.alerts ? "Turn on alerts" : "Not now" }).click();
    } else {
      throw new Error(`setUp: unexpected screen ${path}`);
    }
    // Every step moves to another screen: wait for it, so no step is ever tapped twice.
    await page.waitForURL((u) => u.pathname !== path, { timeout: 30_000 });
  }
  await page.waitForURL("**/home");
  await expect(page.getByText("Connected")).toBeVisible();
}

/** The person closes the app: the page goes, the phone (storage, passkeys, push subscription) stays. Returns a
 *  function that opens the app again at `path`, as a notification tap does. */
export async function closeApp(p: Phone): Promise<(path: string) => Promise<void>> {
  const creds = (await p.auth?.exportCredentials()) ?? [];
  await p.page.close();
  return async (path) => {
    const page = await p.ctx.newPage();
    page.on("pageerror", (e) => p.errors.push(`${p.name}: ${e.message}`));
    const auth = await addVirtualAuthenticator(page);
    await auth.importCredentials(creds);
    p.page = page;
    p.auth = auth;
    await page.goto(path);
  };
}

/** This phone's family link, as "Copy link" on My code gives it (the dev build exposes the same function). */
export async function linkOf(p: Phone): Promise<string> {
  return p.page.evaluate(async () => {
    const w = window as unknown as { __pehchaan?: { myLink(): Promise<string | null> } };
    for (let i = 0; i < 100 && !w.__pehchaan; i++) await new Promise((r) => setTimeout(r, 50));
    const link = await w.__pehchaan!.myLink();
    if (!link) throw new Error("no profile yet");
    return link;
  });
}

/** The four safety words on My code (C3), as this phone shows them to family. */
export async function ownWords(p: Phone): Promise<string> {
  const { page } = p;
  await page.goto("/family/my-code");
  const group = page.getByRole("group", { name: "Safety words" }).first();
  await expect(group).toHaveText(/^[A-Z\s]+$/);
  const words = normalise(await group.innerText());
  await page.goto("/home");
  return words;
}

const normalise = (s: string) => s.replace(/[^A-Z]+/g, " ").trim();

/** C4 → C5: add someone in person by pasting their code (headless browsers have no camera). Returns the words
 *  C5 showed. */
export async function addInPerson(p: Phone, link: string, relation: string, label?: string): Promise<string> {
  const { page } = p;
  await page.goto("/family/scan");
  await page.getByRole("button", { name: /Paste code instead/ }).click();
  await page.getByRole("textbox", { name: "Paste their code" }).fill(link);
  await page.getByRole("button", { name: "Add from code" }).click();
  await page.waitForURL("**/family/confirm");
  const group = page.getByRole("group", { name: "Safety words" });
  await expect(group).toHaveText(/[A-Z]{3,}/);
  const words = normalise(await group.innerText());
  await page.getByRole("button", { name: /Yes, they match/ }).click();
  await page.getByRole("radio", { name: relation }).click();
  if (label) await page.getByLabel("What do you call them?").fill(label);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.waitForURL("**/family");
  return words;
}

/** C8: open someone's family link and save them (a judge, a relative far away). Returns the words shown. */
export async function addByLink(p: Phone, link: string): Promise<string> {
  const { page } = p;
  await page.goto(new URL(link).pathname + new URL(link).hash);
  await page.getByRole("button", { name: "Continue" }).click();
  const group = page.getByRole("group", { name: "Safety words" });
  await expect(group).toHaveText(/[A-Z]{3,}/);
  const words = normalise(await group.innerText());
  await page.getByRole("button", { name: /Yes, they match/ }).click();
  await expect(page.getByText(/Saved\. You can now check/)).toBeVisible();
  return words;
}

/** D1 → D2 → D3: Maa asks {who}'s phone (money, ₹50,000). Ends on the waiting screen. */
export async function ask(p: Phone, who: RegExp): Promise<void> {
  const { page } = p;
  await page.goto("/home");
  await page.getByRole("button", { name: /Verify a caller/ }).click();
  await page.waitForURL("**/verify/who");
  await page.getByRole("button", { name: who }).first().click();
  await page.waitForURL("**/verify/what");
  await page.getByRole("button", { name: "₹50,000" }).click();
  await page.getByRole("button", { name: /Ask .*phone/ }).click();
  await page.waitForURL("**/verify/waiting/**");
}

/** F1 → F2 → F3: answer with the passkey (the virtual authenticator's "fingerprint"). */
export async function answer(p: Phone, decision: "yes" | "no"): Promise<void> {
  const { page } = p;
  await page.waitForURL("**/request/**", { timeout: 30_000 });
  await page.getByRole("button", { name: decision === "yes" ? /Yes, it's me/ : /NO, NOT ME/ }).click();
  await page.waitForURL("**/sent", { timeout: 30_000 });
}

/** The verdict headline (E1–E5). */
export async function verdict(p: Phone, timeout = 30_000): Promise<string> {
  const { page } = p;
  await page.waitForURL("**/verify/result/**", { timeout });
  // The outgoing screen is still animating out for a moment: wait until the verdict's heading is the only one.
  await expect(page.locator("h1")).toHaveCount(1);
  const h1 = page.locator("h1").first();
  await expect(h1).toBeVisible();
  return ((await h1.textContent()) ?? "").trim();
}

/** The two confirmation words shown under `caption` (E7 on Maa's phone, F3 on Arjun's). */
export async function confirmationWords(page: Page, caption: RegExp): Promise<string> {
  const text = await page.getByText(caption).locator("xpath=following-sibling::p[1]").textContent();
  return normalise(text ?? "");
}

export async function closeAll(...phones: Phone[]): Promise<void> {
  await Promise.all(phones.map((p) => p.ctx.close()));
  // Soft, so a journey that already failed keeps its own message.
  expect
    .soft(
      phones.flatMap((p) => p.errors),
      "uncaught errors in the app",
    )
    .toEqual([]);
}
