// REL-24 /healthz vs /readyz; REL-19 fail closed (Valkey down → unavailable; Postgres down with a cold
// cache → unavailable; warm caches keep existing families working).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("health");
});
afterAll(() => env.cleanup());

const get = (port: number, path: string) => fetch(`http://127.0.0.1:${port}${path}`);

describe("REL-24 · health and readiness", () => {
  it("healthz is 200 whenever the process runs; readyz is 200 when ready", async () => {
    const r = env.relays[0]!;
    expect((await get(r.port, "/healthz")).status).toBe(200);
    expect(await (await get(r.port, "/readyz")).json()).toEqual({ ready: true });
  });

  it("readyz is 503 while draining", async () => {
    const r = await env.start({ DRAIN_SETTLE_MS: "600" });
    const drained = r.drain();
    await sleep(100);
    const res = await get(r.port, "/readyz");
    expect(res.status).toBe(503);
    expect((await res.json()).reasons).toContain("draining");
    expect((await get(r.port, "/healthz")).status).toBe(200);
    await drained;
  });

  it("readyz is 503 when Valkey is down", async () => {
    const r = await env.start();
    r.hub.redis.disconnect(false);
    await sleep(100);
    const res = await get(r.port, "/readyz");
    expect(res.status).toBe(503);
    expect((await res.json()).reasons).toContain("valkey");
  });

  it("serves the relay's time and public config", async () => {
    const r = env.relays[0]!;
    const t = await (await get(r.port, "/v1/time")).json();
    expect(Math.abs(t.serverTime - Date.now())).toBeLessThan(5000);
    const c = await (await get(r.port, "/v1/config")).json();
    expect(c).toMatchObject({ env: "test", minClient: "1.0.0", e2eRequired: false, vapidKeyId: "v1", lab: false });
  });
});

describe("REL-19 · fail closed", () => {
  it("Postgres down: a cold cache → unavailable; warm caches keep an existing family working", async () => {
    const r = await env.start();
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const newcomer = await TestDevice.create();
    const a = await arjun.login(r);
    const m = await maa.login(r);
    (await newcomer.login(r)).close();
    // Warm up: first contact creates the binding (and deletes the binding cache, 15.5); the next message
    // loads the caches again. That is an existing family with warm caches.
    const pairKey = `${env.iso.keyPrefix}rl:request_pair:${maa.deviceId}>${arjun.deviceId}`;
    const first = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", first.body, first.id);
    await m.receipt(first.id, "accepted");
    const second = await maa.plainSend("verify.request", arjun);
    m.send("send", second.body, second.id);
    await m.receipt(second.id, "accepted");
    await sleep(50);
    await env.iso.redis.del(pairKey);
    // Postgres goes away for this relay.
    await r.hub.store.pool.end();
    const again = await maa.plainSend("verify.request", arjun);
    m.send("send", again.body, again.id);
    await m.receipt(again.id, "accepted");
    await a.type("deliver", (f) => f.id === again.id);
    // A brand-new contact needs Postgres (cold cache): refused as unavailable, never allowed.
    await env.iso.redis.del(`${env.iso.keyPrefix}dv:${newcomer.deviceId}`);
    const cold = await maa.plainSend("verify.request", newcomer, { grant: newcomer.cardGrant });
    m.send("send", cold.body, cold.id);
    expect((await m.error(cold.id)).body.code).toBe("unavailable");
    a.close();
    m.close();
  });
});
