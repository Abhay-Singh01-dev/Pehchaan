// apps/canary (spec 19.4, 19.6): settings, the SLO evaluation, and the synthetic devices' keys and logins, with the
// real security core. (OPS-10, a full run against the local stack, is in Phase 10.)
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { verifyAuth } from "@pehchaan/crypto/device-auth";
import { parseClientFrame, ulid } from "@pehchaan/protocol";
import { LIMITS, evaluate } from "../src/canary";
import { CANARY_VERSION } from "../src/client";
import { httpBase, settingsFrom } from "../src/cli";
import { loadDevice, newIdentity } from "../src/device";

describe("settings", () => {
  const ok = { CANARY_RELAY_URL: "wss://relay.example.in/v1/ws", CANARY_ORIGIN: "https://app.example.in" };

  it("reads the relay URL, the origin and the login host (defaulting to the URL's host)", () => {
    expect(settingsFrom(ok)).toEqual({
      ep: { url: ok.CANARY_RELAY_URL, origin: ok.CANARY_ORIGIN, relayHost: "relay.example.in" },
      identities: null,
    });
    expect(settingsFrom({ ...ok, CANARY_RELAY_HOST: "other.example.in" }).ep.relayHost).toBe("other.example.in");
  });

  it("refuses missing or malformed settings", () => {
    expect(() => settingsFrom({ CANARY_ORIGIN: ok.CANARY_ORIGIN })).toThrow(/CANARY_RELAY_URL/);
    expect(() => settingsFrom({ ...ok, CANARY_RELAY_URL: "https://relay" })).toThrow(/CANARY_RELAY_URL/);
    expect(() => settingsFrom({ ...ok, CANARY_ORIGIN: "app.example.in" })).toThrow(/CANARY_ORIGIN/);
    expect(() => settingsFrom({ ...ok, CANARY_IDENTITIES: JSON.stringify({ asker: {} }) })).toThrow(
      /CANARY_IDENTITIES/,
    );
  });

  it("finds the relay's HTTP origin for the smoke test", () => {
    expect(httpBase("wss://relay.example.in/v1/ws")).toBe("https://relay.example.in");
    expect(httpBase("ws://localhost:8081/v1/ws")).toBe("http://localhost:8081");
  });
});

describe("the SLO check (19.4)", () => {
  const t = { loginMs: 300, acceptedMs: 40, deliveredMs: 60, roundTripMs: 900 };
  it("passes a healthy run", () => expect(evaluate(t)).toBeNull());
  it("fails a slow login or a slow round trip", () => {
    expect(evaluate({ ...t, loginMs: LIMITS.loginMs + 1 })).toMatch(/login/);
    expect(evaluate({ ...t, roundTripMs: LIMITS.roundTripMs + 1 })).toMatch(/round trip/);
  });
});

describe("canary devices (19.6)", () => {
  it("are stable across runs: the stored identity gives the same device ID, keys and grant", async () => {
    const id = await newIdentity();
    const [a, b] = [await loadDevice(id), await loadDevice(JSON.parse(JSON.stringify(id)))];
    expect(a.deviceId).toBe(b.deviceId);
    expect(a.deviceId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.dk).toBe(b.dk);
    expect(a.cardGrant).toBe(`${id.grantId}.${id.grantSecret}`);
    expect(a.grantHash).toBe(createHash("sha256").update(b64urlDecode(id.grantSecret)).digest("base64url"));
  });

  it("log in with a signature the relay's check accepts, marked as a canary", async () => {
    const d = await loadDevice(await newIdentity());
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const body = (await d.authBody(nonce, "relay.example.in", "canary")) as {
      deviceId: string;
      devicePub: string;
      sig: string;
      client: { platform: string };
    };
    expect(await verifyAuth(body, nonce, "relay.example.in")).toBe(true);
    expect(await verifyAuth(body, nonce, "other.example.in")).toBe(false);
    expect(body.client.platform).toBe("canary");
  });

  it("send a login the relay's schema accepts (a semver version, found by the first run against a relay)", async () => {
    const d = await loadDevice(await newIdentity());
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const frame = JSON.stringify({
      v: 1,
      t: "auth",
      id: ulid(),
      ts: Date.now(),
      body: await d.authBody(nonce, "r", CANARY_VERSION),
    });
    expect(parseClientFrame(frame).ok).toBe(true);
  });
});
