// J-13 (backend spec 13.2, FC-22): Call Guard in scripted mode, end to end through the real relay. The laptop pairs
// with Maa's phone by her family card (after comparing the four safety words), listens to the scripted call, and
// sends one sealed prompt; Maa's phone shows the B2 banner, and "Verify now" checks Arjun for real.
import { expect, test } from "@playwright/test";
import { addInPerson, answer, closeAll, linkOf, newPhone, ownWords, setUp, verdict } from "./fixtures/app";

test("J-13 · Call Guard (scripted): paired with Maa's phone by card, its prompt leads to a real check", async ({
  browser,
}) => {
  test.setTimeout(6 * 60_000);
  const [maa, arjun, laptop] = await Promise.all([
    newPhone(browser, "Sunita Sharma"),
    newPhone(browser, "Arjun Sharma"),
    newPhone(browser, "Guard laptop"),
  ]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
    const maaWords = await ownWords(maa);

    const guard = laptop.page;
    await guard.setViewportSize({ width: 1400, height: 1000 });
    await guard.goto("/guard");
    // The consent line is always on the page (13.2).
    await expect(guard.getByText("Use Call Guard only with the consent of the person whose call it is.")).toBeVisible();

    // "+ Add a phone": paste Maa's family link, compare the words with her phone's own, save.
    await guard.getByLabel("Send prompts to:").selectOption({ label: "+ Add a phone" });
    await guard.getByLabel("Or paste the family link").fill(await linkOf(maa));
    await guard.getByRole("button", { name: "Read link" }).click();
    const shown = await guard.getByRole("group", { name: "Safety words" }).innerText();
    expect(shown.replace(/[^A-Z]+/g, " ").trim()).toBe(maaWords);
    await guard.getByRole("button", { name: "They match · Save" }).click();
    await expect(guard.getByLabel("Send prompts to:")).toHaveValue(/.+/);
    await expect(guard.getByRole("option", { name: "Sunita's phone" })).toHaveCount(1);

    // The scripted call: a claim ("main Arjun"), then money. Auto-send fires once.
    await guard.getByRole("button", { name: "Start" }).click();
    await expect(guard.getByText(/Sent at \d/)).toBeVisible({ timeout: 90_000 });

    // Maa's phone (open on Home): the B2 banner, then a real check of Arjun.
    await expect(maa.page.getByText("Caller says they're Arjun and wants ₹50,000")).toBeVisible({ timeout: 30_000 });
    await maa.page.getByRole("button", { name: "Verify now" }).click();
    await maa.page.waitForURL("**/verify/waiting/**");
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
  } finally {
    await closeAll(maa, arjun, laptop);
  }
});
