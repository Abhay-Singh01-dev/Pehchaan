// SEC-05 and APP-06 (backend spec 9.4, 9.5): the relay is the attacker, between it and one phone. Playwright's
// WebSocket routing forwards every frame, rewriting the relay's deliveries on the way:
//   - a sealed request arrives with its seal stripped and a readable one in its place → the phone (not in the
//     Security Lab) refuses it: F1 never opens;
//   - a sealed answer arrives with one byte of its ciphertext changed, or with the seal stripped and a readable
//     answer in its place → the asker's phone can't open it: INVALID "changed", never a green.
import { expect, test, type BrowserContext } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict } from "./fixtures/app";

type Frame = { t: string; body: Record<string, unknown> & { kind?: string; e2e?: { ct: string }; re?: string } };

/** Routes this phone's relay connection through `rewrite` (relay → phone only). */
function attackerRelay(rewrite: (f: Frame) => Frame) {
  return (ctx: BrowserContext) =>
    ctx.routeWebSocket(/\/v1\/ws$/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        const f = JSON.parse(String(m)) as Frame;
        ws.send(f.t === "deliver" ? JSON.stringify(rewrite(f)) : String(m));
      });
    });
}

const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64url");

/** A readable body in place of the seal: what a relay that "downgrades" would send. */
function stripSeal(f: Frame, plain: Record<string, unknown>): Frame {
  const { e2e: _sealed, ...rest } = f.body;
  return { ...f, body: { ...rest, plain, psig: b64(64) } };
}

test("SEC-05 · the relay strips the seal off a request and sends it readable: the phone refuses it", async ({
  browser,
}) => {
  let downgraded = 0;
  const [maa, arjun] = await Promise.all([
    newPhone(browser, "Sunita Sharma"),
    newPhone(browser, "Arjun Sharma", {
      beforeLoad: attackerRelay((f) => {
        if (f.body.kind !== "verify.request" || !f.body.e2e) return f;
        downgraded++;
        const now = Date.now();
        return stripSeal(f, {
          spk: b64(65),
          sek: b64(65),
          fromName: "Sunita",
          req: {
            v: 1,
            requestId: f.body.re,
            nonce: b64(32),
            fromDeviceId: f.body.from,
            toDeviceId: "unknown",
            claimedLabel: "Arjun",
            reason: "money",
            amountInr: 50000,
            createdAt: now,
            expiresAt: now + 60_000,
          },
        });
      }),
    }),
  ]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
    await ask(maa, /Arjun/);
    await expect.poll(() => downgraded, { timeout: 15_000 }).toBeGreaterThan(0);
    // The readable request reached Arjun's phone and was dropped: no F1, now or a few seconds later.
    await arjun.page.waitForTimeout(6_000);
    expect(new URL(arjun.page.url()).pathname).not.toMatch(/^\/request\//);
    await expect(arjun.page.getByRole("button", { name: /Yes, it's me/ })).toHaveCount(0);
  } finally {
    await closeAll(maa, arjun);
  }
});

test("APP-06 · an answer changed inside its seal, or with its seal stripped, is a Fake answer (changed)", async ({
  browser,
}) => {
  test.slow();
  let mode: "tamper" | "strip" = "tamper";
  const [maa, arjun] = await Promise.all([
    newPhone(browser, "Sunita Sharma", {
      beforeLoad: attackerRelay((f) => {
        if (f.body.kind !== "verify.answer" || !f.body.e2e) return f;
        if (mode === "tamper") {
          const ct = f.body.e2e.ct;
          const flipped = (ct[10] === "A" ? "B" : "A") + "";
          return { ...f, body: { ...f.body, e2e: { ...f.body.e2e, ct: ct.slice(0, 10) + flipped + ct.slice(11) } } };
        }
        return stripSeal(f, { spk: b64(65), ans: { requestId: f.body.re, decision: "ME" } });
      }),
    }),
    newPhone(browser, "Arjun Sharma"),
  ]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");

    for (const m of ["tamper", "strip"] as const) {
      mode = m;
      await ask(maa, /Arjun/);
      await answer(arjun, "yes"); // a genuine Yes, changed on the way
      expect(await verdict(maa), m).toBe("Fake answer");
      await expect(maa.page.getByText("The answer was changed on the way.")).toBeVisible();
      await arjun.page.goto("/home");
    }
  } finally {
    await closeAll(maa, arjun);
  }
});
