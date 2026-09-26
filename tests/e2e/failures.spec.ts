// When things go wrong (spec 23), against the real relay: nobody answers, Maa's phone is offline or can't reach
// the relay, Arjun removes Maa, Arjun has the app open twice. Each test builds its own phones.
import { expect, test, type Browser } from "@playwright/test";
import {
  addByLink,
  addInPerson,
  answer,
  ask,
  closeAll,
  linkOf,
  newPhone,
  setUp,
  verdict,
  type Phone,
} from "./fixtures/app";
import { addVirtualAuthenticator } from "./fixtures/webauthn";

async function maaAndArjun(browser: Browser): Promise<{ maa: Phone; arjun: Phone }> {
  const [maa, arjun] = await Promise.all([newPhone(browser, "Sunita Sharma"), newPhone(browser, "Arjun Sharma")]);
  await setUp(maa, { verifiable: false });
  await setUp(arjun, { verifiable: true, phone: "98100 00010" });
  await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
  await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
  return { maa, arjun };
}

test("J-04 · no answer: 'Not confirmed yet' at 60 s, and 'Ask family' reaches Papa (G2)", async ({ browser }) => {
  test.slow(); // three phones, then a full 60 s wait
  const { maa, arjun } = await maaAndArjun(browser);
  const papa = await newPhone(browser, "Ramesh Sharma");
  try {
    await setUp(papa, { verifiable: false });
    await addInPerson(maa, await linkOf(papa), "Husband", "Ramesh");
    await addInPerson(papa, await linkOf(arjun), "Son", "Arjun");
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    // Arjun doesn't answer. Maa's own 60 s timer ends the check (never green).
    expect(await verdict(maa, 90_000)).toBe("Not confirmed yet");
    await expect(maa.page.getByText("Couldn't reach the network.")).toHaveCount(0);
    await maa.page.getByRole("button", { name: /Ask family to reach Arjun/ }).click();
    await expect(maa.page.getByText(/Sent to Ramesh/)).toBeVisible();
    await expect(papa.page.getByText(/Can you check on Arjun\?/).first()).toBeVisible();
    // Arjun's own countdown (from the relay's ttlMs) ended too: F4.
    await expect(arjun.page.getByText(/This request expired/)).toBeVisible();
  } finally {
    await closeAll(maa, arjun, papa);
  }
});

