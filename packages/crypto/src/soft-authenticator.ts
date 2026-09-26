// A software WebAuthn authenticator: produces assertions in exactly the format a phone's passkey does
// (authenticatorData, clientDataJSON, DER-encoded ES256 signature), from a P-256 key held in software.
//
// It is NOT a passkey and gives none of a passkey's protection. It exists for:
//   - the simulated key (SimKey, D-008), so simulation runs the one real verifier;
//   - the Security Lab's "Forge a yes" (14.3), which builds a perfect-looking answer with its own key;
//   - the canary and the load generator (19.6, 21.4), which can't use a passkey;
//   - tests.
import { b64url, concat, sha256, utf8 } from "./bytes";
import { challengeFor } from "./canonical";
import { rawToDer } from "./der";
import type { CanonicalRequestFields, Decision, WireAnswer } from "./types";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface SoftCredential {
  /** base64url credential ID (16 random bytes). */
  credId: string;
  /** Raw uncompressed public key, base64url (goes on the card as `pk`). */
  publicKey: string;
  privateKey: CryptoKey;
}

export async function createSoftCredential(): Promise<SoftCredential> {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    credId: b64url(crypto.getRandomValues(new Uint8Array(16))),
    publicKey: b64url(pub),
    privateKey: pair.privateKey,
  };
}

export interface AssertionOptions {
  privateKey: CryptoKey;
  rpId: string;
  origin: string;
  challenge: Uint8Array;
  /** Flags byte; default UP | UV (0x05), as after a fingerprint. */
  flags?: number;
  /** clientData.type; default "webauthn.get". */
  type?: string;
  crossOrigin?: boolean;
}

export interface Assertion {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export async function softAssert(o: AssertionOptions): Promise<Assertion> {
  const authData = concat(await sha256(utf8(o.rpId)), new Uint8Array([o.flags ?? 0x05]), new Uint8Array(4));
  const clientData = utf8(
    JSON.stringify({
      type: o.type ?? "webauthn.get",
      challenge: b64url(o.challenge),
      origin: o.origin,
      crossOrigin: o.crossOrigin ?? false,
    }),
  );
  const signed = concat(authData, await sha256(clientData));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, o.privateKey, signed));
  return { authenticatorData: b64url(authData), clientDataJSON: b64url(clientData), signature: b64url(rawToDer(raw)) };
}

/** A complete answer to a request, signed the way a passkey would sign it. */
export async function softAnswer(p: {
  req: CanonicalRequestFields;
  decision: Decision;
  credId: string;
  privateKey: CryptoKey;
  rpId: string;
  origin: string;
  flags?: number;
  answeredAt?: number;
}): Promise<WireAnswer> {
  const a = await softAssert({
    privateKey: p.privateKey,
    rpId: p.rpId,
    origin: p.origin,
    challenge: await challengeFor(p.req, p.decision),
    ...(p.flags === undefined ? {} : { flags: p.flags }),
  });
  return {
    requestId: p.req.requestId,
    nonce: p.req.nonce,
    decision: p.decision,
    keyType: "pk",
    credId: p.credId,
    ...a,
    answeredAt: p.answeredAt ?? Date.now(),
  };
}
