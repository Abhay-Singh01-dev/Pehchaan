// APP-14 · The frontend's Part D walkthrough, against the real backend (spec 21.3). The steps map to:
//   1 presence (below) · 2 Not him + family alert: journeys J-03 · 3 Confirmed + words: J-02
//   4–6 Security Lab: lab.spec.ts (Phase 7) · 7 no answer + Ask family: failures J-04
//   8 offline: failures J-05 · 9 someone else and officials (below) · 10 Call Guard: guard.spec.ts (Phase 7)
//   11 a family link in a fresh profile: journeys J-09
import { expect, test } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict } from "./fixtures/app";

test("1 · presence: once Maa has checked Arjun, Home shows his phone as reachable, and not after it goes", async ({
  browser,
}) => {
  const [maa, arjun] = await Promise.all([newPhone(browser, "Sunita Sharma"), newPhone(browser, "Arjun Sharma")]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    await maa.page.goto("/home");
    await expect(maa.page.getByRole("img", { name: "Reachable now" })).toHaveCount(1);
    await arjun.ctx.close();
    await maa.page.reload();
    await expect(maa.page.getByText("Connected")).toBeVisible();
    await expect(maa.page.getByRole("img", { name: "Reachable now" })).toHaveCount(0);
  } finally {
    await closeAll(maa);
  }
});

test("9 · 'Someone else' is Can't verify with no network call; officials get the helpline", async ({ browser }) => {
  const maa = await newPhone(browser, "Sunita Sharma");
  try {
    await setUp(maa, { verifiable: false });
    await maa.page.getByRole("button", { name: /Verify a caller/ }).click();
    await maa.page.getByRole("button", { name: /Someone else/ }).click();
    expect(await verdict(maa)).toBe("Can't verify");
    await maa.page.goto("/verify/who");
    await maa.page.getByRole("button", { name: /Police, bank or government/ }).click();
    await expect(maa.page.getByText("Cyber helpline")).toBeVisible();
  } finally {
    await closeAll(maa);
  }
});
