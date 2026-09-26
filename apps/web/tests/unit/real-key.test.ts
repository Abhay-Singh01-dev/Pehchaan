// RealKey (backend spec 10.3, 10.4, FC-4, FC-24; APP-05) with a software authenticator standing in for the phone
// (the security core's, which produces exactly what a passkey returns). The browser's own passkey flow runs in
// the Playwright journeys with a virtual authenticator.
import { beforeEach, describe, expect, it } from "vitest";
import { b64url, sha256, utf8 } from "@pehchaan/crypto/bytes";
import { softAssert } from "@pehchaan/crypto/soft-authenticator";
import { createRealKey, keyErrorFrom } from "@/services/real/RealKey";
import { createRealVerifier } from "@/services/real/RealVerifier";
import { createRequestFactory } from "@/services/requests";
import { newIdentity } from "@/services/identity";
import { KeyError } from "@/services/errors";
import type { FamilyMember, Profile } from "@/services/types";
import { db } from "@/store/db";
import { DEFAULT_PREFS } from "@/store/profile";

const ORIGIN = "https://pehchaan.test";
const RP_ID = "pehchaan.test";

/** A phone's platform authenticator, in software: resident ES256 keys, UV unless told otherwise. */
class SoftPlatform {
  private keys = new Map<string, CryptoKeyPair>();
  uv = true;
  failWith: string | null = null;
  lastGet: PublicKeyCredentialRequestOptions | null = null;
  lastCreate: PublicKeyCredentialCreationOptions | null = null;

  private fail() {
    if (!this.failWith) return;
    throw Object.assign(new Error(this.failWith), { name: this.failWith });
  }

  async create(o: CredentialCreationOptions): Promise<Credential> {
    this.lastCreate = o.publicKey!;
    this.fail();
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const rawId = crypto.getRandomValues(new Uint8Array(16));
    this.keys.set(b64url(rawId), pair);
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const authData = new Uint8Array([...(await sha256(utf8(RP_ID))), this.uv ? 0x45 : 0x41, 0, 0, 0, 0]);
    return {
      id: b64url(rawId),
      type: "public-key",
      rawId: rawId.buffer,
      response: {
        getPublicKeyAlgorithm: () => -7,
        getPublicKey: () => spki,
        getAuthenticatorData: () => authData.buffer,
      },
    } as unknown as Credential;
  }

  get(o: CredentialRequestOptions): Promise<Credential> {
    this.lastGet = o.publicKey!;
    return (async () => {
      this.fail();
      const allowed = o.publicKey!.allowCredentials![0]!.id as Uint8Array;
      const pair = this.keys.get(b64url(new Uint8Array(allowed)));
      if (!pair) throw Object.assign(new Error("no credential"), { name: "NotAllowedError" });
      const a = await softAssert({
        privateKey: pair.privateKey,
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: new Uint8Array(o.publicKey!.challenge as ArrayBuffer),
        flags: this.uv ? 0x05 : 0x01,
      });
      const bytes = (s: string) =>
        Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      return {
        rawId: allowed.buffer,
        response: {
          authenticatorData: bytes(a.authenticatorData).buffer,
          clientDataJSON: bytes(a.clientDataJSON).buffer,
          signature: bytes(a.signature).buffer,
        },
      } as unknown as Credential;
    })();
  }
}

let platform: SoftPlatform;
let profile: Profile | null;
const key = () =>
  createRealKey({ getProfile: async () => profile, credentials: platform as unknown as CredentialsContainer });
const requests = createRequestFactory();

beforeEach(async () => {
  platform = new SoftPlatform();
  profile = {
    ...DEFAULT_PREFS,
    deviceId: "arjun-device-000000000",
    name: "Arjun",
    color: "indigo",
    role: "can_be_verified",
    createdAt: 1,
    setupComplete: true,
  };
  await db.usedNonces.clear();
});

