// Edges of the relay core not covered elsewhere: failed-login bursts, the per-socket frame limit, the 1.5 s
// ack fallback (the push itself is Phase 6: here there's no subscription, so it's `queued`), presence of a
// bound but offline device, revoking a device the relay never saw, and a bus delivery racing a disconnect.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSE, ulid } from "@pehchaan/protocol";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("edges", { count: 2, env: { ACK_PUSH_FALLBACK_MS: "200" } });
});
afterAll(() => env.cleanup());

const A = () => env.relays[0]!;
const B = () => env.relays[1]!;

describe("login failures", () => {
  it("after the burst of failed logins from one IP, the next failure closes 4429 and is audited", async () => {
    const key = `${env.iso.keyPrefix}rl:login_fail_ip:${A().hub.limiter.ipKey("127.0.0.1")}`;
    await env.iso.redis.set(key, String(Date.now() + 10 * 20_000), "PX", 600_000); // burst of 10 used up
    const d = await TestDevice.create();
    const c = await TestClient.open(A());
    const h = await c.type("hello");
    const body = await d.authBody(h.body.serverNonce);
    c.send("auth", { ...body, sig: body.sig.slice(0, -2) + (body.sig.endsWith("AA") ? "BA" : "AA") });
    expect((await c.closed).code).toBe(CLOSE.RATE_LIMIT);
    await sleep(100);
    const r = await env.iso.pool.query("select count(*)::int n from audit_events where kind='auth_failed_burst'");
    expect(r.rows[0].n).toBeGreaterThan(0);
    await env.iso.redis.del(key);
  });
});

describe("the per-socket frame limit (20/s, burst 40)", () => {
  it("answers excess frames with rate_limited and keeps the socket", async () => {
    const c = await TestClient.open(A());
    await c.type("hello");
    for (let i = 0; i < 60; i++) c.send("ping", {});
    const e = await c.type("error", (f) => f.body.code === "rate_limited");
    expect(e.body.retryAfterMs).toBeGreaterThan(0);
    await sleep(1200);
    c.send("ping", {});
    await c.type("pong", () => true);
    c.close();
  });
});

describe("REL-12 (shape) · a delivered frame that isn't acked falls back to push", () => {
  it("after 1.5 s (200 ms here) without an ack, the push is attempted; with no subscription it's queued", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(A());
    const m = await maa.login(B());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await a.type("deliver", (f) => f.id === req.id); // delivered, never acked
    expect((await m.receipt(req.id, "queued", 3000)).body.to).toBe(arjun.deviceId);
    a.close();
    m.close();
  });

  it("an ack in time cancels the fallback", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(A());
    const m = await maa.login(A());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await a.type("deliver", (f) => f.id === req.id);
    a.send("ack", { of: req.id });
    await m.receipt(req.id, "delivered");
    await sleep(400);
    expect(m.all("receipt").some((r) => r.body.of === req.id && r.body.state === "queued")).toBe(false);
    a.close();
    m.close();
  });

  it("a bus delivery that finds no socket (the phone just left) falls back to push", async () => {
    const arjun = await TestDevice.create();
    const now = Date.now();
    const stored = {
      frame: {
        v: 1 as const,
        t: "deliver" as const,
        id: ulid(),
        sts: now,
        body: { from: "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S", kind: "alert", ttlMs: 0 },
      },
      expiresAt: now + 60_000,
    };
    expect(A().hub.router.localDeliver(arjun.deviceId, stored, true)).toBe(false);
    expect(A().hub.router.localDeliver(arjun.deviceId, { ...stored, expiresAt: now - 1 }, true)).toBe(true); // stale: dropped
  });
});

describe("presence and contacts", () => {
  it("a bound device with no socket and no subscription is offline", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(A());
    const m = await maa.login(A());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    a.close();
    await sleep(200);
    m.send("presence.query", { ids: [arjun.deviceId] });
    expect((await m.type("presence")).body.states).toEqual({ [arjun.deviceId]: "offline" });
    m.close();
  });

  it("revoking a device the relay has never seen is a harmless no-op (D-029)", async () => {
    const arjun = await TestDevice.create();
    const ghost = await TestDevice.create();
    const a = await arjun.login(A());
    await a.receipt(a.send("contact.revoke", { deviceId: ghost.deviceId }), "accepted");
    const rows = await env.iso.pool.query("select 1 from contact_bindings where target_device_id=$1", [arjun.deviceId]);
    expect(rows.rowCount).toBe(0);
    a.close();
  });

  it("a device that never registered a grant can't be contacted by grant", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A(), { grant: false })).close();
    const m = await maa.login(A());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    expect((await m.error(req.id)).body.code).toBe("not_allowed");
    m.close();
  });
});
