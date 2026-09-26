// The "new phone" scam guard (spec 6.5, APP-04, J-10), every row, in the real app. A card can only ever add a
// NEW person; one that impersonates or alters a saved member is blocked outright.
import { expect, test, type Page } from "@playwright/test";
import { addInPerson, closeAll, linkOf, newPhone, setUp, type Phone } from "./fixtures/app";

/** Opens a code on C4 (Scan → Paste code instead), as scanning it in person would. */
async function pasteCode(page: Page, link: string) {
  await page.goto("/family/scan");
  await page.getByRole("button", { name: /Paste code instead/ }).click();
  await page.getByRole("textbox", { name: "Paste their code" }).fill(link);
  await page.getByRole("button", { name: "Add from code" }).click();
}

/** Opens a family link (C8). */
async function openLink(page: Page, link: string) {
  const u = new URL(link);
  await page.goto(u.pathname + u.hash);
}

/** Rewrites one field of a card link, keeping everything else (what an attacker would do). */
function withField(link: string, field: string, value: string): string {
  const u = new URL(link);
  const code = u.hash.replace(/^#c=/, "");
  const card = JSON.parse(Buffer.from(code, "base64url").toString("utf8")) as Record<string, unknown>;
  card[field] = value;
  u.hash = `c=${Buffer.from(JSON.stringify(card), "utf8").toString("base64url")}`;
  return u.toString();
}

const fieldOf = (link: string, field: string) =>
  (
    JSON.parse(Buffer.from(new URL(link).hash.replace(/^#c=/, ""), "base64url").toString("utf8")) as Record<
      string,
      string
    >
  )[field]!;

async function maaWithArjun(browser: Parameters<typeof newPhone>[0]): Promise<{ maa: Phone; arjun: Phone }> {
  const [maa, arjun] = await Promise.all([newPhone(browser, "Sunita Sharma"), newPhone(browser, "Arjun Sharma")]);
  await setUp(maa, { verifiable: false });
  await setUp(arjun, { verifiable: true, phone: "98100 00010" });
  await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
  return { maa, arjun };
}

test("the same card again: 'already in your family', in person and by link, never replaced", async ({ browser }) => {
  const { maa, arjun } = await maaWithArjun(browser);
  try {
    const link = await linkOf(arjun);
    await pasteCode(maa.page, link);
    await expect(maa.page.getByText("Arjun is already in your family.")).toBeVisible();
    await openLink(maa.page, link);
    await expect(maa.page.getByText("Arjun is already in your family.")).toBeVisible();
    await expect(maa.page.getByRole("button", { name: "Verify Arjun now" })).toBeVisible();
  } finally {
    await closeAll(maa, arjun);
  }
});

test("the same phone ID with different keys: 'This card has been altered', nothing added", async ({ browser }) => {
  const { maa, arjun } = await maaWithArjun(browser);
  const other = await newPhone(browser, "Other");
  try {
    await setUp(other, { verifiable: false });
    // Arjun's card, but sealing to someone else's encryption key: the device ID still matches its signing key.
    const altered = withField(await linkOf(arjun), "ek", fieldOf(await linkOf(other), "ek"));
    await pasteCode(maa.page, altered);
    await expect(maa.page.getByRole("alertdialog")).toBeVisible();
    await expect(maa.page.getByText("This card has been altered. Don't add it.")).toBeVisible();
    await maa.page.getByRole("button", { name: "Don't add" }).click();
    await openLink(maa.page, altered);
    await expect(maa.page.getByText("This card has been altered. Don't add it.")).toBeVisible();
  } finally {
    await closeAll(maa, arjun, other);
  }
});

test("J-10 · a 'new phone' link using Arjun's name gets the red warning, and nothing is added", async ({ browser }) => {
  const { maa, arjun } = await maaWithArjun(browser);
  const scammer = await newPhone(browser, "Arjun Sharma");
  try {
    await setUp(scammer, { verifiable: true });
    await openLink(maa.page, await linkOf(scammer));
    await expect(maa.page.getByRole("alertdialog")).toBeVisible();
    await expect(maa.page.getByText("This is not the Arjun you saved")).toBeVisible();
    // The only way forward besides "Don't add" is calling the saved Arjun.
    await expect(maa.page.getByText("Call Arjun on their saved number")).toBeVisible();
    await expect(maa.page.getByRole("link", { name: /Call .*98100 00010/ })).toBeVisible();
    await maa.page.getByRole("button", { name: "Don't add" }).click();
    await maa.page.goto("/family");
    await expect(maa.page.getByRole("button", { name: /Arjun/ })).toHaveCount(1);
  } finally {
    await closeAll(maa, arjun, scammer);
  }
});

test("a different name but Arjun's saved phone number is also an impostor", async ({ browser }) => {
  const { maa, arjun } = await maaWithArjun(browser);
  const scammer = await newPhone(browser, "Rahul Verma");
  try {
    // Typed without spaces (the field has +91 already): the guard compares the digits, not the formatting.
    await setUp(scammer, { verifiable: true, phone: "9810000010" });
    await pasteCode(maa.page, await linkOf(scammer));
    await expect(maa.page.getByText("This is not the Arjun you saved")).toBeVisible();
    await maa.page.getByRole("button", { name: "Don't add" }).click();
    await maa.page.goto("/family");
    await expect(maa.page.getByRole("button", { name: /Rahul/ })).toHaveCount(0);
  } finally {
    await closeAll(maa, arjun, scammer);
  }
});
