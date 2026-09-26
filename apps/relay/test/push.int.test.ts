// Web Push end to end on the relay (spec 8.3, 11.2–11.9; Part E PSH-01…06, C-11.2b, C-11.3a, REL-12), with a
// local mock push service that verifies every VAPID JWT and decrypts every payload (helpers/mock-push.ts).
import { createHash } from "node:crypto";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchMessage, resubscribeMessage, signAuth } from "@pehchaan/crypto/device-auth";
import { b64url } from "@pehchaan/crypto/bytes";
import { LIMITS, ulid } from "@pehchaan/protocol";
import { topicFor } from "../src/push/sender";
import { TestDevice, sleep, type TestClient } from "./helpers/client";
import { newSubscription, startMockPush, type MockPush, type TestSubscription } from "./helpers/mock-push";
import { ORIGIN, RELAY_HOST, setupRelays, type Env } from "./helpers/relays";

const current = webpush.generateVAPIDKeys();
const previous = webpush.generateVAPIDKeys();
let mock: MockPush;
let env: Env;
/** The same relay settings with the standard rate limits, in its own key space: for the tests OF those limits. */
let limitsEnv: Env;
let port: number;
let limitsPort: number;

beforeAll(async () => {
  mock = await startMockPush();
  const vapid = {
    VAPID_KEY_ID: "v2",
    VAPID_PUBLIC_KEY: current.publicKey,
    VAPID_PRIVATE_KEY: current.privateKey,
    VAPID_PREVIOUS_KEY_ID: "v1",
    VAPID_PREVIOUS_PUBLIC_KEY: previous.publicKey,
    VAPID_PREVIOUS_PRIVATE_KEY: previous.privateKey,
    VAPID_SUBJECT: "mailto:security@pehchaan.test",
    PUSH_TEST_TARGET: mock.url,
    ACK_PUSH_FALLBACK_MS: "300",
    PUSH_TEST_DELAY_MS: "400",
  };
  // Dozens of logins from one address in a few seconds: the per-IP upgrade limit isn't what these tests are about.
  env = await setupRelays("push", { env: { ...vapid, RATE_LIMIT_PROFILE: "relaxed" } });
  limitsEnv = await setupRelays("push-limits", { env: vapid });
  port = env.relays[0]!.port;
  limitsPort = limitsEnv.relays[0]!.port;
});

afterAll(async () => {
  await Promise.all([env.cleanup(), limitsEnv.cleanup()]);
  await mock.close();
});

async function subscribe(c: TestClient, sub: TestSubscription, vapidKeyId = "v2") {
  mock.register(sub);
  const id = c.send("push.subscribe", { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, vapidKeyId });
  await c.receipt(id, "accepted");
}

/** A target that logged in once (so it's known, with its grant), subscribed to push, and went away. */
async function offlineTarget(vapidKeyId = "v2", on = port) {
  const target = await TestDevice.create();
  const t = await target.login(on);
  const sub = newSubscription();
  await subscribe(t, sub, vapidKeyId);
  t.close();
  await t.closed;
  await sleep(50);
  return { target, sub };
}

async function asker() {
  const a = await TestDevice.create();
  return { a, c: await a.login(port) };
}

async function sendRequest(from: { a: TestDevice; c: TestClient }, target: TestDevice, ttlMs = 60_000) {
  const s = await from.a.plainSend("verify.request", target, { grant: target.cardGrant, ttlMs });
  from.c.send("send", s.body, s.id);
  return s;
}

const payloadOf = (p: { payload: string | null }) =>
  JSON.parse(p.payload ?? "null") as Record<string, unknown> & {
    body: Record<string, unknown>;
  };

