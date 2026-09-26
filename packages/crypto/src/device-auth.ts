// Device identity and the relay login signature (spec 5.2, 7.3). Used by the app to sign and by the relay
// to verify: this is the only file of the security core the relay may import (section 4).
import { b64url, b64urlDecode, sha256, utf8 } from "./bytes";

const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ES256 = { name: "ECDSA", hash: "SHA-256" } as const;

/** The signed login message binds the relay host (a staging login can't be replayed against production)
 *  and the one-time server nonce (a captured login can't be replayed at all). */
export function authMessage(relayHost: string, serverNonce: string, deviceId: string): Uint8Array<ArrayBuffer> {
  return utf8(`pehchaan-auth-v1\n${relayHost}\n${serverNonce}\n${deviceId}`);
}

/** deviceId = base64url(SHA-256(devicePubRaw)).slice(0, 22): self-certifying, 132 bits. */
export async function deviceIdFrom(pubRaw: Uint8Array): Promise<string> {
  return b64url(await sha256(pubRaw)).slice(0, 22);
}

/** A raw uncompressed P-256 public key is exactly 65 bytes and starts with 0x04 (5.1). */
export function isRawP256(pub: Uint8Array): boolean {
  return pub.length === 65 && pub[0] === 0x04;
}

/** App side: sign the login message with the device's non-extractable signing key. */
export async function signAuth(priv: CryptoKey, msg: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign(ES256, priv, msg as Uint8Array<ArrayBuffer>);
  return b64url(new Uint8Array(sig)); // WebCrypto ECDSA output is raw r‖s, 64 bytes
}

/** Relay side: check that the device owns the key its ID was derived from, and signed this exact login. */
export async function verifyAuth(
  b: { deviceId: string; devicePub: string; sig: string },
  serverNonce: string,
  relayHost: string,
): Promise<boolean> {
  try {
    const pub = b64urlDecode(b.devicePub);
    if (!isRawP256(pub)) return false; // 1. 65 bytes, 0x04 prefix
    if ((await deviceIdFrom(pub)) !== b.deviceId) return false; // 2. the ID belongs to this key
    const key = await crypto.subtle.importKey("raw", pub, ECDSA_P256, false, ["verify"]);
    const msg = authMessage(relayHost, serverNonce, b.deviceId);
    return await crypto.subtle.verify(ES256, key, b64urlDecode(b.sig), msg); // 3. the signature
  } catch {
    return false; // undecodable input or a key WebCrypto rejects (not on the curve)
  }
}
