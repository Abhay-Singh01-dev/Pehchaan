// REL-13: draining (18.9). /readyz 503 at once → wait → spread `reconnect` frames → phones leave on their own →
// 1012 for the rest after DRAIN_TIMEOUT_MS. Envelopes sent during the drain are never lost: they wait in the
// inbox and reach each phone on the other relay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice, type TestClient } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("drain", { count: 2, env: { DRAIN_SETTLE_MS: "300", DRAIN_TIMEOUT_MS: "1500" } });
});
afterAll(() => env.cleanup());

describe("REL-13 · drain", () => {
  it("readiness off, reconnect spread, 1012 for stragglers, and zero envelopes lost under traffic", async () => {
    const [A, B] = env.relays as [(typeof env.relays)[0], (typeof env.relays)[0]];
    const maa = await TestDevice.create();
    const phones = await Promise.all(Array.from({ length: 5 }, () => TestDevice.create()));
    const straggler = await TestDevice.create();
    const m = await maa.login(B);
    const clients = new Map<string, TestClient>();
    for (const p of phones) clients.set(p.deviceId, await p.login(A));
    const s = await straggler.login(A); // this one ignores `reconnect`

    // Maa keeps sending alerts to everyone during the drain.
    const sent: string[] = [];
    let sending = true;
    const traffic = (async () => {
      while (sending) {
        for (const p of phones) {
          await env.iso.redis.del(`${env.iso.keyPrefix}rl:alert_device:${maa.deviceId}`);
          const al = await maa.plainSend("alert", p, { grant: p.cardGrant });
          m.send("send", al.body, al.id);
          sent.push(`${p.deviceId} ${al.id}`);
        }
        // 5 frames per 300 ms stays under the per-socket limit (20/s); refused frames wouldn't be "sent".
        await new Promise((r) => setTimeout(r, 300));
      }
    })();

    // Phones follow `reconnect { afterMs }` to the other relay (as Caddy would send them there).
    const received = new Set<string>();
    const follow = async (p: TestDevice, c: TestClient) => {
      const rc = await c.type("reconnect", () => true, 10_000);
      expect(rc.body.afterMs).toBeLessThan(Math.min(5000, 6));
      c.close();
      await new Promise((r) => setTimeout(r, rc.body.afterMs));
      const again = await p.login(B);
      clients.set(p.deviceId, again);
    };
    for (const c of clients.values()) {
      c.ws.on("message", () => {});
    }
    const draining = A.drain();
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(`http://127.0.0.1:${A.port}/readyz`)).status).toBe(503);
    await Promise.all(phones.map((p) => follow(p, clients.get(p.deviceId)!)));
    expect((await s.closed).code).toBe(1012);
    await draining;
    sending = false;
    await traffic;

    // Every alert reaches its phone (live, or from the inbox at login).
    await new Promise((r) => setTimeout(r, 1500));
    for (const p of phones) {
      const c = clients.get(p.deviceId)!;
      for (const f of c.all("deliver")) received.add(`${p.deviceId} ${f.id}`);
    }
    // Frames delivered to the old socket before it closed count too: they were acked-or-inboxed; any not
    // acked there are re-delivered from the inbox on the new relay, so the new sockets alone must hold all.
    // Only envelopes the relay accepted count as sent.
    const accepted = new Set(
      m
        .all("receipt")
        .filter((r) => r.body.state === "accepted")
        .map((r) => r.body.of),
    );
    const missing = sent.filter((x) => accepted.has(x.split(" ")[1]!) && !received.has(x));
    expect(accepted.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
    for (const c of clients.values()) c.close();
    m.close();
  }, 30_000);
});
