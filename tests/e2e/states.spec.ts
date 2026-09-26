// APP-09 · The screen states the backend added (spec 22.1), in the real app against the real relay: a phone with
// a wrong clock, the D1 reachability hint, "Update Pehchaan" (4426), A6 checks-only, Privacy and Who can reach
// me, and Diagnostics. The other APP-09 states run in the journeys (D3 status line and E7 words: J-02;
// not_allowed: J-11; F1 cancelled: J-07; late lines: J-08; C7 revoke and reset: J-11).
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict, type Phone } from "./fixtures/app";

async function family(browser: Browser, o: { arjunClockMs?: number; maaClockMs?: number } = {}) {
  // A wrong wall clock, as on a phone set to the wrong time: only Date moves. Timers, animation frames and
  // performance.now() stay real (Playwright's clock.install would fake those too, which no real phone does).
  const shift = (ms: number | undefined) =>
    ms
      ? {
          beforeLoad: (ctx: BrowserContext) =>
            ctx.addInitScript((offset: number) => {
              const RealDate = Date;
              class WrongClockDate extends RealDate {
                constructor(...args: unknown[]) {
                  if (args.length === 0) super(RealDate.now() + offset);
                  // new Date(value) and new Date(y, m, d, …): every argument is passed on unchanged.
                  else super(...(args as [number]));
                }
                static override now() {
                  return RealDate.now() + offset;
                }
              }
              globalThis.Date = WrongClockDate as DateConstructor;
            }, ms),
        }
      : {};
  const maa = await newPhone(browser, "Sunita Sharma", shift(o.maaClockMs));
  const arjun = await newPhone(browser, "Arjun Sharma", shift(o.arjunClockMs));
  await setUp(maa, { verifiable: false });
  await setUp(arjun, { verifiable: true });
  await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
  await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
  return { maa, arjun };
}