describe("creating the passkey (10.3)", () => {
  it("asks for a platform ES256 passkey with user verification, bound to the rpId", async () => {
    const k = await key().createKey({ deviceId: profile!.deviceId, name: "Arjun" });
    expect(k.keyId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(k.publicKey).toHaveLength(87);
    const o = platform.lastCreate!;
    expect(o.rp.id).toBe(RP_ID);
    expect(o.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(o.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      userVerification: "required",
    });
  });

  it("refuses a key created without a real unlock (no UV)", async () => {
    platform.uv = false;
    await expect(key().createKey({ deviceId: "d", name: "Arjun" })).rejects.toMatchObject({ code: "no_screen_lock" });
  });

  it("maps the browser's errors to A6's states", () => {
    const code = (name: string) => keyErrorFrom(Object.assign(new Error(name), { name })).code;
    expect(code("NotAllowedError")).toBe("cancelled");
    expect(code("AbortError")).toBe("cancelled");
    expect(code("NotSupportedError")).toBe("no_passkeys");
    expect(code("SecurityError")).toBe("failed");
    expect(code("InvalidStateError")).toBe("failed");
    expect(keyErrorFrom(new KeyError("no_key")).code).toBe("no_key");
  });
});

describe("signing an answer (10.4)", () => {
  async function arjunWithKey() {
    const k = await key().createKey({ deviceId: profile!.deviceId, name: "Arjun" });
    profile = { ...profile!, keyId: k.keyId, publicKey: k.publicKey };
    const id = await newIdentity();
    const member: FamilyMember = {
      v: 2,
      id: "m_arjun",
      deviceId: id.deviceId,
      name: "Arjun",
      color: "indigo",
      canBeVerified: true,
      devicePub: id.devicePub,
      encPub: id.encPub,
      grant: `${id.grantId}.${id.grantSecret}`,
      keyType: "pk",
      keyId: k.keyId,
      publicKey: k.publicKey,
      createdAt: 1,
      safetyWords: ["A", "B", "C", "D"],
      label: "Arjun",
      relation: "son",
      addedAt: 1,
      addedBy: "in_person",
    };
    return member;
  }

  it("needs prepareAnswer first (the challenges are computed when F1 opens)", async () => {
    await arjunWithKey();
    const req = requests.create({
      from: { deviceId: "maa", name: "Sunita" },
      member: { deviceId: "x", label: "Arjun" } as FamilyMember,
    });
    await expect(key().signAnswer(req, "ME")).rejects.toMatchObject({ code: "no_key" });
  });

  it("calls get() synchronously with the precomputed challenge, internal transport and UV required", async () => {
    const member = await arjunWithKey();
    const k = key();
    const req = requests.create({ from: { deviceId: "maa-device-00000000000", name: "Sunita" }, member });
    await k.prepareAnswer(req, Date.now() + 42_000);
    const pending = k.signAnswer(req, "NOT_ME");
    expect(platform.lastGet).not.toBeNull(); // before anything was awaited
    expect(platform.lastGet).toMatchObject({ rpId: RP_ID, userVerification: "required" });
    expect(platform.lastGet!.allowCredentials![0]).toMatchObject({ type: "public-key", transports: ["internal"] });
    expect(platform.lastGet!.timeout).toBeGreaterThan(40_000);
    const ans = await pending;
    expect(ans).toMatchObject({
      requestId: req.requestId,
      nonce: req.nonce,
      decision: "NOT_ME",
      keyType: "pk",
      credId: member.keyId,
    });
  });

  it("its answers pass all 7 checks of the real verifier", async () => {
    const member = await arjunWithKey();
    const k = key();
    const req = requests.create({ from: { deviceId: "maa-device-00000000000", name: "Sunita" }, member });
    await k.prepareAnswer(req);
    const ans = await k.signAnswer(req, "ME");
    const verdict = await createRealVerifier(db).verify({
      req,
      incoming: { ans, sealOk: true, envFrom: member.deviceId, re: req.requestId, receivedAt: Date.now() },
      member,
    });
    expect(verdict.verdict).toBe("VERIFIED");
  });

  it("a cancelled prompt is F5 ('Not confirmed. Tap to try again.'), not an error screen", async () => {
    const member = await arjunWithKey();
    const k = key();
    const req = requests.create({ from: { deviceId: "maa", name: "Sunita" }, member });
    await k.prepareAnswer(req);
    platform.failWith = "NotAllowedError";
    await expect(k.signAnswer(req, "ME")).rejects.toMatchObject({ code: "cancelled" });
  });
});