test("J-05 · Maa offline → 'Couldn't reach the network'; relay unreachable → the same, never green", async ({
  browser,
}) => {
  const { maa, arjun } = await maaAndArjun(browser);
  let lonely: Phone | undefined;
  try {
    // Offline while the app is open (no reload: the dev build has no service worker to serve one offline, so this
    // also proves the asking and verdict screens were preloaded). D1 says so, and asking fails closed at once.
    await maa.page.goto("/home");
    await expect(maa.page.getByText("Connected")).toBeVisible();
    await maa.ctx.setOffline(true);
    await expect(maa.page.getByText("Offline", { exact: true })).toBeVisible();
    await maa.page.getByRole("button", { name: /Verify a caller/ }).click();
    await expect(maa.page.getByText(/You're offline/)).toBeVisible();
    await maa.page.getByRole("button", { name: /Arjun/ }).first().click();
    await maa.page.getByRole("button", { name: /Ask Arjun's phone/ }).click();
    expect(await verdict(maa)).toBe("Not confirmed yet");
    await expect(maa.page.getByText("Couldn't reach the network.")).toBeVisible();
    await maa.ctx.setOffline(false);

    // The relay can't be reached (the network is up, but every connection to the relay is dropped).
    lonely = await newPhone(browser, "Sunita Sharma", {
      beforeLoad: (ctx) => ctx.routeWebSocket(/\/v1\/ws$/, (ws) => ws.close({ code: 1006, reason: "unreachable" })),
    });
    await setUpWithoutRelay(lonely);
    await addByLink(lonely, await linkOf(arjun));
    await lonely.page.goto("/home");
    await lonely.page.getByRole("button", { name: /Verify a caller/ }).click();
    await lonely.page.getByRole("button", { name: /Arjun/ }).first().click();
    await lonely.page.getByRole("button", { name: /Ask Arjun's phone/ }).click();
    expect(await verdict(lonely)).toBe("Not confirmed yet");
    await expect(lonely.page.getByText("Couldn't reach the network.")).toBeVisible();
  } finally {
    await closeAll(maa, arjun, ...(lonely ? [lonely] : []));
  }
});

/** Setup never needs the relay: the same steps as setUp(), without waiting for "Connected". */
async function setUpWithoutRelay(p: Phone) {
  const { page } = p;
  await page.waitForURL((u) => u.pathname !== "/");
  for (let i = 0; i < 20 && !page.url().endsWith("/home"); i++) {
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
    } else if (path === "/setup/role") {
      await page.getByRole("radio", { name: /No, I only check others/ }).click();
      await page.getByRole("button", { name: "Continue" }).click();
    } else if (path === "/setup/done") await page.getByRole("button", { name: "Later" }).click();
    else if (path === "/setup/notifications") await page.getByRole("button", { name: "Not now" }).click();
    else throw new Error(`setUpWithoutRelay: unexpected screen ${path}`);
    await page.waitForURL((u) => u.pathname !== path);
  }
}

test("J-11 · Arjun removes Maa (and resets his code): her checks are refused, and so is his old card", async ({
  browser,
}) => {
  const { maa, arjun } = await maaAndArjun(browser);
  const stranger = await newPhone(browser, "Neighbour");
  try {
    const oldLink = await linkOf(arjun);
    // One check first, so Maa's phone is known to the relay (a binding exists).
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");

    // C7: Remove Maa, with "Also reset my code" (on by default).
    await arjun.page.goto("/family");
    await arjun.page.getByRole("button", { name: /Maa/ }).first().click();
    await arjun.page.getByRole("button", { name: /Remove from family/ }).click();
    await expect(arjun.page.getByRole("checkbox", { name: /Also reset my code/ })).toBeChecked();
    await arjun.page.getByRole("button", { name: "Remove", exact: true }).click();
    await arjun.page.waitForURL("**/family");
    await expect(arjun.page.getByText("Maa removed")).toBeVisible();

    // FC-13: Maa's next check ends at once with the not-accepting line.
    await ask(maa, /Arjun/);
    expect(await verdict(maa)).toBe("Not confirmed yet");
    await expect(maa.page.getByText(/Arjun's phone isn't accepting checks from you/)).toBeVisible();

    // Someone who only has Arjun's OLD card (from before the reset) can't reach him either.
    await setUp(stranger, { verifiable: false });
    await addByLink(stranger, oldLink);
    await stranger.page.goto("/home");
    await ask(stranger, /Arjun/);
    expect(await verdict(stranger)).toBe("Not confirmed yet");
    await expect(stranger.page.getByText(/Arjun's phone isn't accepting checks from you/)).toBeVisible();
  } finally {
    await closeAll(maa, arjun, stranger);
  }
});

test("J-17 · Arjun has Pehchaan open in two tabs: answering in one closes the other", async ({ browser }) => {
  const { maa, arjun } = await maaAndArjun(browser);
  try {
    const second = await arjun.ctx.newPage();
    await addVirtualAuthenticator(second);
    await second.goto("/home");
    await expect(second.getByText("Connected")).toBeVisible();
    await ask(maa, /Arjun/);
    await arjun.page.waitForURL("**/request/**");
    await second.waitForURL("**/request/**");
    await answer(arjun, "no");
    expect(await verdict(maa)).toBe("Not Arjun");
    // The other tab can no longer answer: it shows the answer that was sent.
    await second.waitForURL("**/sent");
    await expect(second.getByRole("button", { name: /NO, NOT ME/ })).toHaveCount(0);
  } finally {
    await closeAll(maa, arjun);
  }
});
