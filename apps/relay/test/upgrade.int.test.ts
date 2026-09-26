// REL-01 upgrade and frame rules (7.1, 16.2), REL-21 X-Forwarded-For, C-7.1a pending sockets per IP,
// SEC-06 oversized and binary frames, SEC-07 sockets that never log in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSE } from "@pehchaan/protocol";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { ORIGIN, setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("upgrade", { env: { AUTH_DEADLINE_MS: "1500" } });
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;
const resetUpgradeLimit = async (ip = "127.0.0.1") => {
  await env.iso.redis.del(`${env.iso.keyPrefix}rl:upgrade_ip:${relay().hub.limiter.ipKey(ip)}`);
};

describe("REL-01 · accepting a WebSocket", () => {
  it("refuses a bad Origin with 403", async () => {
    await expect(TestClient.open(relay(), { origin: "https://evil.example" })).rejects.toThrow("HTTP 403");
  });

  it("refuses a missing or wrong subprotocol with 426", async () => {
    await expect(TestClient.open(relay(), { protocol: "chat" })).rejects.toThrow("HTTP 426");
  });

  it("refuses other paths with 404", async () => {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${relay().port}/other`, "pehchaan.v1", { origin: ORIGIN });
    const status = await new Promise<number>((r) => ws.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)));
    expect(status).toBe(404);
  });

  it("never negotiates compression", async () => {
    const c = await TestClient.open(relay(), { perMessageDeflate: true });
    expect(c.ws.extensions).toBe("");
    c.close();
  });

  it("closes a binary frame with 1003", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect((await c.closed).code).toBe(CLOSE.BINARY_FRAME);
  });

  it("answers a 16–64 KiB frame with too_large and keeps the socket", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    c.ws.send("x".repeat(20 * 1024));
    expect((await c.type("error")).body.code).toBe("too_large");
    c.send("ping", {});
    await c.type("pong");
    c.close();
  });

  it("closes a frame over 64 KiB with 1009", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    c.ws.send("x".repeat(70 * 1024));
    expect((await c.closed).code).toBe(CLOSE.TOO_BIG);
  });

  it("closes after three bad frames in a minute with 4400", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    c.ws.send("{");
    c.ws.send(JSON.stringify({ v: 1, t: "nope" }));
    c.ws.send(JSON.stringify({ v: 1, t: "ack", id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F", ts: 1, body: { of: "x" } }));
    expect((await c.closed).code).toBe(CLOSE.BAD_FRAMES);
    expect(c.all("error").map((e) => e.body.code)).toEqual(["bad_request", "bad_request", "bad_request"]);
    expect(c.all("error")[2]!.body.of).toBe("01JB7Y8Q3Z6N4V5W2K9C0D1E2F");
  });

  it("closes a reader with over 1 MiB waiting with 1008", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay(), { grant: false });
    const server = relay().hub.sessions.get(d.deviceId)[0]!;
    (c.ws as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
    const chunk = JSON.stringify({ pad: "x".repeat(60_000) });
    for (let i = 0; i < 2000 && server.isOpen; i++) {
      server.sendText(chunk);
      if (i % 50 === 0) await sleep(5);
    }
    expect(server.isOpen).toBe(false);
    expect(relay().hub.sessions.get(d.deviceId)).toHaveLength(0);
    (c.ws as unknown as { _socket: { resume(): void } })._socket.resume();
    expect((await c.closed).code).toBe(CLOSE.POLICY);
  }, 60_000);

  it("rate-limits connections per IP with 4429 once the burst of 30 is used up", async () => {
    // The burst arithmetic is REL-16 (synthetic clock); here: an IP whose burst is spent is refused on the wire.
    // Spent = the GCRA schedule 30 intervals (of 500 ms: 120/min) ahead of now.
    const key = `${env.iso.keyPrefix}rl:upgrade_ip:${relay().hub.limiter.ipKey("127.0.0.1")}`;
    await env.iso.redis.set(key, String(Date.now() + 30 * 500), "PX", 60_000);
    const extra = await TestClient.open(relay());
    expect((await extra.closed).code).toBe(CLOSE.RATE_LIMIT);
    expect(extra.all("hello")).toHaveLength(0);
    await resetUpgradeLimit();
  });

  it("C-7.1a / SEC-07 · caps unauthenticated sockets per IP at 20, and closes them at the login deadline", async () => {
    await resetUpgradeLimit();
    const opened: TestClient[] = [];
    for (let i = 0; i < 20; i++) {
      const c = await TestClient.open(relay());
      // This test process may still be draining the slow-reader test's ~120 MB before the first hello is read.
      await c.type("hello", () => true, 15_000);
      opened.push(c);
    }
    const extra = await TestClient.open(relay());
    expect((await extra.closed).code).toBe(CLOSE.RATE_LIMIT);
    const codes = await Promise.all(opened.map((c) => c.closed));
    expect(codes.every((c) => c.code === CLOSE.LOGIN_TIMEOUT)).toBe(true);
    await resetUpgradeLimit();
  }, 40_000);
});

describe("REL-01 · MAX_SOCKETS", () => {
  it("at the limit, /readyz says 503 and new upgrades get 503", async () => {
    const small = await env.start({ MAX_SOCKETS: "2" });
    const a = await TestClient.open(small);
    const b = await TestClient.open(small);
    await Promise.all([a.type("hello"), b.type("hello")]);
    await expect(TestClient.open(small)).rejects.toThrow("HTTP 503");
    const ready = await fetch(`http://127.0.0.1:${small.port}/readyz`);
    expect(ready.status).toBe(503);
    expect((await ready.json()).reasons).toContain("full");
    a.close();
    b.close();
    await sleep(100);
    expect((await fetch(`http://127.0.0.1:${small.port}/readyz`)).status).toBe(200);
  });
});

describe("REL-21 · X-Forwarded-For only from TRUST_PROXY", () => {
  const keyFor = (ip: string) => `${env.iso.keyPrefix}rl:upgrade_ip:${relay().hub.limiter.ipKey(ip)}`;

  it("is ignored from an untrusted peer", async () => {
    const c = await TestClient.open(relay(), { headers: { "x-forwarded-for": "198.51.100.7" } });
    await c.type("hello");
    expect(await env.iso.redis.exists(keyFor("198.51.100.7"))).toBe(0);
    c.close();
  });

  it("is honoured from the trusted proxy (the right-most untrusted hop)", async () => {
    const proxied = await env.start({ TRUST_PROXY: "127.0.0.1/32" });
    const c = await TestClient.open(proxied, { headers: { "x-forwarded-for": "10.9.9.9, 203.0.113.9, 127.0.0.1" } });
    await c.type("hello");
    const key = `${env.iso.keyPrefix}rl:upgrade_ip:${proxied.hub.limiter.ipKey("203.0.113.9")}`;
    expect(await env.iso.redis.exists(key)).toBe(1);
    c.close();
  });
});