describe("PSH-01 · only real push services, over https (SSRF guard, 11.3)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QAbc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", async (endpoint) => {
    const d = await TestDevice.create();
    const c = await d.login(port);
    const sub = newSubscription();
    const id = c.send("push.subscribe", { endpoint, p256dh: sub.p256dh, auth: sub.auth, vapidKeyId: "v2" });
    await c.receipt(id, "accepted");
    c.close();
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/push",
    "https://169.254.169.254/latest/meta-data",
    "https://internal-service/push",
    "https://fcm.googleapis.com.evil.example/push",
    "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
  ])("refuses %s", async (endpoint) => {
    const d = await TestDevice.create();
    const c = await d.login(port);
    const sub = newSubscription();
    const id = c.send("push.subscribe", { endpoint, p256dh: sub.p256dh, auth: sub.auth, vapidKeyId: "v2" });
    expect((await c.error(id)).body.code).toBe("not_allowed");
    c.close();
  });
});

describe("PSH-02 · what a push carries (11.3, 11.4)", () => {
  it("a request: TTL within its time left, urgency high, the request's topic, a valid VAPID JWT, and the frame inside", async () => {
    const { target, sub } = await offlineTarget();
    const from = await asker();
    const s = await sendRequest(from, target, 45_000);
    expect((await from.c.receipt(s.id, "pushed")).body.to).toBe(target.deviceId);
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint);
    expect(p.ttl).toBeGreaterThan(40);
    expect(p.ttl).toBeLessThanOrEqual(45);
    expect(p.urgency).toBe("high");
    expect(p.contentEncoding).toBe("aes128gcm");
    expect(p.topic).toBe(topicFor(s.id));
    expect(p.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(p.jwt).toMatchObject({
      valid: true,
      aud: "https://fcm.googleapis.com",
      sub: "mailto:security@pehchaan.test",
    });
    expect(p.jwt.vapidPublicKey).toBe(current.publicKey);
    const frame = payloadOf(p);
    expect(frame).toMatchObject({ v: 1, t: "deliver", id: s.id });
    expect(frame.body).toMatchObject({ from: from.a.deviceId, kind: "verify.request", re: s.id });
    expect(frame.body.ttlMs).toBeGreaterThan(40_000);
    expect(p.bytes).toBeLessThan(4096);
    from.c.close();
  });

  it("an alert has no topic (it never replaces anything)", async () => {
    const { target, sub } = await offlineTarget();
    const from = await asker();
    const s = await from.a.plainSend("alert", target, { grant: target.cardGrant, ttlMs: 86_400_000 });
    from.c.send("send", s.body, s.id);
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint);
    expect(p.topic).toBeUndefined();
    expect(payloadOf(p).body.kind).toBe("alert");
    from.c.close();
  });

  it("C-11.3a · a cancel shares its request's topic, so it replaces an undelivered request push", async () => {
    const { target, sub } = await offlineTarget();
    const from = await asker();
    const s = await sendRequest(from, target);
    await from.c.receipt(s.id, "pushed");
    const cancelId = from.c.send("cancel", { re: s.id });
    await from.c.receipt(cancelId, "accepted");
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint && payloadOf(x).body.kind === "verify.cancel");
    expect(p.topic).toBe(topicFor(s.id));
    from.c.close();
  });
});

