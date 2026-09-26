/*
 * RealKey — TEAM-OWNED. Replaces SimKey when SIMULATION=false (spec Part E).
 *
 * createKey:
 *   navigator.credentials.create({ publicKey: {
 *     authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required",
 *                               residentKey: "preferred" },
 *     pubKeyCredParams: [{ type: "public-key", alg: -7 }],   // ES256
 *     rp: { id: <the fixed HTTPS domain>, name: "Pehchaan" }, ... } })
 *   Read the public key with response.getPublicKey() (SPKI) and derive the four safety words
 *   from its SHA-256 with safetyWordsFor() in services/words.ts.
 *
 * signAnswer(req, decision):
 *   challenge = SHA-256( canonical(request) ‖ "|" ‖ decision )
 *   navigator.credentials.get({ publicKey: { challenge, allowCredentials: [credentialId],
 *                               userVerification: "required" } })
 *   Return authenticatorData, clientDataJSON and signature inside the SignedAnswer.
 *
 * Canonical request format (the real key and verifier must agree): JSON with keys sorted
 * alphabetically, no whitespace, containing v, requestId, nonce, fromDeviceId, toDeviceId,
 * claimedLabel, reason (if set), amountInr (if set), createdAt, expiresAt. The decision is
 * appended after "|" before hashing.
 *
 * Passkeys are bound to the domain (rpId): never change it after keys are created.
 */
import type { KeyService } from "../types";

const todo = (): never => {
  throw new Error("Not implemented: team-owned");
};

export class RealKey implements KeyService {
  checkSupport = todo;
  createKey = todo;
  signAnswer = todo;
  deleteKey = todo;
}
