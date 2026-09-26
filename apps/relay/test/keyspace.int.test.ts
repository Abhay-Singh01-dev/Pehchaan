// C-15.1a key lifetimes, C-15.1b hash tags for multi-key scripts, C-15.1c the pub/sub bus and its isolation.
import calculateSlot from "cluster-key-slot";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeys } from "../src/core/keys";
import { CACHE_TTL_MS } from "../src/core/devices";
import { GATEWAY_ALIVE_TTL_MS, ROUTE_TTL_MS } from "../src/core/router";
import { TestDevice, sleep } from "./helpers/client";
import { setupRelays, REDIS_URL, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("keyspace", { count: 2 });
});
afterAll(() => env.cleanup());
const P = () => env.iso.keyPrefix;

describe("C-15.1a · key lifetimes", () => {
  it("gateway liveness 30 s, routes 24 h, open requests ≤ 2 min, caches 10 min", async () => {
    const r = env.relays[0]!;
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(r);
    const m = await maa.login(r);
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    const within = async (key: string, max: number, min = max - 5000) => {
      const t = await env.iso.redis.pttl(key);
      expect(t, key).toBeGreaterThan(min);
      expect(t, key).toBeLessThanOrEqual(max);
    };
    // Refreshed every 10 s with a 30 s lifetime: anywhere between 20 and 30 s is right.
    await within(`${P()}gw:${r.gatewayId}:alive`, GATEWAY_ALIVE_TTL_MS, GATEWAY_ALIVE_TTL_MS - 10_000 - 2000);
    await within(`${P()}rt:${arjun.deviceId}`, ROUTE_TTL_MS);
    await within(`${P()}oq:${maa.deviceId}`, 120_000);
    await within(`${P()}dv:${arjun.deviceId}`, CACHE_TTL_MS);
    await within(`${P()}cg:${arjun.deviceId}`, CACHE_TTL_MS);
    m.send("presence.query", { ids: [arjun.deviceId] });
    await m.type("presence");
    await within(`${P()}cb:${arjun.deviceId}`, CACHE_TTL_MS);
    await within(`${P()}ps:${arjun.deviceId}`, CACHE_TTL_MS, CACHE_TTL_MS - 5000).catch(async () => {
      // presence only reads the push cache for devices that are not online; Arjun is online.
      expect(await env.iso.redis.exists(`${P()}ps:${arjun.deviceId}`)).toBe(0);
    });
    a.close();
    m.close();
  });
});

describe("C-15.1b · hash tags", () => {
  it("the two keys of an inbox share one cluster slot, whatever the prefix", () => {
    for (const prefix of ["", "t:x_1:", P()]) {
      const k = createKeys(prefix);
      const id = "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F";
      expect(calculateSlot(k.inboxIndex(id))).toBe(calculateSlot(k.inboxFrame(id, "01JB7Y8Q3Z6N4V5W2K9C0D1E2F")));
    }
  });
});

describe("C-15.1c · the bus", () => {
  it("delivers to the gateway's own channel and never across key prefixes", async () => {
    const r = env.relays[1]!;
    const d = await TestDevice.create();
    const c = await d.login(r);
    const frame = { v: 1, t: "pong", id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F", sts: 1, body: { serverTime: 42 } };
    const pub = new Redis(REDIS_URL);
    // Another test file's prefix: nothing arrives.
    await pub.publish(`t:other:gw:${r.gatewayId}`, JSON.stringify({ type: "notify", to: d.deviceId, frame }));
    await sleep(200);
    expect(c.all("pong")).toHaveLength(0);
    await pub.publish(`${P()}gw:${r.gatewayId}`, JSON.stringify({ type: "notify", to: d.deviceId, frame }));
    expect((await c.type("pong")).body.serverTime).toBe(42);
    // A malformed bus message is dropped without harm.
    await pub.publish(`${P()}gw:${r.gatewayId}`, "{oops");
    pub.disconnect();
    c.close();
  });
});
