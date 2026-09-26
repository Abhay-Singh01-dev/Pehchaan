// REL-05 routing across two gateways; REL-06 the inbox; REL-08 dedupe; C-8.3a inbox lifetimes per kind;
// C-8.4a the dedupe window.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIMING, ulid } from "@pehchaan/protocol";
import { TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("delivery", { count: 2 });
});
afterAll(() => env.cleanup());

const [A, B] = [() => env.relays[0]!, () => env.relays[1]!];
const P = () => env.iso.keyPrefix;

describe("REL-05 · routing", () => {
  it("delivers on the same gateway and across gateways by pub/sub", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const priya = await TestDevice.create();
    const m = await maa.login(A());
    const a = await arjun.login(B()); // another gateway
    const p = await priya.login(A()); // same gateway
    for (const [target, client] of [
      [arjun, a],
      [priya, p],
    ] as const) {
      const req = await maa.plainSend("verify.request", target, { grant: target.cardGrant });
      m.send("send", req.body, req.id);
      await client.type("deliver", (f) => f.id === req.id);
      client.send("ack", { of: req.id });
      await m.receipt(req.id, "delivered");
    }
    [m, a, p].forEach((c) => c.close());
  });

  it("lazily removes a dead gateway from a device's routes", async () => {
    const arjun = await TestDevice.create();
    const a = await arjun.login(A());
    await env.iso.redis.sadd(`${P()}rt:${arjun.deviceId}`, "relay-dead00");
    const alive = await A().hub.router.aliveGateways(arjun.deviceId);
    expect(alive).toEqual([A().gatewayId]);
    expect(await env.iso.redis.smembers(`${P()}rt:${arjun.deviceId}`)).toEqual([A().gatewayId]);
    a.close();
  });

  it("rebuilds routes after Valkey loses everything (restart)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const m = await maa.login(A());
    const a = await arjun.login(B());
    // Everything this test file owns in Valkey disappears, as after a restart without persistence…
    const keys = await env.iso.keys();
    await env.iso.redis.del(...keys);
    // …and both gateways see their connection drop and come back.
    A().hub.redis.disconnect(true);
    B().hub.redis.disconnect(true);
    await sleep(800);
    expect(await env.iso.redis.smembers(`${P()}rt:${arjun.deviceId}`)).toEqual([B().gatewayId]);
    expect(await env.iso.redis.exists(`${P()}gw:${B().gatewayId}:alive`)).toBe(1);
    // Grants and bindings come back from Postgres; delivery works again.
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await a.type("deliver", (f) => f.id === req.id);
    m.close();
    a.close();
  });
});

describe("REL-06 · the inbox", () => {
  it("queues for an offline device, drains soonest-expiry first at login, rewrites ttlMs, and ack removes", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    await sleep(100);
    const m = await maa.login(A());
    const alert = await maa.plainSend("alert", arjun, { grant: arjun.cardGrant }); // waits 24 h
    m.send("send", alert.body, alert.id);
    await m.receipt(alert.id, "queued");
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant }); // waits 60 s
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "queued");
    await sleep(1100);

    const a = await arjun.login(B());
    const first = await a.type("deliver");
    const all = await a.type("deliver", (f) => f.id === alert.id).then(() => a.all("deliver"));
    expect(first.id).toBe(req.id); // the request expires first, so it comes first
    expect(all.map((f) => f.id)).toEqual([req.id, alert.id]);
    expect(all[0]!.body.ttlMs).toBeLessThan(59_000); // rewritten: time actually left
    for (const f of all) a.send("ack", { of: f.id });
    await m.receipt(req.id, "delivered");
    await m.receipt(alert.id, "delivered");
    expect(await A().hub.inbox.size(arjun.deviceId)).toBe(0);
    m.close();
    a.close();
  });

  it("drops expired frames and caps the inbox at 50", async () => {
    const d = (await TestDevice.create()).deviceId;
    const now = Date.now();
    const frame = (id: string, expiresAt: number) => ({
      frame: { v: 1 as const, t: "deliver" as const, id, sts: now, body: { from: d, kind: "alert", ttlMs: 0 } },
      expiresAt,
    });
    expect(await A().hub.inbox.put(d, frame(ulid(), now + 150), now)).toBe(true);
    await sleep(200);
    expect(await A().hub.inbox.pending(d, Date.now())).toEqual([]);
    const later = Date.now();
    for (let i = 0; i < 50; i++) expect(await A().hub.inbox.put(d, frame(ulid(), later + 60_000), later)).toBe(true);
    expect(await A().hub.inbox.put(d, frame(ulid(), later + 60_000), later)).toBe(false);
    expect(await A().hub.inbox.size(d)).toBe(50);
  });

  it("a full inbox turns the sender's receipt into failed", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      await A().hub.inbox.put(
        arjun.deviceId,
        {
          frame: { v: 1, t: "deliver", id: ulid(), sts: now, body: { from: "x", kind: "alert", ttlMs: 0 } },
          expiresAt: now + 60_000,
        },
        now,
      );
    }
    const m = await maa.login(A());
    const alert = await maa.plainSend("alert", arjun, { grant: arjun.cardGrant });
    m.send("send", alert.body, alert.id);
    expect((await m.receipt(alert.id, "failed")).body.reason).toBe("inbox_full");
    m.close();
  });
});

