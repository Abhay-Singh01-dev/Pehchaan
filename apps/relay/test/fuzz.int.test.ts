// SEC-01 (spec 21.7), live half: a real relay is sent thousands of random and malformed frames, before and after
// login. It must answer each (an error, a close, or normal handling), never crash, never log an unexpected internal
// error, and still serve a normal check afterwards.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_TYPES, ulid } from "@pehchaan/protocol";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  // Relaxed limits: this test opens many sockets from one IP on purpose.
  env = await setupRelays("fuzz", { env: { RATE_LIMIT_PROFILE: "relaxed" } });
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;
const json = fc.jsonValue({ maxDepth: 4 });

/** Sends frames with a small pause (so the per-socket frame limit isn't the only thing exercised). */
async function barrage(c: TestClient, frames: string[]) {
  for (const f of frames) {
    if (c.ws.readyState !== c.ws.OPEN) return;
    c.ws.send(f);
    await sleep(2);
  }
}

describe("SEC-01 · a live relay under random frames", () => {
  it("before login: garbage is refused and the socket closed, the relay keeps running", async () => {
    const texts = fc.sample(
      fc.oneof(
        fc.string({ unit: "binary", maxLength: 300 }),
        json.map((v) => JSON.stringify(v) ?? ""),
      ),
      600,
    );
    for (let i = 0; i < texts.length; i += 30) {
      const c = await TestClient.open(relay());
      await c.type("hello");
      await barrage(c, texts.slice(i, i + 30));
      c.close();
    }
    const health = await fetch(`http://127.0.0.1:${relay().port}/healthz`);
    expect(health.status).toBe(200);
  });

  it("after login: every message type with random bodies, and valid envelopes with random fields", async () => {
    const d = await TestDevice.create();
    const frames = fc.sample(
      fc
        .tuple(fc.constantFrom(...CLIENT_TYPES), json, fc.boolean())
        .map(([t, body, withId]) =>
          JSON.stringify({ v: 1, t, ...(withId ? { id: ulid() } : {}), ts: Date.now(), body }),
        ),
      1500,
    );
    for (let i = 0; i < frames.length; i += 50) {
      // Three bad frames a minute close a socket (7.2): log in again and carry on.
      const c = await d.login(relay(), { grant: false });
      await barrage(c, frames.slice(i, i + 50));
      c.close();
    }
    // Still healthy, and a normal check still works end to end.
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const m = await maa.login(relay());
    const a = await arjun.login(relay());
    const r = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", r.body, r.id);
    await a.type("deliver", (f) => f.body.re === r.id);
    // No handler threw something other than a refusal ("failing closed" is logged for unexpected errors).
    const unexpected = env.logs.filter(
      (l) => l.includes("failing closed") && !/"err":"(Refusal|ReplyError|MaxRetriesPerRequestError)"/.test(l),
    );
    expect(unexpected).toEqual([]);
    expect(env.logs.filter((l) => /"level":(50|60)/.test(l))).toEqual([]);
  }, 180_000);
});
