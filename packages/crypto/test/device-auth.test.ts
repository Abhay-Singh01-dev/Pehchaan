// CRY-04 device IDs; CRY-05 the relay login signature (5.2, 7.3).
import { describe, expect, it } from "vitest";
import { b64url, b64urlDecode } from "../src/bytes";
import { authMessage, deviceIdFrom, isRawP256, signAuth, verifyAuth } from "../src/device-auth";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

async function device() {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, pub, devicePub: b64url(pub), deviceId: await deviceIdFrom(pub) };
}

describe("CRY-04 · deviceIdFrom (5.2)", () => {
  it("is 22 base64url characters, deterministic, and distinct for distinct keys", async () => {
    const a = await device();
    const b = await device();
    expect(a.deviceId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await deviceIdFrom(a.pub)).toBe(a.deviceId);
    expect(a.deviceId).not.toBe(b.deviceId);
  });

  it("is the first 22 characters of base64url(SHA-256(pub))", async () => {
    const a = await device();
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", a.pub));
    expect(a.deviceId).toBe(b64url(hash).slice(0, 22));
  });
});

describe("CRY-05 · login signature (7.3)", () => {
  const HOST = "relay.yourdomain.in";
  const NONCE = b64url(crypto.getRandomValues(new Uint8Array(32)));

  it("builds the exact message", () => {
    expect(new TextDecoder().decode(authMessage("h", "n", "d"))).toBe("pehchaan-auth-v1\nh\nn\nd");
  });

  it("accepts a valid login", async () => {
    const d = await device();
    const sig = await signAuth(d.pair.privateKey, authMessage(HOST, NONCE, d.deviceId));
    expect(b64urlDecode(sig)).toHaveLength(64); // raw r‖s
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: d.devicePub, sig }, NONCE, HOST)).toBe(true);
  });

  it("rejects the wrong relay host, the wrong nonce and the wrong device ID", async () => {
    const d = await device();
    const other = await device();
    const sig = await signAuth(d.pair.privateKey, authMessage(HOST, NONCE, d.deviceId));
    const b = { deviceId: d.deviceId, devicePub: d.devicePub, sig };
    expect(await verifyAuth(b, NONCE, "relay-staging.yourdomain.in")).toBe(false);
    expect(await verifyAuth(b, b64url(crypto.getRandomValues(new Uint8Array(32))), HOST)).toBe(false);
    expect(await verifyAuth({ ...b, deviceId: other.deviceId }, NONCE, HOST)).toBe(false);
  });

  it("rejects a key that isn't 65 bytes starting with 0x04, or whose ID doesn't match", async () => {
    const d = await device();
    const sig = await signAuth(d.pair.privateKey, authMessage(HOST, NONCE, d.deviceId));
    const short = b64url(d.pub.subarray(0, 64));
    const compressedPrefix = new Uint8Array(d.pub);
    compressedPrefix[0] = 0x02;
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: short, sig }, NONCE, HOST)).toBe(false);
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: b64url(compressedPrefix), sig }, NONCE, HOST)).toBe(
      false,
    );
    const other = await device();
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: other.devicePub, sig }, NONCE, HOST)).toBe(false);
  });

  it("rejects a signature by another key, and garbage input without throwing", async () => {
    const d = await device();
    const other = await device();
    const sig = await signAuth(other.pair.privateKey, authMessage(HOST, NONCE, d.deviceId));
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: d.devicePub, sig }, NONCE, HOST)).toBe(false);
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: "!!", sig }, NONCE, HOST)).toBe(false);
    expect(await verifyAuth({ deviceId: d.deviceId, devicePub: d.devicePub, sig: "a" }, NONCE, HOST)).toBe(false);
  });

  it("rejects a 65-byte 0x04 string that isn't a point on the curve", async () => {
    const bogus = new Uint8Array(65).fill(7);
    bogus[0] = 0x04;
    const id = await deviceIdFrom(bogus);
    const b = { deviceId: id, devicePub: b64url(bogus), sig: b64url(new Uint8Array(64)) };
    expect(await verifyAuth(b, NONCE, HOST)).toBe(false);
  });

  it("isRawP256 checks length and prefix", () => {
    const k = new Uint8Array(65);
    k[0] = 4;
    expect(isRawP256(k)).toBe(true);
    expect(isRawP256(k.subarray(1))).toBe(false);
  });
});