describe("PSH-03 · every push service answer is handled per the 11.3 table", () => {
  async function outcome(target: TestDevice) {
    const from = await asker();
    const s = await sendRequest(from, target);
    const r = await from.c.type("receipt", (f) => f.body.of === s.id && f.body.state !== "accepted", 15_000);
    from.c.close();
    return r.body.state;
  }

  async function pushStatusAtLogin(target: TestDevice) {
    const c = await target.login(port);
    const ok = c.all("auth.ok")[0]!;
    c.close();
    await c.closed;
    await sleep(50);
    return ok.body.pushStatus;
  }

  it("201 → pushed", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 201 });
    expect(await outcome(target)).toBe("pushed");
  });

  it.each([404, 410, 403])(
    "%i → the subscription is expired, the receipt is failed, and the next login says so",
    async (status) => {
      const { target, sub } = await offlineTarget();
      mock.respond(sub.endpoint, { status });
      expect(await outcome(target)).toBe("failed");
      expect(await pushStatusAtLogin(target)).toBe("expired");
    },
  );

  it("413 → retried once as a small wake push", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 413 });
    expect(await outcome(target)).toBe("pushed");
    const both = mock.pushes.filter((p) => p.endpoint === sub.endpoint);
    expect(both).toHaveLength(2);
    expect(payloadOf(both[1]!)).toMatchObject({ t: "wake", kind: "verify.request" });
  });

  it("429 → waits Retry-After, retries once", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 429, retryAfter: 1 });
    const started = Date.now();
    expect(await outcome(target)).toBe("pushed");
    const times = mock.pushes.filter((p) => p.endpoint === sub.endpoint).map((p) => p.at);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(950);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("429 twice → failed", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 429, retryAfter: 0 }, { status: 429, retryAfter: 0 });
    expect(await outcome(target)).toBe("failed");
  });

  it("400 → failed, and the subscription is kept (it's our bug, not theirs)", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 400 });
    expect(await outcome(target)).toBe("failed");
    expect(await pushStatusAtLogin(target)).toBe("ok");
  });

  it("5xx → retried after 0.5 s and 1.5 s, then failed; a later success counts", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 503 }, { status: 502 }, { status: 500 });
    expect(await outcome(target)).toBe("failed");
    const times = mock.pushes.filter((p) => p.endpoint === sub.endpoint).map((p) => p.at);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(450);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(1400);

    const again = await offlineTarget();
    mock.respond(again.sub.endpoint, { status: 503 });
    expect(await outcome(again.target)).toBe("pushed");
  });

  it("a push service that doesn't answer in 5 s is retried like a 5xx", async () => {
    const { target, sub } = await offlineTarget();
    mock.respond(sub.endpoint, { status: 201, delayMs: 6000 });
    expect(await outcome(target)).toBe("pushed");
    expect(mock.pushes.filter((p) => p.endpoint === sub.endpoint).length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("no subscription → queued (the envelope waits in the inbox)", async () => {
    const target = await TestDevice.create();
    const t = await target.login(port);
    t.close();
    await t.closed;
    await sleep(50);
    const from = await asker();
    const s = await sendRequest(from, target);
    await from.c.receipt(s.id, "queued");
    from.c.close();
  });
});

describe("PSH-04 · big frames travel as a wake; the service worker fetches them (11.4)", () => {
  async function bigSend(from: { a: TestDevice; c: TestClient }, target: TestDevice) {
    const id = ulid();
    const ct = b64url(crypto.getRandomValues(new Uint8Array(4000)));
    const e2e = {
      alg: "p256-hkdf-a256gcm",
      epk: target.ek,
      iv: b64url(crypto.getRandomValues(new Uint8Array(12))),
      ct,
      sig: b64url(new Uint8Array(64).fill(7)),
    };
    from.c.send(
      "send",
      { kind: "verify.request", to: target.deviceId, re: id, grant: target.cardGrant, ttlMs: 60_000, e2e },
      id,
    );
    return id;
  }

  async function signedFetch(
    d: TestDevice,
    msgId: string,
    o: { ts?: number; origin?: string; sig?: string; on?: number } = {},
  ) {
    const ts = o.ts ?? Date.now();
    const sig = o.sig ?? (await signAuth(d.sign.privateKey, fetchMessage(RELAY_HOST, d.deviceId, msgId, ts)));
    return fetch(`http://127.0.0.1:${o.on ?? port}/v1/inbox/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: o.origin ?? ORIGIN },
      body: JSON.stringify({ deviceId: d.deviceId, msgId, ts, sig }),
    });
  }

  it("a frame over 3,000 bytes is pushed as {t:'wake'}, and the signed fetch returns the frame", async () => {
    const { target, sub } = await offlineTarget();
    const from = await asker();
    const id = await bigSend(from, target);
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint);
    const wake = payloadOf(p);
    expect(wake).toEqual({ t: "wake", id, kind: "verify.request", from: from.a.deviceId });
    const res = await signedFetch(target, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const got = (await res.json()) as { frame: { id: string; body: { ttlMs: number; e2e: unknown } } };
    expect(got.frame.id).toBe(id);
    expect(got.frame.body.ttlMs).toBeGreaterThan(50_000);
    expect(JSON.stringify(got.frame).length).toBeGreaterThan(LIMITS.PUSH_MAX_FRAME_BYTES);
    from.c.close();
  });

  it("refuses a stale, wrongly signed, unknown or someone else's fetch", async () => {
    const { target } = await offlineTarget();
    const other = await TestDevice.create();
    const from = await asker();
    const id = await bigSend(from, target);
    await from.c.receipt(id, "pushed");
    expect((await signedFetch(target, id, { ts: Date.now() - 121_000 })).status).toBe(401);
    expect((await signedFetch(target, id, { ts: Date.now() + 121_000 })).status).toBe(401);
    const otherSig = await signAuth(other.sign.privateKey, fetchMessage(RELAY_HOST, target.deviceId, id, Date.now()));
    expect((await signedFetch(target, id, { sig: otherSig })).status).toBe(401);
    expect((await signedFetch(other, id)).status).toBe(403); // never logged in: unknown to the relay
    expect((await signedFetch(target, ulid())).status).toBe(404);
    const bad = await fetch(`http://127.0.0.1:${port}/v1/inbox/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: target.deviceId, msgId: id }),
    });
    expect(bad.status).toBe(400);
    from.c.close();
  });

  it("CORS lets only the app's own origin read the answer", async () => {
    const pre = (origin: string) =>
      fetch(`http://127.0.0.1:${port}/v1/inbox/fetch`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      });
    expect((await pre(ORIGIN)).headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await pre("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is rate-limited per device (30 / min, burst 10)", async () => {
    const { target } = await offlineTarget("v2", limitsPort);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await signedFetch(target, ulid(), { on: limitsPort })).status);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 404).length).toBeGreaterThanOrEqual(10);
  });
});

