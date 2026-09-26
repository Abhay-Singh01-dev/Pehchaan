// Part E journeys against the real relay (spec 21.3): real passkeys (a virtual authenticator per phone), the
// real verifier, end-to-end sealed envelopes, Valkey and Postgres. Each test builds its own family from empty
// phones, so tests never depend on each other.
import { expect, test } from "@playwright/test";
import {
  addByLink,
  addInPerson,
  answer,
  ask,
  closeAll,
  confirmationWords,
  linkOf,
  newPhone,
  ownWords,
  setUp,
  verdict,
  type Phone,
} from "./fixtures/app";

/** Maa (checks others) and Arjun (can be verified) who have added each other in person. */
async function maaAndArjun(browser: Parameters<typeof newPhone>[0]): Promise<{ maa: Phone; arjun: Phone }> {
  const [maa, arjun] = await Promise.all([newPhone(browser, "Sunita Sharma"), newPhone(browser, "Arjun Sharma")]);
  await setUp(maa, { verifiable: false, phone: "98100 00021" });
  await setUp(arjun, { verifiable: true, phone: "98100 00010" });
  await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
  await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
  return { maa, arjun };
}

test("J-01 · set up both phones, add each other in person, and the safety words match", async ({ browser }) => {
  const [maa, arjun] = await Promise.all([newPhone(browser, "Sunita Sharma"), newPhone(browser, "Arjun Sharma")]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    const arjunOwn = await ownWords(arjun);
    const maaOwn = await ownWords(maa);
    expect(arjunOwn.split(" ")).toHaveLength(4);
    // What Maa's phone derives from Arjun's card is exactly what Arjun's phone shows (6.3), and vice versa.
    expect(await addInPerson(maa, await linkOf(arjun), "Son", "Arjun")).toBe(arjunOwn);
    expect(await addInPerson(arjun, await linkOf(maa), "Mother", "Maa")).toBe(maaOwn);
    await maa.page.goto("/family");
    await expect(maa.page.getByRole("button", { name: /Arjun/ })).toBeVisible();
  } finally {
    await closeAll(maa, arjun);
  }
});

test("J-02 · a genuine YES is Confirmed, with the same two words on both phones (APP-10)", async ({ browser }) => {
  const { maa, arjun } = await maaAndArjun(browser);
  try {
    await ask(maa, /Arjun/);
    // FC-12: the status line follows the receipts.
    await expect(maa.page.getByText(/^(Sent|Delivered|Seen by Arjun)$/)).toBeVisible();
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    const onMaa = await confirmationWords(maa.page, /Ask Arjun to say these words/);
    const onArjun = await confirmationWords(arjun.page, /Say these words to Maa/);
    expect(onMaa).toMatch(/^[A-Z]+ [A-Z]+$/);
    expect(onMaa).toBe(onArjun);
    await maa.page.getByRole("button", { name: /Why\?/ }).click();
    await expect(maa.page.getByText("All 7 checks passed")).toBeVisible();
  } finally {
    await closeAll(maa, arjun);
  }
});

test("J-03 · NOT ME is 'Not Arjun', and Papa gets the family alert (G1)", async ({ browser }) => {
  const { maa, arjun } = await maaAndArjun(browser);
  const papa = await newPhone(browser, "Ramesh Sharma");
  try {
    await setUp(papa, { verifiable: false });
    // Maa holds Papa's card (so she can alert him); Papa holds Arjun's (so he can name him).
    await addInPerson(maa, await linkOf(papa), "Husband", "Ramesh");
    await addInPerson(papa, await linkOf(arjun), "Son", "Arjun");
    await ask(maa, /Arjun/);
    await answer(arjun, "no");
    await expect(arjun.page.getByText(/We told Maa it's not you/)).toBeVisible();
    expect(await verdict(maa)).toBe("Not Arjun");
    await expect(maa.page.getByText(/Family alerted: Ramesh/)).toBeVisible();
    await expect(papa.page.getByText(/Someone pretended to be Arjun/).first()).toBeVisible();
  } finally {
    await closeAll(maa, arjun, papa);
  }
});

test("J-07 · Maa stops waiting: Arjun's phone says so and can't answer", async ({ browser }) => {
  const { maa, arjun } = await maaAndArjun(browser);
  try {
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    await maa.page.getByRole("button", { name: "Cancel" }).click();
    await maa.page.getByRole("button", { name: "Stop waiting" }).click();
    await maa.page.waitForURL("**/home");
    await expect(
      arjun.page.getByText("Sunita Sharma stopped waiting.").or(arjun.page.getByText("Maa stopped waiting.")),
    ).toBeVisible();
    await expect(arjun.page.getByRole("button", { name: /NO, NOT ME/ })).toHaveCount(0);
  } finally {
    await closeAll(maa, arjun);
  }
});

test("J-09 · a judge opens Arjun's family link on their own phone and checks him", async ({ browser }) => {
  const [arjun, judge] = await Promise.all([newPhone(browser, "Arjun Sharma"), newPhone(browser, "Judge")]);
  try {
    await setUp(arjun, { verifiable: true });
    const words = await addByLink(judge, await linkOf(arjun));
    expect(words).toBe(await ownWords(arjun));
    await judge.page.getByRole("button", { name: /Verify Arjun now/ }).click();
    await judge.page.waitForURL("**/verify/what");
    await judge.page.getByRole("button", { name: /Ask .*phone/ }).click();
    await answer(arjun, "yes");
    expect(await verdict(judge)).toBe("Confirmed");
  } finally {
    await closeAll(arjun, judge);
  }
});

test("J-15 · a double tap on NOT ME sends one answer and gives one verdict", async ({ browser }) => {
  const { maa, arjun } = await maaAndArjun(browser);
  try {
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    const no = arjun.page.getByRole("button", { name: /NO, NOT ME/ });
    await no.dblclick();
    await arjun.page.waitForURL("**/sent");
    expect(await verdict(maa)).toBe("Not Arjun");
    // One check on Maa's phone, one answer on Arjun's: the second tap did nothing.
    await maa.page.goto("/history");
    await expect(maa.page.getByRole("button", { name: /Checked Arjun/ })).toHaveCount(1);
    await expect(maa.page.getByRole("button", { name: /Checked Arjun/ })).toContainText("Not them");
    await arjun.page.goto("/history");
    await arjun.page.getByRole("tab", { name: "Asked of me" }).click();
    await expect(arjun.page.getByRole("button", { name: /Answered Maa/ })).toHaveCount(1);
  } finally {
    await closeAll(maa, arjun);
  }
});
