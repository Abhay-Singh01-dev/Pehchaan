// SimVerifier (spec B3 item 4, B4 "The 7 checks"): runs the same 7 checks as the real
// verifier, against the simulated signature, and remembers used nonces in IndexedDB.
//
//   1 fresh      the nonce matches a pending request of ours, and it hasn't expired
//   2 key        signed with the key we saved for this person
//   3 exact      clientData records this exact request and the decision the answer claims
//   4 address    made for this Pehchaan address (origin) by the Pehchaan app (type)
//   5 unlocked   user presence + user verification
//   6 signature  the signature over clientData verifies with the saved key
//   7 unused     this nonce was never used before
//
// A changed decision fails check 3 but passes check 6 (the signature still matches the
// original clientData) — exactly as the real verifier behaves.
import type { FamilyMember, SignedAnswer, VerdictResult, VerifierService, VerifyRequest } from "../types";
import type { PehchaanDB } from "@/store/db";
import { confirmationWordsFor } from "../words";
import { decideVerdict, finalizeVerdict, makeCheck } from "../verdict";
import { parseClientData, simSignature } from "./simSign";

export function createSimVerifier(db: PehchaanDB): VerifierService {
  return {
    async verify(req: VerifyRequest, ans: SignedAnswer, member: FamilyMember): Promise<VerdictResult> {
      const now = Date.now();
      const cd = parseClientData(ans.clientData);
      const pending = await db.outgoing.get(req.requestId);
      const name = member.label;
      const sentSeconds = Math.max(0, Math.round((now - req.createdAt) / 1000));

      // 1 · Fresh request
      const isPending = pending?.status === "pending" && pending.request?.nonce === req.nonce;
      const nonceMatches = ans.nonce === req.nonce;
      const expired = now > req.expiresAt;
      const c1 = makeCheck(1, isPending && nonceMatches && !expired, {
        detail: !isPending ? "no_pending" : !nonceMatches ? "nonce_mismatch" : "expired",
        params: { n: sentSeconds },
      });

      // 2 · Signed with {name}'s key
      const c2 = makeCheck(2, Boolean(member.keyId) && ans.keyId === member.keyId, {
        detail: "unknown_key",
        params: { name },
      });

      // 3 · Answer matches this exact request (and decision)
      const exact =
        cd !== null &&
        cd.requestId === req.requestId &&
        cd.nonce === req.nonce &&
        ans.requestId === req.requestId &&
        ans.nonce === req.nonce &&
        cd.decision === ans.decision;
      const c3 = makeCheck(3, exact, { detail: "mismatch" });

      // 4 · Made for this Pehchaan address
      const c4 = makeCheck(4, cd !== null && cd.origin === location.origin && cd.type === "answer", {
        detail: "wrong_origin",
      });

      // 5 · {name} unlocked their phone
      const c5 = makeCheck(5, ans.userPresent === true && ans.userVerified === true, {
        detail: "not_verified",
        params: { name },
      });

      // 6 · Signature is genuine (verified with the key saved for this person)
      let sigOk = false;
      if (cd && member.keyId) {
        sigOk = (await simSignature(member.keyId, cd)) === ans.signature;
      }
      const c6 = makeCheck(6, sigOk, { detail: "bad" });

      // 7 · This answer wasn't used before
      const used = await db.usedNonces.get(ans.nonce);
      const c7 = makeCheck(7, !used, { detail: "used" });
      await db.usedNonces.put({ nonce: ans.nonce, at: now });

      const checks = [c1, c2, c3, c4, c5, c6, c7];
      const decision = cd?.decision ?? ans.decision;
      const { verdict, invalidReason } = decideVerdict(checks, ans.decision, expired && nonceMatches && isPending);

      const result: VerdictResult = {
        requestId: req.requestId,
        verdict,
        checks,
        memberId: member.id,
        memberLabel: member.label,
        elapsedMs: now - req.createdAt,
        decidedAt: now,
        answeredAt: ans.answeredAt,
      };
      if (invalidReason) result.invalidReason = invalidReason;
      if (req.reason) result.reason = req.reason;
      if (req.amountInr) result.amountInr = req.amountInr;
      if (verdict === "VERIFIED" && decision === "ME") {
        result.confirmationWords = await confirmationWordsFor(ans);
      }
      return finalizeVerdict(result);
    },

    async resetUsedNonces() {
      await db.usedNonces.clear();
    },
  };
}
