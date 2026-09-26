// End-to-end encryption of every payload, plus a sender signature (spec 9.2, 9.3).
//
//   header H = { v:1, kind, id, from, to, re? }          the deliver frame's own fields
//   aad      = UTF-8(canonical(H))
//   z        = ECDH(fresh ephemeral key, recipient.ek)
//   K        = HKDF-SHA-256(z, salt = epk ‖ recipient.ek, info = "pehchaan-e2e-v1|" + kind) → AES-256-GCM
//   ct       = AES-256-GCM(K, iv, aad).encrypt(UTF-8(JSON(payload)))
//   sig      = ECDSA(sender device key, "pehchaan-env-v1" ‖ SHA-256(aad) ‖ epk ‖ iv ‖ SHA-256(ct))
//
// Anyone can encrypt TO a device, including the relay; the signature proves the envelope came from the
// device holding the sender's key, so the relay can't fabricate "Maa is asking" or a family alert.
import { b64url, b64urlDecode, concat, equalBytes, sha256, utf8 } from "./bytes";
import { canonical } from "./canonical";
import { deviceIdFrom } from "./device-auth";

export const E2E_ALG = "p256-hkdf-a256gcm";
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG = { name: "ECDSA", hash: "SHA-256" } as const;

export interface Header {
  kind: string;
  id: string;
  from: string;
  to: string;
  re?: string;
}
export interface Sealed {
  alg: string;
  epk: string;
  iv: string;
  ct: string;
  sig: string;
}

export const headerAad = (h: Header): Uint8Array<ArrayBuffer> =>
  utf8(canonical({ v: 1, kind: h.kind, id: h.id, from: h.from, to: h.to, re: h.re }));

async function aesKey(
  priv: CryptoKey,
  peerPubRaw: Uint8Array,
  epk: Uint8Array,
  recipientPub: Uint8Array,
  kind: string,
) {
  const peer = await crypto.subtle.importKey("raw", peerPubRaw as Uint8Array<ArrayBuffer>, ECDH, false, []);
  const z = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256);
  const ikm = await crypto.subtle.importKey("raw", z, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(epk, recipientPub), info: utf8("pehchaan-e2e-v1|" + kind) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const sigInput = async (aad: Uint8Array, epk: Uint8Array, iv: Uint8Array, ct: Uint8Array) =>
  concat(utf8("pehchaan-env-v1"), await sha256(aad), epk, iv, await sha256(ct));

export async function seal(
  payload: object,
  h: Header,
  recipientEk: Uint8Array,
  senderSignPriv: CryptoKey,
): Promise<Sealed> {
  const eph = await crypto.subtle.generateKey(ECDH, false, ["deriveBits"]);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const key = await aesKey(eph.privateKey, recipientEk, epk, recipientEk, h.kind);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = headerAad(h);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, utf8(JSON.stringify(payload))),
  );
  const sig = new Uint8Array(await crypto.subtle.sign(SIG, senderSignPriv, await sigInput(aad, epk, iv, ct)));
  return { alg: E2E_ALG, epk: b64url(epk), iv: b64url(iv), ct: b64url(ct), sig: b64url(sig) };
}

/** Opens a sealed envelope addressed to me. Any failure (wrong key, changed header or ciphertext,
 *  a sender whose key doesn't match the envelope's sender ID or my saved card, a bad signature) throws
 *  `tampered`: the envelope was changed in transit (9.4). */
export async function open<T extends { spk: string }>(
  e: Sealed,
  h: Header,
  myEkPriv: CryptoKey,
  myEkRaw: Uint8Array,
  knownSenderDk?: string,
): Promise<T> {
  try {
    if (e.alg !== E2E_ALG) throw 0;
    const epk = b64urlDecode(e.epk);
    const iv = b64urlDecode(e.iv);
    const ct = b64urlDecode(e.ct);
    const aad = headerAad(h);
    const key = await aesKey(myEkPriv, epk, epk, myEkRaw, h.kind);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, ct);
    const payload = JSON.parse(new TextDecoder().decode(pt)) as T;
    const spk = b64urlDecode(payload.spk);
    if ((await deviceIdFrom(spk)) !== h.from) throw 0; // sender key ↔ sender id
    if (knownSenderDk && !equalBytes(spk, b64urlDecode(knownSenderDk))) throw 0; // matches the saved card
    const pub = await crypto.subtle.importKey("raw", spk, ECDSA, false, ["verify"]);
    if (!(await crypto.subtle.verify(SIG, pub, b64urlDecode(e.sig), await sigInput(aad, epk, iv, ct)))) throw 0;
    return payload;
  } catch {
    throw new Error("tampered");
  }
}