describe("PSH-05 · push.test (11.8)", () => {
  it("arrives after the delay; then 3 per hour with a burst of 1 (16.1): the next is refused for ~20 min", async () => {
    const d = await TestDevice.create();
    const c = await d.login(limitsPort);
    const sub = newSubscription();
    await subscribe(c, sub);
    const asked = Date.now();
    const id = c.send("push.test", {});
    await c.receipt(id, "accepted");
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint);
    expect(p.at - asked).toBeGreaterThanOrEqual(380);
    expect(payloadOf(p)).toMatchObject({ t: "test" });
    await c.receipt(id, "pushed");
    const second = c.send("push.test", {});
    const refused = await c.error(second);
    expect(refused.body.code).toBe("rate_limited");
    // One every 20 minutes: three in an hour, and a 4th inside the hour is always refused.
    expect(refused.body.retryAfterMs).toBeGreaterThan(19 * 60_000);
    expect(refused.body.retryAfterMs).toBeLessThanOrEqual(20 * 60_000);
    c.close();
  });
});

describe("PSH-06 · each subscription is signed with its own VAPID key (11.9)", () => {
  it("an older subscription uses the previous key; an unknown key expires it", async () => {
    const old = await offlineTarget("v1");
    const from = await asker();
    const s = await sendRequest(from, old.target);
    await from.c.receipt(s.id, "pushed");
    const p = await mock.waitFor((x) => x.endpoint === old.sub.endpoint);
    expect(p.jwt.valid).toBe(true);
    expect(p.jwt.vapidPublicKey).toBe(previous.publicKey);

    const stale = await offlineTarget("v0");
    const s2 = await sendRequest(from, stale.target);
    await from.c.receipt(s2.id, "failed");
    expect(mock.pushes.some((x) => x.endpoint === stale.sub.endpoint)).toBe(false);
    from.c.close();
  });

  it("hello tells the app the current key ID, so it can re-subscribe after a rotation", async () => {
    const d = await TestDevice.create();
    const c = await d.login(port);
    expect(c.hello!.t === "hello" && c.hello!.body.vapidKeyId).toBe("v2");
    c.close();
  });
});

