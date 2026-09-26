// The device identity (backend spec 5.1–5.4, 6.4, FC-2, FC-11; APP-02).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64url, b64urlDecode, sha256 } from "@pehchaan/crypto/bytes";
import { deviceIdFrom } from "@pehchaan/crypto/device-auth";
import {
  ensureIdentity,
  grantHash,
  identity,
  myGrant,
  newIdentity,
  persistStorage,
  resetIdentityCache,
  rotateLocalGrant,
  storageState,
} from "@/services/identity";
import { db } from "@/store/db";

beforeEach(async () => {
  resetIdentityCache();
  await db.identity.clear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "storage");
});

describe("a new identity (5.1, 5.2)", () => {
  it("derives the device ID from the signing key (self-certifying)", async () => {
    const id = await newIdentity();
    expect(id.deviceId).toBe(await deviceIdFrom(b64urlDecode(id.devicePub)));
    expect(id.deviceId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b64urlDecode(id.devicePub)).toHaveLength(65);
    expect(b64urlDecode(id.encPub)).toHaveLength(65);
  });

  it("keeps both private keys non-extractable: not even this app can read them out", async () => {
    const id = await newIdentity();
    await expect(crypto.subtle.exportKey("jwk", id.signKey.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", id.encKey.privateKey)).rejects.toThrow();
    expect(id.signKey.privateKey.extractable).toBe(false);
    expect(id.encKey.privateKey.extractable).toBe(false);
  });

  it("has a contact grant: an 8-byte ID and a 16-byte secret (6.4)", async () => {
    const id = await newIdentity();
    expect(b64urlDecode(id.grantId)).toHaveLength(8);
    expect(b64urlDecode(id.grantSecret)).toHaveLength(16);
    expect(myGrant(id)).toBe(`${id.grantId}.${id.grantSecret}`);
  });
});

describe("the stored identity (FC-2)", () => {
  it("is created once, at first launch, and survives a restart", async () => {
    const first = await ensureIdentity();
    resetIdentityCache(); // a restart
    const again = await ensureIdentity();
    expect(again.deviceId).toBe(first.deviceId);
    expect(identity().deviceId).toBe(first.deviceId);
    expect(await db.identity.count()).toBe(1);
  });

  it("is never created twice, even when asked for at the same moment", async () => {
    const [a, b, c] = await Promise.all([ensureIdentity(), ensureIdentity(), ensureIdentity()]);
    expect(new Set([a.deviceId, b.deviceId, c.deviceId]).size).toBe(1);
    expect(await db.identity.count()).toBe(1);
  });

  it("a simulated device's fixed seed is used only when there is no identity yet", async () => {
    const seed = await newIdentity();
    const used = await ensureIdentity(async () => seed);
    expect(used.deviceId).toBe(seed.deviceId);
    resetIdentityCache();
    const other = await newIdentity();
    expect((await ensureIdentity(async () => other)).deviceId).toBe(seed.deviceId);
  });

  it("'Reset my code' changes only the grant; the keys and device ID stay", async () => {
    const before = await ensureIdentity();
    const after = await rotateLocalGrant();
    expect(after.deviceId).toBe(before.deviceId);
    expect(after.devicePub).toBe(before.devicePub);
    expect(after.grantSecret).not.toBe(before.grantSecret);
    resetIdentityCache();
    expect((await ensureIdentity()).grantSecret).toBe(after.grantSecret);
  });

  it("the relay is only ever given the SHA-256 of the grant secret (D-028)", async () => {
    const id = await newIdentity();
    expect(await grantHash(id.grantSecret)).toBe(b64url(await sha256(b64urlDecode(id.grantSecret))));
  });
});

describe("keeping it alive (5.4, FC-11)", () => {
  function storage(o: { persisted: boolean; grant: boolean }) {
    const persist = vi.fn(async () => o.grant);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: async () => o.persisted, persist },
    });
    return persist;
  }

  it("asks the browser to keep this app's storage after setup", async () => {
    const persist = storage({ persisted: false, grant: true });
    expect(await persistStorage()).toBe("protected");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports when the browser may still clear it", async () => {
    storage({ persisted: false, grant: false });
    expect(await persistStorage()).toBe("may_be_cleared");
    expect(await storageState()).toBe("may_be_cleared");
  });

  it("doesn't ask again when it is already protected", async () => {
    const persist = storage({ persisted: true, grant: true });
    expect(await persistStorage()).toBe("protected");
    expect(persist).not.toHaveBeenCalled();
  });

  it("says 'unsupported' without the storage API", async () => {
    expect(await persistStorage()).toBe("unsupported");
  });
});
