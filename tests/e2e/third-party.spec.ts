// APP-12, network half (spec 16.5): the app talks to nobody but itself and the relay (and Sentry, when a DSN is
// set; none is in this build). Every request every page makes during a whole journey (setup, adding each other, a
// check, the Lab and Call Guard pages) is recorded, WebSockets included.
import { expect, test, type Page } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict, type Phone } from "./fixtures/app";
import { RELAY_PORT, WEB_PORT } from "./playwright.config";

const ALLOWED = new Set([`localhost:${WEB_PORT}`, `localhost:${RELAY_PORT}`]);

function record(page: Page, hosts: Set<string>) {
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.host);
  });
  page.on("websocket", (ws) => hosts.add(new URL(ws.url()).host));
}

test("APP-12 · the app contacts only its own origin and the relay", async ({ browser }) => {
  const hosts = new Set<string>();
  const [maa, arjun] = await Promise.all([
    newPhone(browser, "Sunita Sharma", { beforeLoad: async (ctx) => ctx.on("page", (p) => record(p, hosts)) }),
    newPhone(browser, "Arjun Sharma", { beforeLoad: async (ctx) => ctx.on("page", (p) => record(p, hosts)) }),
  ]);
  const phones: Phone[] = [maa, arjun];
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    for (const path of ["/settings", "/settings/alerts", "/settings/privacy", "/diagnostics", "/lab", "/guard"]) {
      await maa.page.goto(path);
      await maa.page.waitForLoadState("networkidle");
    }
    expect(hosts.size).toBeGreaterThan(0);
    expect([...hosts].filter((h) => !ALLOWED.has(h))).toEqual([]);
  } finally {
    await closeAll(...phones);
  }
});
