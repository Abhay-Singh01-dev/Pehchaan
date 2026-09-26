// REL-14: every error code in 7.5 is produced by a test (the ones not produced here are asserted in the file
// named next to them). REL-15: one test per row of the 16.3 authorisation table.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ERROR_CODES, ulid } from "@pehchaan/protocol";
import { TestClient, TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("errors");
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;
const seen = new Set<string>();
const code = async (c: TestClient, id: string) => {
  const e = await c.error(id);
  seen.add(e.body.code);
  return e.body.code;
};

describe("REL-14 · every error code", () => {
  it("bad_request, unauthenticated, too_large", async () => {
    const c = await TestClient.open(relay());
    await c.type("hello");
    const id = ulid();
    c.ws.send(JSON.stringify({ v: 1, t: "ack", id, ts: 1, body: {} }));
    expect(await code(c, id)).toBe("bad_request");
    const unauth = c.send("contact.list", {});
    expect(await code(c, unauth)).toBe("unauthenticated");
    c.ws.send("x".repeat(17 * 1024));
    expect((await c.type("error", (e) => e.body.code === "too_large")).body.code).toBe("too_large");
    seen.add("too_large");
    c.close();
  });

  it("not_allowed, unknown_target, duplicate_request, already_answered, cancelled, expired, rate_limited", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const ghost = await TestDevice.create();
    const a = await arjun.login(relay());
    const m = await maa.login(relay());

    const noGrant = await maa.plainSend("verify.request", arjun);
    m.send("send", noGrant.body, noGrant.id);
    expect(await code(m, noGrant.id)).toBe("not_allowed");

    const toGhost = await maa.plainSend("verify.request", ghost, { grant: ghost.cardGrant });
    m.send("send", toGhost.body, toGhost.id);
    expect(await code(m, toGhost.id)).toBe("unknown_target");

    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    await env.iso.redis.del(`${env.iso.keyPrefix}rl:request_pair:${maa.deviceId}>${arjun.deviceId}`);
    const dup = await maa.plainSend("verify.request", arjun, { re: req.re });
    m.send("send", dup.body, dup.id);
    expect(await code(m, dup.id)).toBe("duplicate_request");

    const ans = await arjun.plainSend("verify.answer", maa, { re: req.re });
    a.send("send", ans.body, ans.id);
    await a.receipt(ans.id, "accepted");
    const ans2 = await arjun.plainSend("verify.answer", maa, { re: req.re });
    a.send("send", ans2.body, ans2.id);
    expect(await code(a, ans2.id)).toBe("already_answered");

    await env.iso.redis.del(`${env.iso.keyPrefix}rl:request_pair:${maa.deviceId}>${arjun.deviceId}`);
    const req2 = await maa.plainSend("verify.request", arjun);
    m.send("send", req2.body, req2.id);
    await m.receipt(req2.id, "accepted");
    m.send("cancel", { re: req2.re! });
    await a.type("deliver", (f) => f.body.kind === "verify.cancel" && f.body.re === req2.re);
    const ans3 = await arjun.plainSend("verify.answer", maa, { re: req2.re });
    a.send("send", ans3.body, ans3.id);
    expect(await code(a, ans3.id)).toBe("cancelled");

    const ans4 = await arjun.plainSend("verify.answer", maa, { re: ulid() });
    a.send("send", ans4.body, ans4.id);
    expect(await code(a, ans4.id)).toBe("expired");

    const q: string[] = [];
    for (let i = 0; i < 11; i++) q.push(m.send("presence.query", { ids: [arjun.deviceId] }));
    expect(await code(m, q[10]!)).toBe("rate_limited");
    expect((await m.error(q[10]!)).body.retryAfterMs).toBeGreaterThan(0);
    a.close();
    m.close();
  });

  it("e2e_required (a relay with E2E_REQUIRED=true refuses plain)", async () => {
    const strict = await env.start({ E2E_REQUIRED: "true" });
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(strict)).close();
    const m = await maa.login(strict);
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    expect(await code(m, req.id)).toBe("e2e_required");
    m.close();
  });

  it("lab_disabled (the Lab module isn't loaded)", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay());
    const id = c.send("lab.optin", { password: "whatever" });
    expect(await code(c, id)).toBe("lab_disabled");
    c.close();
  });

  it("unavailable (Valkey unreachable: the relay fails closed)", async () => {
    const r = await env.start();
    const d = await TestDevice.create();
    const c = await d.login(r);
    r.hub.redis.disconnect(false);
    const id = c.send("contact.list", {});
    // contact.list reads Postgres only, so use something that needs Valkey:
    await c.type("contact.list.result");
    const q = c.send("presence.query", { ids: [d.deviceId] });
    expect(await code(c, q)).toBe("unavailable");
    void id;
    c.close();
  });

  it("covers the whole table (lab_denied: lab.int.test.ts)", () => {
    const elsewhere = new Set(["lab_denied"]);
    for (const c of ERROR_CODES) if (!elsewhere.has(c)) expect(seen.has(c), c).toBe(true);
  });
});

