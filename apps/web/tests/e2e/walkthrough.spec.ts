// Part D · Full walkthrough (simulation mode). One browser, several tabs acting as phones.
import { expect, test } from "@playwright/test";
import { answer, askFromHome, newContext, openPhone, PHONE, verdict } from "./helpers";

test.describe("Part D walkthrough", () => {
  test("1–3 · presence, Not him (Priya alerted), Confirmed with say-the-words", async ({ browser }) => {
    const ctx = await newContext(browser);
    const maa = await openPhone(ctx, "maa");
    const arjun = await openPhone(ctx, "arjun");
    const priya = await openPhone(ctx, "priya");

    // 1 · Presence: Maa sees the others as reachable, the pill reads Connected.
    await maa.bringToFront();
    await expect(maa.getByText("Connected")).toBeVisible();
    await expect(maa.getByRole("img", { name: "Reachable now" })).toHaveCount(2, { timeout: 10_000 });

    // 2 · Not him → red, 7 green ticks under Why?, and Priya gets the G1 banner.
    await askFromHome(maa);
    await answer(arjun, "no");
    await expect(arjun.getByText(/We told Maa it's not you/)).toBeVisible();
    expect(await verdict(maa)).toBe("Not Arjun");
    await maa.getByRole("button", { name: /Why\?/ }).click();
    await expect(maa.getByText("All 7 checks passed")).toBeVisible();
    await priya.bringToFront();
    await expect(priya.getByText(/Someone pretended to be Arjun/).first()).toBeVisible();

    // 3 · Confirmed, with the same two words on both phones.
    await arjun.goto("/home");
    await askFromHome(maa);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    const words = await maa
      .getByText(/Ask Arjun to say these words/)
      .locator("xpath=following-sibling::p[1]")
      .textContent();
    await arjun.bringToFront();
    const arjunWords = await arjun
      .getByText(/Say these words to Maa/)
      .locator("xpath=following-sibling::p[1]")
      .textContent();
    expect(words?.replace(/\s+/g, " ").trim()).toBe(arjunWords?.replace(/\s+/g, " ").trim());
    await ctx.close();
  });

  test("4–6 · Security Lab: change, replay and forge are all rejected, 0 false greens", async ({ browser }) => {
    const ctx = await newContext(browser);
    const lab = await ctx.newPage();
    await lab.setViewportSize({ width: 1366, height: 900 });
    await lab.goto("/lab?device=lab");
    const maa = await openPhone(ctx, "maa");
    const arjun = await openPhone(ctx, "arjun");

    // A genuine yes first, so there's something to replay.
    await askFromHome(maa);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    await arjun.goto("/home");

    await lab.bringToFront();
    await lab.getByRole("button", { name: "Reset counters" }).click();
    await lab.getByRole("switch", { name: "Attacker mode" }).click();

    // 4 · Change the next answer
    await lab.getByRole("button", { name: "Arm" }).nth(0).click();
    await askFromHome(maa);
    await answer(arjun, "no");
    expect(await verdict(maa)).toBe("Fake answer");
    await expect(maa.getByText("The answer was changed on the way.")).toBeVisible();
    await arjun.goto("/home");

    // 5 · Replay Arjun's last yes (Arjun's phone never gets the request)
    await lab.bringToFront();
    await lab.getByRole("button", { name: "Arm" }).nth(1).click();
    await askFromHome(maa);
    expect(await verdict(maa)).toBe("Fake answer");
    await expect(maa.getByText("An old answer was sent again.")).toBeVisible();

    // 6 · Forge a yes
    await lab.bringToFront();
    await lab.getByRole("button", { name: "Arm" }).nth(2).click();
    await askFromHome(maa);
    expect(await verdict(maa)).toBe("Fake answer");
    await expect(maa.getByText("It was signed by a key that isn't Arjun's.")).toBeVisible();

    await lab.bringToFront();
    await expect(lab.locator('[role="text"][aria-label="3"]')).toBeVisible();
    await expect(lab.locator('[role="text"][aria-label="0"]')).toBeVisible();
    await ctx.close();
  });

  test("8–9 · offline fails closed; someone else and officials", async ({ browser }) => {
    const ctx = await newContext(browser);
    const maa = await openPhone(ctx, "maa");

    await maa.getByRole("button", { name: /Verify a caller/ }).click();
    await maa.getByRole("button", { name: /Someone else/ }).click();
    expect(await verdict(maa)).toBe("Can't verify");

    await maa.goto("/verify/who");
    await maa.getByRole("button", { name: /Police, bank or government/ }).click();
    await expect(maa.getByText("Cyber helpline")).toBeVisible();

    await maa.evaluate(() =>
      (
        window as never as { __pehchaan: { simControls: { forceConnection(s: string): void } } }
      ).__pehchaan.simControls.forceConnection("offline"),
    );
    await maa.goto("/verify/who");
    await maa.evaluate(() =>
      (
        window as never as { __pehchaan: { simControls: { forceConnection(s: string): void } } }
      ).__pehchaan.simControls.forceConnection("offline"),
    );
    await expect(maa.getByText(/You're offline/)).toBeVisible();
    await maa.getByRole("button", { name: /Arjun/ }).first().click();
    await maa.getByRole("button", { name: /Ask Arjun's phone/ }).click();
    expect(await verdict(maa)).toBe("Not confirmed yet");
    await expect(maa.getByText("Couldn't reach the network.")).toBeVisible();
    await ctx.close();
  });

  test("10 · Call Guard's prompt appears on Maa's phone and opens the waiting screen", async ({ browser }) => {
    const ctx = await newContext(browser);
    const maa = await openPhone(ctx, "maa");
    const guard = await ctx.newPage();
    await guard.setViewportSize({ width: 1366, height: 900 });
    await guard.goto("/guard?device=guard");
    // Maa's phone is picked by default (device IDs come from each phone's key, so match it by name).
    await expect(guard.getByRole("combobox").locator("option:checked")).toHaveText(/Sunita/, { timeout: 15_000 });
    await guard.getByRole("button", { name: /^Start$/ }).click();
    for (let i = 0; i < 2; i++) {
      await guard.waitForTimeout(2800);
      await guard
        .getByRole("button", { name: "Next line" })
        .click()
        .catch(() => {});
    }
    await maa.bringToFront();
    await expect(maa.getByText(/Caller says they're Arjun/)).toBeVisible({ timeout: 20_000 });
    await maa.getByRole("button", { name: "Verify now" }).click();
    await maa.waitForURL("**/verify/waiting/**");
    await ctx.close();
  });

  test("11 · the family link works in a fresh browser profile and reaches a verdict", async ({ browser }) => {
    const home = await newContext(browser);
    const arjun = await openPhone(home, "arjun");
    await arjun.waitForFunction(() => Boolean((window as never as { __pehchaan?: unknown }).__pehchaan));
    const link = (await arjun.evaluate(() =>
      (window as never as { __pehchaan: { myLink(): Promise<string | null> } }).__pehchaan.myLink(),
    ))!;
    await home.close();

    const priv = await newContext(browser); // the "private window"
    const arjun2 = await openPhone(priv, "arjun");
    const guest = await priv.newPage();
    await guest.setViewportSize(PHONE);
    await guest.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await expect(guest.getByText(/shared their Pehchaan card/)).toBeVisible();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: /Yes, they match/ }).click();
    await guest.getByRole("button", { name: /Verify Arjun now/ }).click();
    await guest.getByRole("button", { name: /Ask Arjun's phone/ }).click();
    await answer(arjun2, "yes");
    expect(await verdict(guest)).toBe("Confirmed");
    await priv.close();
  });

  test("7 · no answer in 60 s ends amber, the request expires on Arjun's phone, family asked", async ({ browser }) => {
    test.slow();
    const ctx = await newContext(browser);
    const maa = await openPhone(ctx, "maa");
    const arjun = await openPhone(ctx, "arjun");
    const priya = await openPhone(ctx, "priya");
    await askFromHome(maa);
    await arjun.waitForURL("**/request/**");
    await maa.bringToFront();
    await maa.waitForURL("**/verify/result/**", { timeout: 75_000 });
    expect(await verdict(maa)).toBe("Not confirmed yet");
    await arjun.bringToFront();
    await expect(arjun.getByText(/This request expired/)).toBeVisible();
    await maa.bringToFront();
    await maa.getByRole("button", { name: /Ask family to reach Arjun/ }).click();
    await expect(maa.getByText(/Sent to/)).toBeVisible();
    await priya.bringToFront();
    await expect(priya.getByText(/Can you check on Arjun/).first()).toBeVisible();
    await ctx.close();
  });
});
