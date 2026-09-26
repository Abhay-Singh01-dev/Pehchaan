// RealKey paths not covered by real-key.test.ts (backend spec 5.4, 10.3, 10.4; FC-4, FC-24; APP-05, C-5.4a,
// C-10.4a): support detection, the passkey creation checks, "Delete my key", and signing only the request whose
// challenges were prepared when F1 opened. The browser's WebAuthn objects don't exist in Node, so they are scripted
// here; the signature itself comes from the security core's software authenticator, and challenges are compared
// with the real challengeFor().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64url, sha256, utf8 } from "@pehchaan/crypto/bytes";
import { challengeFor } from "@pehchaan/crypto/canonical";
import { createSoftCredential, softAssert } from "@pehchaan/crypto/soft-authenticator";
import { createRealKey } from "@/services/real/RealKey";
import { KeyError } from "@/services/errors";
import { createRequestFactory } from "@/services/requests";
import type { FamilyMember, Profile } from "@/services/types";
import { DEFAULT_PREFS } from "@/store/profile";

const RP_ID = "pehchaan.test";
const ORIGIN = "https://pehchaan.test";
const requests = createRequestFactory();

/** A scripted platform authenticator: each test says what create() and get() return. */
class Platform {
  created: CredentialCreationOptions[] = [];
  got: CredentialRequestOptions[] = [];
  onCreate: () => Promise<unknown> = async () => null;
  onGet: (o: CredentialRequestOptions) => Promise<unknown> = async () => null;
  create(o: CredentialCreationOptions): Promise<Credential | null> {
    this.created.push(o);
    return this.onCreate() as Promise<Credential | null>;
  }
  get(o: CredentialRequestOptions): Promise<Credential | null> {
    this.got.push(o);
    return this.onGet(o) as Promise<Credential | null>;
  }
}

/** What navigator.credentials.create() resolves with, shaped like an AuthenticatorAttestationResponse. */
async function attestation(o: { alg?: number; spki?: ArrayBuffer | null; flags?: number } = {}) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = o.spki === undefined ? await crypto.subtle.exportKey("spki", pair.publicKey) : o.spki;
  const authData = new Uint8Array([...(await sha256(utf8(RP_ID))), o.flags ?? 0x45, 0, 0, 0, 0]);
  return {
    rawId: crypto.getRandomValues(new Uint8Array(16)).buffer,
    response: {
      getPublicKeyAlgorithm: () => o.alg ?? -7,
      getPublicKey: () => spki,
      getAuthenticatorData: () => authData.buffer,
    },
  };
}

const domError = (name: string) => Object.assign(new Error(name), { name });

let platform: Platform;
let profile: Profile | null;
const key = () =>
  createRealKey({ getProfile: async () => profile, credentials: platform as unknown as CredentialsContainer });