describe("C-11.2b · POST /v1/push/resubscribe (signed)", () => {
  async function resubscribe(
    d: TestDevice,
    sub: TestSubscription,
    o: { oldEndpoint?: string; signer?: TestDevice } = {},
  ) {
    const ts = Date.now();
    const sig = await signAuth(
      (o.signer ?? d).sign.privateKey,
      resubscribeMessage(RELAY_HOST, d.deviceId, sub.endpoint, ts),
    );
    return fetch(`http://127.0.0.1:${port}/v1/push/resubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        deviceId: d.deviceId,
        subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, vapidKeyId: "v2" },
        ...(o.oldEndpoint ? { oldEndpoint: o.oldEndpoint } : {}),
        ts,
        sig,
      }),
    });
  }

  it("replaces the old subscription; pushes go to the new one", async () => {
    const { target, sub: oldSub } = await offlineTarget();
    const fresh = newSubscription();
    mock.register(fresh);
    expect((await resubscribe(target, fresh, { oldEndpoint: oldSub.endpoint })).status).toBe(204);
    const from = await asker();
    const s = await sendRequest(from, target);
    await from.c.receipt(s.id, "pushed");
    const p = await mock.waitFor((x) => x.endpoint === fresh.endpoint);
    expect(payloadOf(p).id).toBe(s.id);
    expect(mock.pushes.some((x) => x.endpoint === oldSub.endpoint && x.at >= p.at - 1000)).toBe(false);
    from.c.close();
  });

  it("refuses another device's signature and non-push-service endpoints", async () => {
    const { target } = await offlineTarget();
    const other = await TestDevice.create();
    expect((await resubscribe(target, newSubscription(), { signer: other })).status).toBe(401);
    const evil = { ...newSubscription(), endpoint: "https://169.254.169.254/latest" };
    expect((await resubscribe(target, evil)).status).toBe(400);
  });
});

describe("REL-12 · a delivered frame not acked in time is pushed too (8.3)", () => {
  it("the socket took the frame but never acked (a frozen phone): push after the ack timeout", async () => {
    const target = await TestDevice.create();
    const t = await target.login(port);
    const sub = newSubscription();
    await subscribe(t, sub);
    const from = await asker();
    const s = await sendRequest(from, target);
    await t.type("deliver", (f) => f.id === s.id); // delivered on the socket, deliberately not acked
    const p = await mock.waitFor((x) => x.endpoint === sub.endpoint, 3000);
    expect(payloadOf(p).id).toBe(s.id);
    t.close();
    from.c.close();
  });

  it("an acked frame is never pushed, and live notices (receipts) never are", async () => {
    const target = await TestDevice.create();
    const t = await target.login(port);
    const sub = newSubscription();
    await subscribe(t, sub);
    const from = await asker();
    const s = await sendRequest(from, target);
    const f = await t.type("deliver", (x) => x.id === s.id);
    t.send("ack", { of: f.id });
    await from.c.receipt(s.id, "delivered");
    await sleep(700);
    expect(mock.pushes.some((x) => x.endpoint === sub.endpoint)).toBe(false);
    t.close();
    from.c.close();
  });
});

// The topic function itself (11.3): the first 32 characters of base64url(SHA-256(requestId)).
describe("topicFor", () => {
  it("matches its definition", () => {
    const id = ulid();
    expect(topicFor(id)).toBe(createHash("sha256").update(id).digest("base64url").slice(0, 32));
  });
});