test("F-15 · phones whose clocks are 7 minutes wrong (in opposite directions) still check each other", async ({
  browser,
}) => {
  const { maa, arjun } = await family(browser, { arjunClockMs: 7 * 60_000, maaClockMs: -7 * 60_000 });
  try {
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    // F1's countdown comes from the relay's time left, not from Maa's clock (FC-14).
    await expect(arjun.page.getByText(/Expires in 0:[45]\d/)).toBeVisible();
    await expect(arjun.page.getByText(/This request expired/)).toHaveCount(0);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    // "Arjun's key · …" is timed by Maa's own clock, not Arjun's (8.7).
    // Seconds ago, never "7 min ago" or "in 7 min".
    await expect(maa.page.getByText(/^Arjun's key · (now|\d+ sec ago)$/)).toBeVisible();
  } finally {
    await closeAll(maa, arjun);
  }
});

test("FC-17 · D1 hints that a member's phone may not get the check when it can't be reached", async ({ browser }) => {
  const { maa, arjun } = await family(browser);
  try {
    // One check first: the relay only answers presence for phones Maa may contact (a binding exists, 12).
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    await maa.page.goto("/verify/who");
    await expect(maa.page.getByText(/may not get this right now/)).toHaveCount(0);
    await arjun.ctx.close(); // Arjun's phone is off (no socket, and no push subscription in this test)
    await maa.page.goto("/verify/who");
    await expect(
      maa.page.getByText("Arjun's phone may not get this right now. You can still ask, or call them."),
    ).toBeVisible();
  } finally {
    await closeAll(maa);
  }
});

test("FC-23 · a relay that says this version is too old gets an 'Update Pehchaan' prompt", async ({ browser }) => {
  const old = await newPhone(browser, "Sunita Sharma", {
    beforeLoad: (ctx) => ctx.routeWebSocket(/\/v1\/ws$/, (ws) => ws.close({ code: 4426, reason: "app too old" })),
  });
  try {
    await expect(old.page.getByText(/too old to connect/)).toBeVisible();
    await expect(old.page.getByRole("button", { name: "Update now" })).toBeVisible();
  } finally {
    await closeAll(old);
  }
});

test("FC-24 · a phone that can't create a passkey continues as checks-only", async ({ browser }) => {
  const p: Phone = await newPhone(browser, "Arjun Sharma", { passkeys: false });
  try {
    const { page } = p;
    await page.waitForURL((u) => u.pathname !== "/");
    while (!page.url().endsWith("/setup/role")) {
      const path = new URL(page.url()).pathname;
      if (path === "/install") await page.getByRole("button", { name: /Continue in browser/ }).click();
      else if (path === "/setup/language")
        await page
          .getByRole("radio", { name: /English/ })
          .first()
          .click();
      else if (path === "/setup/welcome") await page.getByRole("button", { name: "Skip" }).click();
      else if (path === "/setup/name") {
        await page.getByLabel("Your name").fill(p.name);
        await page.getByRole("button", { name: "Continue" }).click();
      }
      await page.waitForURL((u) => u.pathname !== path);
    }
    await page.getByRole("radio", { name: /Yes, set up my key/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Create my key/ }).click();
    await expect(
      page.getByText("This phone can't create a key, so family can't verify you yet. You can still check others."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/setup/done");
    await page.getByRole("button", { name: "Later" }).click();
    // Home, or A8 (alerts) first where this browser can receive pushes.
    await page.waitForURL((u) => u.pathname !== "/setup/done");
    await page.goto("/settings");
    await expect(page.getByText("Checks others")).toBeVisible();
    // Its card still has safety words (from the device keys), so family can confirm it in person.
    await page.goto("/family/my-code");
    await expect(page.getByRole("group", { name: "Safety words" }).first()).toHaveText(/[A-Z]{3,}/);
  } finally {
    await closeAll(p);
  }
});

test("F-21 · a passkey deleted from the password manager: F5, then 'your key may be missing'", async ({ browser }) => {
  const { maa, arjun } = await family(browser);
  try {
    await arjun.auth!.clearCredentials();
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    const yes = arjun.page.getByRole("button", { name: /Yes, it's me/ });
    await yes.click();
    await expect(arjun.page.getByText("Not confirmed. Tap to try again.")).toBeVisible({ timeout: 70_000 });
    await expect(arjun.page.getByText(/Your key may be missing/)).toHaveCount(0);
    await yes.click();
    await expect(arjun.page.getByText(/Your key may be missing from this phone/)).toBeVisible({ timeout: 70_000 });
    await arjun.page.getByRole("button", { name: "Set up my key again" }).click();
    await arjun.page.waitForURL("**/settings/key");
  } finally {
    await closeAll(maa, arjun);
  }
});

test("F-22 · browser storage cleared: the app starts fresh, as a new phone with a new ID", async ({ browser }) => {
  const arjun = await newPhone(browser, "Arjun Sharma");
  try {
    await setUp(arjun, { verifiable: true });
    const before = new URL(await linkOf(arjun)).hash;
    await arjun.page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase("pehchaan-default");
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
          r.onblocked = () => resolve(); // closes as the page reloads
        }),
    );
    await arjun.page.goto("/");
    await setUp(arjun, { verifiable: true });
    const after = new URL(await linkOf(arjun)).hash;
    const id = (hash: string) =>
      (JSON.parse(Buffer.from(hash.replace("#c=", ""), "base64url").toString()) as { d: string }).d;
    expect(id(after)).not.toBe(id(before));
  } finally {
    await closeAll(arjun);
  }
});

test("FC-18 · Privacy: the notice, Who can reach me, and Reset my code", async ({ browser }) => {
  const { maa, arjun } = await family(browser);
  try {
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    const { page } = arjun;
    await page.goto("/settings");
    await page.getByRole("button", { name: "Privacy notice" }).click();
    await expect(page.getByRole("heading", { name: "On our server in Mumbai" })).toBeVisible();
    await expect(page.getByText(/The server never stores names, phone numbers/)).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Who can reach me" }).click();
    // Maa reached Arjun through his code; Arjun's phone names her from his own family list.
    await expect(page.getByText("Maa")).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: /Reset my code/ }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByText(/Code reset\. Share your new code/)).toBeVisible();
  } finally {
    await closeAll(maa, arjun);
  }
});

test("FC-20 · Diagnostics shows the relay session, and hides nothing it shouldn't", async ({ browser }) => {
  const maa = await newPhone(browser, "Sunita Sharma");
  try {
    await setUp(maa, { verifiable: false });
    const { page } = maa;
    await page.goto("/settings");
    const version = page.getByRole("button", { name: /^Pehchaan \d/ });
    for (let i = 0; i < 5; i++) await version.click();
    await expect(page.getByText("Diagnostics unlocked")).toBeVisible();
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await expect(page.getByText("Relay environment")).toBeVisible();
    await expect(page.getByText("test", { exact: true })).toBeVisible();
    await expect(page.getByText("Gateway")).toBeVisible();
    await expect(page.getByText("Clock offset")).toBeVisible();
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(page.getByText("Storage", { exact: true })).toBeVisible();
    // The Security Lab opt-in is offered (this build has the Lab), behind the Lab password.
    await expect(page.getByRole("button", { name: "Allow Security Lab on this phone" })).toBeVisible();
  } finally {
    await closeAll(maa);
  }
});