beforeEach(() => {
  platform = new Platform();
  profile = {
    ...DEFAULT_PREFS,
    deviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F",
    name: "Arjun",
    color: "indigo",
    role: "can_be_verified",
    createdAt: 1,
    setupComplete: true,
    keyId: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
});

afterEach(() => vi.unstubAllGlobals());

const aRequest = () =>
  requests.create({
    from: { deviceId: "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S", name: "Sunita" },
    member: { deviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F", label: "Arjun" } as FamilyMember,
  });

describe("checkSupport (10.3)", () => {
  it("a browser without WebAuthn: no passkeys, screen lock unknown", async () => {
    expect(typeof PublicKeyCredential).toBe("undefined");
    expect(await key().checkSupport()).toEqual({ passkeys: false, screenLock: "unknown" });
  });

  it("WebAuthn without the platform-authenticator check: no passkeys, screen lock unknown", async () => {
    vi.stubGlobal("PublicKeyCredential", {});
    expect(await key().checkSupport()).toEqual({ passkeys: false, screenLock: "unknown" });
  });

  it("a user-verifying platform authenticator: passkeys, and so a screen lock", async () => {
    vi.stubGlobal("PublicKeyCredential", { isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    expect(await key().checkSupport()).toEqual({ passkeys: true, screenLock: "yes" });
  });

  it("none available: no passkeys, and the screen lock can't be told apart (unknown)", async () => {
    vi.stubGlobal("PublicKeyCredential", { isUserVerifyingPlatformAuthenticatorAvailable: async () => false });
    expect(await key().checkSupport()).toEqual({ passkeys: false, screenLock: "unknown" });
  });

  it("the check itself failing counts as no passkeys (fail closed)", async () => {
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.reject(domError("NotSupportedError")),
    });
    expect(await key().checkSupport()).toEqual({ passkeys: false, screenLock: "unknown" });
  });
});

describe("createKey refuses anything but a real ES256 platform passkey (10.3)", () => {
  it("an algorithm other than ES256 (-7) is refused, and no key is returned", async () => {
    for (const alg of [-8, -257, -35]) {
      platform.onCreate = () => attestation({ alg });
      await expect(key().createKey({ deviceId: "d", name: "Arjun" }), String(alg)).rejects.toBeInstanceOf(KeyError);
    }
  });

  it("a credential without a public key is refused", async () => {
    platform.onCreate = () => attestation({ spki: null });
    await expect(key().createKey({ deviceId: "d", name: "Arjun" })).rejects.toBeInstanceOf(KeyError);
  });

  it("the browser's refusals map to A6's states: cancelled or timed out → try again; anything else → failed", async () => {
    platform.onCreate = () => Promise.reject(domError("NotAllowedError"));
    await expect(key().createKey({ deviceId: "d", name: "Arjun" })).rejects.toMatchObject({ code: "cancelled" });
    platform.onCreate = () => Promise.reject(domError("SecurityError"));
    await expect(key().createKey({ deviceId: "d", name: "Arjun" })).rejects.toMatchObject({ code: "failed" });
  });

  it("asks for no attestation, UV required, a 2-minute timeout and a random 32-byte challenge; the user handle is the device ID", async () => {
    platform.onCreate = () => attestation();
    const k = key();
    await k.createKey({ deviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F", name: "Arjun" });
    await k.createKey({ deviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F", name: "Arjun" });
    const [a, b] = platform.created.map((o) => o.publicKey!);
    expect(a).toMatchObject({
      attestation: "none",
      timeout: 120_000,
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      user: { name: "Arjun · Pehchaan", displayName: "Arjun" },
    });
    expect(new TextDecoder().decode(a!.user.id as Uint8Array)).toBe("Ar3Jn8Pk2Wq5Ez7Uy1Gd4F");
    expect((a!.challenge as Uint8Array).byteLength).toBe(32);
    expect(b64url(a!.challenge as Uint8Array)).not.toBe(b64url(b!.challenge as Uint8Array));
  });

  it("uses the browser's own navigator.credentials when none is injected", async () => {
    platform.onCreate = () => attestation();
    vi.stubGlobal("navigator", { credentials: platform });
    const k = createRealKey({ getProfile: async () => profile });
    const made = await k.createKey({ deviceId: "d", name: "Arjun" });
    expect(made.publicKey).toHaveLength(87);
    expect(platform.created).toHaveLength(1);
  });
});

describe("signing an answer (10.4, C-10.4a)", () => {
  it("signs with exactly the challenge prepared when F1 opened: challengeFor(request, decision)", async () => {
    const cred = await createSoftCredential();
    profile = { ...profile!, keyId: cred.credId };
    platform.onGet = async (o) => {
      const a = await softAssert({
        privateKey: cred.privateKey,
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: new Uint8Array(o.publicKey!.challenge as ArrayBuffer),
      });
      const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
      return {
        rawId: bytes(cred.credId).buffer,
        response: {
          authenticatorData: bytes(a.authenticatorData).buffer,
          clientDataJSON: bytes(a.clientDataJSON).buffer,
          signature: bytes(a.signature).buffer,
        },
      };
    };
    const req = aRequest();
    const k = key();
    await k.prepareAnswer(req);
    await k.signAnswer(req, "ME");
    await k.signAnswer(req, "NOT_ME");
    const [me, notMe] = platform.got.map((o) => b64url(new Uint8Array(o.publicKey!.challenge as ArrayBuffer)));
    expect(me).toBe(b64url(await challengeFor(req, "ME")));
    expect(notMe).toBe(b64url(await challengeFor(req, "NOT_ME")));
  });

  it("refuses to sign a different request than the one prepared, without opening the passkey prompt", async () => {
    const k = key();
    const prepared = aRequest();
    await k.prepareAnswer(prepared);
    await expect(k.signAnswer(aRequest(), "ME")).rejects.toMatchObject({ code: "no_key" });
    expect(platform.got).toHaveLength(0);
  });

  it("a phone without a passkey (checks only) has nothing to sign with", async () => {
    profile = { ...profile!, keyId: undefined };
    const k = key();
    const req = aRequest();
    await k.prepareAnswer(req);
    await expect(k.signAnswer(req, "ME")).rejects.toMatchObject({ code: "no_key" });
    expect(platform.got).toHaveLength(0);
  });

  it("gives the prompt at least 5 s, even when F1's time is nearly up", async () => {
    const k = key();
    const req = aRequest();
    await k.prepareAnswer(req, Date.now() - 1_000);
    void k.signAnswer(req, "ME").catch(() => {});
    expect(platform.got[0]!.publicKey!.timeout).toBe(5_000);
  });

  it("a prompt that ends with no credential is 'cancelled' (F5), not a signed answer", async () => {
    platform.onGet = async () => null;
    const k = key();
    const req = aRequest();
    await k.prepareAnswer(req);
    await expect(k.signAnswer(req, "ME")).rejects.toMatchObject({ code: "cancelled" });
  });

  it("a platform or configuration error while signing is 'failed'", async () => {
    platform.onGet = () => Promise.reject(domError("SecurityError"));
    const k = key();
    const req = aRequest();
    await k.prepareAnswer(req);
    await expect(k.signAnswer(req, "NOT_ME")).rejects.toMatchObject({ code: "failed" });
  });
});

describe("Delete my key (5.4, C-5.4a)", () => {
  it("tells the password manager the passkey is gone, where the browser supports it", async () => {
    const signal = vi.fn(async (_o: { rpId: string; credentialId: string }) => {});
    vi.stubGlobal("PublicKeyCredential", { signalUnknownCredential: signal });
    await key().deleteKey();
    expect(signal).toHaveBeenCalledWith({ rpId: RP_ID, credentialId: profile!.keyId });
  });

  it("forgets the prepared challenges, so nothing can be signed afterwards", async () => {
    const k = key();
    const req = aRequest();
    await k.prepareAnswer(req);
    await k.deleteKey();
    await expect(k.signAnswer(req, "ME")).rejects.toMatchObject({ code: "no_key" });
    expect(platform.got).toHaveLength(0);
  });

  it("still completes where the browser can't signal, or the signal fails, or there is no key", async () => {
    await expect(key().deleteKey()).resolves.toBeUndefined(); // no WebAuthn at all
    vi.stubGlobal("PublicKeyCredential", {});
    await expect(key().deleteKey()).resolves.toBeUndefined(); // no signalUnknownCredential
    const failing = vi.fn(() => Promise.reject(domError("NotAllowedError")));
    vi.stubGlobal("PublicKeyCredential", { signalUnknownCredential: failing });
    await expect(key().deleteKey()).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
    profile = { ...profile!, keyId: undefined };
    await key().deleteKey();
    expect(failing).toHaveBeenCalledTimes(1); // nothing to signal without a key
  });
});
