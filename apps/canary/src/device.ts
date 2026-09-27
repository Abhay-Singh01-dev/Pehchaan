// A canary device (spec 19.6): software keys, like a phone's device keys but kept by the canary. A canary can't
// use a passkey, so its answers are signed by a software credential; the relay never judges answers anyway.
import { b64url, b64urlDecode } from "@pehchaan/crypto/bytes";
import { authMessage, deviceIdFrom, signAuth } from "@pehchaan/crypto/device-auth";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** What CANARY_IDENTITIES holds for one device (JSON; a GitHub secret for the scheduled canary). */
export interface StoredIdentity {
  sign: JsonWebKey;
  enc: JsonWebKey;
  grantId: string;
  grantSecret: string;
}

export interface CanaryDevice {
  deviceId: string;
  /** Device signing public key, raw, base64url (the card's `dk`). */
  dk: string;
  /** Device encryption public key, raw, base64url (the card's `ek`). */
  ek: string;
  signKey: CryptoKey;
  encKey: CryptoKey;
  grantId: string;
  grantSecret: string;
  /** The grant string another device uses to reach this one: "<grantId>.<secret>". */
  cardGrant: string;
  /** SHA-256 of the grant secret, as grant.set sends it. */
  grantHash: string;
  authBody(serverNonce: string, relayHost: string, ver: string): Promise<Record<string, unknown>>;
}

async function publicRaw(jwk: JsonWebKey, alg: typeof ECDSA | typeof ECDH): Promise<Uint8Array> {
  const { d: _private, key_ops: _ops, ...pub } = jwk;
  const k = await crypto.subtle.importKey("jwk", { ...pub, ext: true }, alg, true, alg === ECDSA ? ["verify"] : []);
  return new Uint8Array(await crypto.subtle.exportKey("raw", k));
}

async function fromStored(s: StoredIdentity): Promise<CanaryDevice> {
  const signKey = await crypto.subtle.importKey("jwk", s.sign, ECDSA, false, ["sign"]);
  const encKey = await crypto.subtle.importKey("jwk", s.enc, ECDH, false, ["deriveBits"]);
  const dkRaw = await publicRaw(s.sign, ECDSA);
  const ekRaw = await publicRaw(s.enc, ECDH);
  const deviceId = await deviceIdFrom(dkRaw);
  const hash = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", b64urlDecode(s.grantSecret))));
  return {
    deviceId,
    dk: b64url(dkRaw),
    ek: b64url(ekRaw),
    signKey,
    encKey,
    grantId: s.grantId,
    grantSecret: s.grantSecret,
    cardGrant: `${s.grantId}.${s.grantSecret}`,
    grantHash: hash,
    async authBody(serverNonce, relayHost, ver) {
      const sig = await signAuth(signKey, authMessage(relayHost, serverNonce, deviceId));
      // platform "canary": the relay marks these devices and leaves them out of statistics (19.6).
      return { deviceId, devicePub: b64url(dkRaw), sig, client: { ver, platform: "canary" } };
    },
  };
}

/** A new identity to store (the `keys` command prints two of these for CANARY_IDENTITIES). */
export async function newIdentity(): Promise<StoredIdentity> {
  const sign = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const enc = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  return {
    sign: await crypto.subtle.exportKey("jwk", sign.privateKey),
    enc: await crypto.subtle.exportKey("jwk", enc.privateKey),
    grantId: b64url(crypto.getRandomValues(new Uint8Array(8))),
    grantSecret: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

export const loadDevice = fromStored;
