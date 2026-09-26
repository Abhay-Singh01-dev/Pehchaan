// J-06 (backend spec 11, Part E): Arjun's app is closed; the check reaches him by Web Push. The relay encrypts and
// signs a real push, the local stand-in push service captures and decrypts it, the test opens the notification's
// URL (as a tap would), and Arjun answers.
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { newSubscription, startMockPush, type MockPush } from "../../apps/relay/test/helpers/mock-push";
import { addInPerson, answer, ask, closeAll, closeApp, linkOf, newPhone, setUp, verdict } from "./fixtures/app";
import { givePushSubscription } from "./fixtures/push";
import { MOCK_PUSH_PORT, WEB_PORT } from "./playwright.config";

let mock: MockPush;
test.beforeAll(async () => {
  mock = await startMockPush(MOCK_PUSH_PORT);
});
test.afterAll(async () => {
  await mock?.close();
});

/** 11.3: the push Topic, so a cancel replaces its request in the push service's queue. */
const topicFor = (requestId: string) => createHash("sha256").update(requestId).digest("base64url").slice(0, 32);

test("J-06 · Arjun's app is closed: the push reaches his phone, the notification opens the request, he answers", async ({
  browser,
}) => {
  const sub = newSubscription();
  mock.register(sub);
  const [maa, arjun] = await Promise.all([
    newPhone(browser, "Sunita Sharma"),
    newPhone(browser, "Arjun Sharma", {
      beforeLoad: (ctx) => givePushSubscription(ctx, sub, `http://localhost:${WEB_PORT}`),
    }),
  ]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true, alerts: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");

    // A8 turned alerts on: Settings says so.
    await arjun.page.goto("/settings/alerts");
    await expect(arjun.page.getByTestId("alerts-state")).toHaveText("On");

    const reopen = await closeApp(arjun);
    await ask(maa, /Arjun/);

    // The relay pushed the sealed request to the subscription A8 registered (11.3).
    const pushed = await mock.waitFor((p) => p.endpoint === sub.endpoint && p.payload !== null, 20_000);
    expect(pushed.jwt.valid, "VAPID JWT (aud, exp, sub, signature)").toBe(true);
    expect(pushed.contentEncoding).toBe("aes128gcm");
    expect(pushed.urgency).toBe("high");
    expect(pushed.ttl).toBeGreaterThan(0);
    expect(pushed.ttl).toBeLessThanOrEqual(60);
    const frame = JSON.parse(pushed.payload!) as {
      t: string;
      id: string;
      body: { kind: string; re: string; e2e?: unknown };
    };
    expect(frame).toMatchObject({ t: "deliver", body: { kind: "verify.request" } });
    const requestId = frame.body.re;
    expect(frame.id).toBe(requestId);
    expect(pushed.topic).toBe(topicFor(requestId));
    // End-to-end sealed inside the push: neither the push service nor the lock screen sees the amount.
    expect(frame.body.e2e).toBeTruthy();
    expect(pushed.payload).not.toMatch(/50,?000|money/);

    // The notification's URL for a request (11.6). The app opens there and shows F1.
    await reopen(`/request/${requestId}`);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
  } finally {
    await closeAll(maa, arjun);
  }
});
