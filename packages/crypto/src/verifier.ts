// THE VERIFIER: the 7 checks Maa's phone runs on every answer (spec 10.5, 10.6, 10.7).
//
// Nothing else in Pehchaan decides whether an answer is genuine. The relay only carries it; a green
// "Confirmed" needs all 7 checks to pass AND the decision to be ME.
//
// Inputs (10.5): the request as stored on THIS phone (never the copy inside the answer); the answer;
// the relay-authenticated sender ID; the saved card of the person the request went to (looked up by
// the request's toDeviceId, never by the sender); the expected origin and rpId; this phone's receive
// time; and the used-nonce store.
import { b64url, b64urlDecode, concat, equalBytes, sha256, utf8 } from "./bytes";
import { challengeFor } from "./canonical";
import { derToRaw } from "./der";
import type {
  CanonicalRequestFields,
  CheckNumber,
  InvalidReason,
  MemberKey,
  VerifierCheck,
  VerifierResult,
  WireAnswer,
} from "./types";

const KEYS = { 1: "fresh", 2: "key", 3: "exact", 4: "address", 5: "unlocked", 6: "signature", 7: "unused" } as const;
const REASON = {
  1: "expired",
  2: "wrong_key",
  3: "changed",
  4: "wrong_app",
  5: "not_unlocked",
  6: "bad_signature",
  7: "reused",
} as const;
/** When several checks fail, the reason shown is the first of these that applies (10.5). */
export const PRIORITY: readonly InvalidReason[] = [
  "reused",
  "wrong_key",
  "wrong_app",
  "changed",
  "not_unlocked",
  "bad_signature",
  "expired",
];
const SKEW_MS = 0; // both timestamps come from this phone's clock (8.7), so no allowance
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface VerifyInput {
  req: CanonicalRequestFields;
  ans: WireAnswer;
  envFrom: string;
  member: MemberKey;
  expected: { origin: string; rpId: string };
  receivedAt: number;
  isNonceUsed: (nonce: string) => Promise<boolean>;
}

/** clientDataJSON as an object, or null if it isn't JSON describing an object. Parsing only: no checks. */
function readClientData(bytes: Uint8Array): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export async function verifyAnswer(i: VerifyInput): Promise<VerifierResult> {
  const { req, ans, member, expected } = i;
  const ok: Record<CheckNumber, boolean> = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false };
  let cd: Record<string, unknown> | null;
  let cdBytes: Uint8Array | null = null;
  let ad: Uint8Array | null;
  try {
    cdBytes = b64urlDecode(ans.clientDataJSON);
    cd = readClientData(cdBytes);
  } catch {
    cd = null; // not base64url or not JSON: checks 3, 4 and 6 will fail
  }
  try {
    ad = b64urlDecode(ans.authenticatorData);
    if (ad.length < 37) ad = null; // rpIdHash (32) + flags (1) + signCount (4)
  } catch {
    ad = null;
  }

  // 1 · fresh: it answers MY pending request (same ID and nonce), and arrived by the request's own
  //     expiry on MY clock, the same instant my 60 s timer ends.
  const sameRequest = ans.requestId === req.requestId && ans.nonce === req.nonce;
  const inTime = i.receivedAt <= req.expiresAt + SKEW_MS;
  ok[1] = sameRequest && inTime;

  // 2 · key: the saved card is the person I asked, the relay says the answer came from that device,
  //     and the passkey that signed is the one on their card.
  ok[2] = member.deviceId === req.toDeviceId && i.envFrom === req.toDeviceId && ans.credId === member.credId;

  // 3 · exact: the signed challenge is SHA-256 of THIS request plus THIS decision, so a changed
  //     decision, a changed request or an answer to another request can't match.
  const decisionOk = ans.decision === "ME" || ans.decision === "NOT_ME";
  ok[3] = !!cd && decisionOk && cd.challenge === b64url(await challengeFor(req, ans.decision));

  // 4 · address: signed by a passkey for the Pehchaan app, on the real Pehchaan website: an assertion
  //     (not a registration), the right origin, not from inside another site, the right rpId hash.
  ok[4] =
    !!cd &&
    !!ad &&
    cd.type === "webauthn.get" &&
    cd.origin === expected.origin &&
    cd.crossOrigin !== true &&
    equalBytes(ad.subarray(0, 32), await sha256(utf8(expected.rpId)));

  // 5 · unlocked: the authenticator set both UP (someone was there) and UV (fingerprint, face or PIN).
  ok[5] = !!ad && (ad[32]! & 0x01) !== 0 && (ad[32]! & 0x04) !== 0;

  // 6 · signature: ECDSA P-256 over authenticatorData ‖ SHA-256(clientDataJSON) verifies with the
  //     passkey public key SAVED on the card, after converting the DER signature to raw r‖s.
  try {
    const key = await crypto.subtle.importKey("raw", b64urlDecode(member.passkeyPub), ECDSA, false, ["verify"]);
    ok[6] = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(b64urlDecode(ans.signature)),
      concat(ad!, await sha256(cdBytes!)),
    );
  } catch {
    ok[6] = false;
  }

  // 7 · unused: this nonce was never accepted before (a replayed old answer carries a spent nonce).
  ok[7] = !(await i.isNonceUsed(ans.nonce));

  const checks: VerifierCheck[] = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => ({ n, key: KEYS[n], passed: ok[n] }));
  const failed = checks.filter((c) => !c.passed).map((c) => c.n);
  if (failed.length === 0) return { verdict: ans.decision === "ME" ? "VERIFIED" : "DENIED", checks };
  // Late policy (10.7): only freshness failed, and only on time. A late NOT ME is still true and
  // important; a late YES never turns green.
  if (failed.length === 1 && failed[0] === 1 && sameRequest && !inTime) {
    return ans.decision === "NOT_ME"
      ? { verdict: "DENIED", late: true, checks }
      : { verdict: "NO_RESPONSE", noResponseReason: "late", checks };
  }
  const reasonOf = (n: CheckNumber): InvalidReason => (n === 1 ? (sameRequest ? "expired" : "reused") : REASON[n]);
  const invalidReason = PRIORITY.find((r) => failed.some((n) => reasonOf(n) === r))!;
  return { verdict: "INVALID", invalidReason, checks };
}