describe("C-8.3a · how long each kind waits", () => {
  it("request: its deadline; answer: deadline + 30 s; alert: 24 h; prompt: 2 min; cancel: 60 s", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    const m = await maa.login(A());
    const pttl = (id: string, to = arjun.deviceId) => env.iso.redis.pttl(`${P()}{d:${to}}:m:${id}`);

    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant, ttlMs: 30_000 });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "queued");
    expect(await pttl(req.id)).toBeGreaterThan(28_000);
    expect(await pttl(req.id)).toBeLessThanOrEqual(30_000);

    const alert = await maa.plainSend("alert", arjun, { grant: arjun.cardGrant });
    m.send("send", alert.body, alert.id);
    await m.receipt(alert.id, "queued");
    expect(await pttl(alert.id)).toBeGreaterThan(TIMING.INBOX_TTL_ALERT_MS - 5000);

    const prompt = await maa.plainSend("guard.prompt", arjun, { grant: arjun.cardGrant });
    m.send("send", prompt.body, prompt.id);
    await m.receipt(prompt.id, "queued");
    expect(await pttl(prompt.id)).toBeGreaterThan(TIMING.INBOX_TTL_PROMPT_MS - 5000);
    expect(await pttl(prompt.id)).toBeLessThanOrEqual(TIMING.INBOX_TTL_PROMPT_MS);

    const a = await arjun.login(A());
    const ans = await arjun.plainSend("verify.answer", maa, { re: req.re });
    a.send("send", ans.body, ans.id);
    await a.receipt(ans.id, "accepted");
    await m.type("deliver", (f) => f.id === ans.id);
    const ansTtl = await pttl(ans.id, maa.deviceId);
    expect(ansTtl).toBeGreaterThan(55_000); // ≈ 30 s left before the deadline + 30 s grace
    expect(ansTtl).toBeLessThanOrEqual(60_000);

    const req2 = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req2.body, req2.id);
    await a.type("deliver", (f) => f.id === req2.id);
    m.send("cancel", { re: req2.re! });
    const cancel = await a.type("deliver", (f) => f.body.kind === "verify.cancel");
    const cTtl = await pttl(cancel.id);
    expect(cTtl).toBeGreaterThan(TIMING.INBOX_TTL_CANCEL_MS - 5000);
    expect(cTtl).toBeLessThanOrEqual(TIMING.INBOX_TTL_CANCEL_MS);
    m.close();
    a.close();
  });
});

describe("REL-08 · the same message id re-sent is routed once and gets the same receipt", () => {
  it("re-sends are deduplicated for 5 minutes", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(B());
    const m = await maa.login(A());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    m.send("send", req.body, req.id);
    m.send("send", req.body, req.id);
    await sleep(500);
    expect(a.all("deliver").filter((f) => f.id === req.id)).toHaveLength(1);
    expect(m.all("receipt").filter((r) => r.body.of === req.id && r.body.state === "accepted")).toHaveLength(3);
    const ttl = await env.iso.redis.pttl(`${P()}dd:${maa.deviceId}:${req.id}`);
    expect(ttl).toBeGreaterThan(TIMING.DEDUPE_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(TIMING.DEDUPE_MS);
    m.close();
    a.close();
  });

  it("a refused message gets the same refusal again", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    const m = await maa.login(A());
    const req = await maa.plainSend("verify.request", arjun); // no grant
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "rejected");
    m.send("send", req.body, req.id);
    await sleep(300);
    expect(m.all("receipt").filter((r) => r.body.of === req.id && r.body.state === "rejected")).toHaveLength(2);
    m.close();
  });
});
