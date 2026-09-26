// REL-02 the login handshake (7.3), C-7.3a/b, SEC-02 (a replayed login is refused).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSE, SUBPROTOCOL } from "@pehchaan/protocol";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("login", { env: { AUTH_DEADLINE_MS: "400", MIN_CLIENT_VERSION: "1.2.0" } });
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;

describe("REL-02 · login", () => {
  it("sends hello with every field first", async () => {
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    expect(h.body.serverNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(h.body.serverTime - Date.now())).toBeLessThan(5000);
    expect(h.body).toMatchObject({
      gatewayId: relay().gatewayId,
      minClient: "1.2.0",
      vapidKeyId: "v1",
      env: "test",
      e2eRequired: false,
    });
    expect(c.ws.protocol).toBe(SUBPROTOCOL);
    c.close();
  });

  it("a valid login gets auth.ok", async () => {
    const d = await TestDevice.create();
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    c.send("auth", await d.authBody(h.body.serverNonce, undefined, "1.2.0+9c1e2ab"));
    const ok = await c.type("auth.ok");
    expect(ok.body).toMatchObject({ pushStatus: "missing", lab: { optedIn: false } });
    c.close();
  });

  it("a bad signature closes 4401", async () => {
    const d = await TestDevice.create();
    const other = await TestDevice.create();
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    const body = await d.authBody(h.body.serverNonce, undefined, "1.2.0");
    c.send("auth", { ...body, sig: (await other.authBody(h.body.serverNonce, undefined, "1.2.0")).sig });
    expect((await c.closed).code).toBe(CLOSE.LOGIN_FAILED);
  });

  it("C-7.3b · a login signed for another relay host fails (the host comes from config)", async () => {
    const d = await TestDevice.create();
    const c = await TestClient.open(relay(), { headers: { host: "relay-staging.yourdomain.in" } });
    const h = await c.type("hello");
    c.send("auth", await d.authBody(h.body.serverNonce, "relay-staging.yourdomain.in", "1.2.0"));
    expect((await c.closed).code).toBe(CLOSE.LOGIN_FAILED);
  });

  it("SEC-02 · the server nonce is single-use: a captured login replayed on another socket fails", async () => {
    const d = await TestDevice.create();
    const first = await TestClient.open(relay());
    const h1 = await first.type("hello");
    const captured = await d.authBody(h1.body.serverNonce, undefined, "1.2.0");
    first.send("auth", captured);
    await first.type("auth.ok");
    const second = await TestClient.open(relay());
    await second.type("hello");
    second.send("auth", captured);
    expect((await second.closed).code).toBe(CLOSE.LOGIN_FAILED);
    first.close();
  });

  it("a second login attempt on the same socket can't reuse its nonce", async () => {
    const d = await TestDevice.create();
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    const good = await d.authBody(h.body.serverNonce, undefined, "1.2.0");
    c.send("auth", { ...good, sig: good.sig.split("").reverse().join("") });
    expect((await c.closed).code).toBe(CLOSE.LOGIN_FAILED);
  });

  it("no login within the deadline closes 4408", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    expect((await c.closed).code).toBe(CLOSE.LOGIN_TIMEOUT);
  });

  it("an app older than minClient closes 4426", async () => {
    const d = await TestDevice.create();
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    c.send("auth", await d.authBody(h.body.serverNonce, undefined, "1.1.9"));
    expect((await c.closed).code).toBe(CLOSE.APP_TOO_OLD);
  });

  it("a retired or blocked device closes 4403", async () => {
    for (const column of ["retired_at", "blocked_at"]) {
      const d = await TestDevice.create();
      (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
      await env.iso.pool.query(`update devices set ${column} = now() where device_id = $1`, [d.deviceId]);
      await env.iso.redis.del(`${env.iso.keyPrefix}dv:${d.deviceId}`);
      const c = await TestClient.open(relay());
      const h = await c.type("hello");
      c.send("auth", await d.authBody(h.body.serverNonce, undefined, "1.2.0"));
      expect((await c.closed).code, column).toBe(CLOSE.RETIRED_OR_BLOCKED);
    }
  });

  it("a message before login gets `unauthenticated`", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    const id = c.send("presence.query", { ids: ["Ar3Jn8Pk2Wq5Ez7Uy1Gd4F"] });
    expect((await c.error(id)).body.code).toBe("unauthenticated");
    c.close();
  });

  it("ping works before and after login", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    c.send("ping", {});
    const pong = await c.type("pong");
    expect(Math.abs(pong.body.serverTime - Date.now())).toBeLessThan(5000);
    c.close();
  });
});

describe("C-7.3a · the devices row", () => {
  it("is created at the first login, with the public key and day-precision last_seen_on", async () => {
    const d = await TestDevice.create();
    (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
    const r = await env.iso.pool.query(
      "select length(device_pub) as len, platform, last_seen_on::text as day from devices where device_id = $1",
      [d.deviceId],
    );
    expect(r.rows[0]).toMatchObject({ len: 65, platform: "test", day: new Date().toISOString().slice(0, 10) });
    const audit = await env.iso.pool.query(
      "select count(*)::int as n from audit_events where kind = 'device_first_seen'",
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("is written at most once a day per device (later logins skip the write)", async () => {
    const d = await TestDevice.create();
    (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
    // Move the row's day back; a second login today must not touch it again (the cache says "seen today").
    await env.iso.pool.query("update devices set last_seen_on = current_date - 3 where device_id = $1", [d.deviceId]);
    (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
    await sleep(100);
    const r = await env.iso.pool.query(
      "select (current_date - last_seen_on) as days from devices where device_id = $1",
      [d.deviceId],
    );
    expect(r.rows[0].days).toBe(3);
    // Once the cache is gone (a new day, in effect), the next login refreshes it.
    await env.iso.redis.del(`${env.iso.keyPrefix}dv:${d.deviceId}`);
    (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
    await sleep(100);
    const r2 = await env.iso.pool.query(
      "select (current_date - last_seen_on) as days from devices where device_id = $1",
      [d.deviceId],
    );
    expect(r2.rows[0].days).toBe(0);
  });

  it("a retired row is a tombstone: a login can't revive it", async () => {
    const d = await TestDevice.create();
    (await d.login(relay(), { grant: false, ver: "1.2.0" })).close();
    await env.iso.pool.query("update devices set retired_at = now() where device_id = $1", [d.deviceId]);
    await env.iso.redis.del(`${env.iso.keyPrefix}dv:${d.deviceId}`);
    const c = await TestClient.open(relay());
    const h = await c.type("hello");
    c.send("auth", await d.authBody(h.body.serverNonce, undefined, "1.2.0"));
    expect((await c.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
  });
});
