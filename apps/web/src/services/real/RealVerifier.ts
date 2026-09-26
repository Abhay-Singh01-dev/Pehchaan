/*
 * RealVerifier — WRITTEN BY THE TEAM (about 80 lines). This is the Ownership centrepiece:
 * every teammate must be able to explain it line by line (spec Part A #2, Part E).
 *
 * The 7 checks, with WebCrypto:
 *   1 fresh      recompute the challenge from the pending request; the nonce must match a
 *                pending request of ours and not be expired (expiresAt).
 *   2 key        the credential id / public key is the one saved for this member.
 *   3 exact      the challenge inside clientDataJSON equals SHA-256(canonical(req) ‖ "|" ‖ decision)
 *                for the decision the answer claims.
 *   4 address    clientData.type === "webauthn.get", clientData.origin === our origin, and
 *                authenticatorData.rpIdHash === SHA-256(rpId).
 *   5 unlocked   authenticatorData flags UP and UV are set.
 *   6 signature  ECDSA P-256 / SHA-256 over authenticatorData ‖ SHA-256(clientDataJSON),
 *                verified with the member's SPKI public key (convert the DER signature to raw r‖s).
 *   7 unused     the nonce is not in the used-nonce cache (IndexedDB); then add it.
 *
 * Build each CheckResult with makeCheck() and turn them into a verdict with decideVerdict()
 * (services/verdict.ts), then return finalizeVerdict(result) — the same mapping SimVerifier
 * uses, so every INVALID reason is identical. Never return VERIFIED unless all 7 pass and the
 * decision is ME.
 */
import type { VerifierService } from "../types";

const todo = (): never => {
  throw new Error("Not implemented: team-owned");
};

export class RealVerifier implements VerifierService {
  verify = todo;
  resetUsedNonces = todo;
}
