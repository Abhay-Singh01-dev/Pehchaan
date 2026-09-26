// J-08 · The late-answer policy (spec 8.8, 10.7) against the real relay. Arjun answers in time, but his answer is
// held in transit (as a slow network would) until Maa's 60 s timer has ended; the relay still forwards it within
// its 30 s grace, marked late. A late NOT ME turns Maa's screen red; a late YES never turns it green.
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { addInPerson, ask, closeAll, linkOf, newPhone, setUp, verdict, type Phone } from "./fixtures/app";

/** Holds Arjun's outgoing answers (every retry of them) until released; everything else flows normally. */
function answerGate() {
  let holding = true;
  const held: Array<() => void> = [];
  return {
    async install(ctx: BrowserContext) {
      await ctx.routeWebSocket(/\/v1\/ws$/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((message) => {
          let isAnswer = false;
          if (typeof message === "string") {
            try {
              const f = JSON.parse(message) as { t?: string; body?: { kind?: string } };
              isAnswer = f.t === "send" && f.body?.kind === "verify.answer";
            } catch {
              /* not JSON: pass it on */
            }
          }
          if (isAnswer && holding) held.push(() => server.send(message));
          else server.send(message);
        });
      });
    },
    release() {
      holding = false;
      for (const send of held.splice(0)) send();
    },
  };
}

async function family(browser: Browser, gate: ReturnType<typeof answerGate>): Promise<{ maa: Phone; arjun: Phone }> {
  const maa = await newPhone(browser, "Sunita Sharma");
  const arjun = await newPhone(browser, "Arjun Sharma", { beforeLoad: (ctx) => gate.install(ctx) });
  await setUp(maa, { verifiable: false });
  await setUp(arjun, { verifiable: true });
  await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
  await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
  return { maa, arjun };
}

async function answerNow(arjun: Phone, decision: "yes" | "no") {
  await arjun.page.waitForURL("**/request/**");
  await arjun.page.getByRole("button", { name: decision === "yes" ? /Yes, it's me/ : /NO, NOT ME/ }).click();
  // Signed and on its way (held by the gate): F1 shows it's sending.
  await expect(arjun.page.getByText(/Sending your answer|Couldn't send your answer/)).toBeVisible();
}

test("J-08a · a genuine NOT ME that arrives after the timer still shows 'Not Arjun', marked late", async ({
  browser,
}) => {
  test.slow(); // a full 60 s timer, then the late answer
  const gate = answerGate();
  const { maa, arjun } = await family(browser, gate);
  try {
    await ask(maa, /Arjun/);
    await answerNow(arjun, "no");
    expect(await verdict(maa, 90_000)).toBe("Not confirmed yet");
    gate.release();
    await expect(maa.page.locator("h1").first()).toHaveText("Not Arjun", { timeout: 40_000 });
    await expect(maa.page.getByText("Arjun answered after the timer ended.")).toBeVisible();
    await arjun.page.waitForURL("**/sent", { timeout: 40_000 });
  } finally {
    await closeAll(maa, arjun);
  }
});

test("J-08b · a genuine YES that arrives after the timer never turns green", async ({ browser }) => {
  test.slow(); // a full 60 s timer, then the late answer
  const gate = answerGate();
  const { maa, arjun } = await family(browser, gate);
  try {
    await ask(maa, /Arjun/);
    await answerNow(arjun, "yes");
    expect(await verdict(maa, 90_000)).toBe("Not confirmed yet");
    gate.release();
    await expect(maa.page.getByText("Arjun answered after the time ran out. Ask again.")).toBeVisible({
      timeout: 40_000,
    });
    await expect(maa.page.locator("h1").first()).toHaveText("Not confirmed yet");
    await expect(maa.page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  } finally {
    await closeAll(maa, arjun);
  }
});