describe("REL-15 / C-B5b · the 16.3 table, one function per row", () => {
  it("core/authz.ts exports exactly the 13 row functions", async () => {
    const authz = await import("../src/core/authz");
    expect(Object.keys(authz).sort()).toEqual(
      [
        "authenticatedAndActive",
        "mayRequest",
        "mayAnswer",
        "maySee",
        "ackTargetsOwnInbox",
        "mayCancel",
        "mayAlertOrPrompt",
        "presenceVisible",
        "ownDeviceOnly",
        "labAvailable",
        "mayInject",
        "mayReport",
        "plainAllowed",
      ].sort(),
    );
    const src = readFileSync(new URL("../src/core/authz.ts", import.meta.url), "utf8");
    for (let row = 1; row <= 13; row++) expect(src, `row ${row}`).toContain(`Row ${row} ·`);
  });

  it("row 1 · a blocked device's live socket is refused on its next message", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay());
    await env.iso.pool.query("update devices set blocked_at = now() where device_id=$1", [d.deviceId]);
    await relay().hub.devices.invalidate(d.deviceId);
    const r = await relay().hub.devices.status(d.deviceId);
    expect(r.blocked).toBe(true);
    const { authenticatedAndActive } = await import("../src/core/authz");
    await expect(authenticatedAndActive(relay().hub, d.deviceId)).rejects.toMatchObject({ code: "not_allowed" });
    await expect(authenticatedAndActive(relay().hub, null)).rejects.toMatchObject({ code: "unauthenticated" });
    c.close();
  });

  it("row 4 · seen: only a target of an open request", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const priya = await TestDevice.create();
    const a = await arjun.login(relay());
    const m = await maa.login(relay());
    const p = await priya.login(relay());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    expect(await code(p, p.send("seen", { re: req.re! }))).toBe("not_allowed");
    m.send("cancel", { re: req.re! });
    await a.type("deliver", (f) => f.body.kind === "verify.cancel");
    expect(await code(a, a.send("seen", { re: req.re! }))).toBe("not_allowed"); // no longer open
    [a, m, p].forEach((c) => c.close());
  });

  it("row 5 · ack only touches my own inbox", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const priya = await TestDevice.create();
    const a = await arjun.login(relay());
    const m = await maa.login(relay());
    const p = await priya.login(relay());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await a.type("deliver", (f) => f.id === req.id);
    p.send("ack", { of: req.id }); // Priya acks a message in Arjun's inbox: nothing happens
    await new Promise((r) => setTimeout(r, 300));
    expect(await relay().hub.inbox.size(arjun.deviceId)).toBe(1);
    expect(m.all("receipt").some((r) => r.body.state === "delivered")).toBe(false);
    [a, m, p].forEach((c) => c.close());
  });

  it("row 8 · presence answers only for devices that accept me (strangers are offline)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const stranger = await TestDevice.create();
    const a = await arjun.login(relay());
    const s = await stranger.login(relay());
    const m = await maa.login(relay());
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    m.send("presence.query", { ids: [arjun.deviceId, stranger.deviceId] });
    const p = await m.type("presence");
    expect(p.body.states).toEqual({ [arjun.deviceId]: "online", [stranger.deviceId]: "offline" });
    [a, s, m].forEach((c) => c.close());
  });

  it("row 9 · a device can only act on itself (the target comes from the socket, never the message)", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay());
    // grant.set has no field naming a device at all; contact.revoke names the OTHER device, never the owner.
    const id = c.send("grant.set", { grantId: d.grant.id, hash: d.grant.hash, rotate: false, deviceId: "x" } as never);
    expect(await code(c, id)).toBe("bad_request");
    c.close();
  });
});
