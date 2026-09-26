// The app's VerifierService (backend spec 10.5–10.7, 9.4, FC-5): runs the security core's 7 checks and turns
// the result into what the screens show. There is ONE verifier: the simulated and the real services differ
// only in where the expected origin and rpId come from (D-008).
//
// It never marks the nonce used: the verification controller does that at the right moment (10.5): right after
// a verdict or a cancel, but after a timeout only when the 30 s late window closes.
import { verifyAnswer } from "@pehchaan/crypto/verifier";
import { confirmationWordsFor } from "@pehchaan/crypto/confirm-words";
import type { PehchaanDB } from "@/store/db";
import type { CheckResult, VerdictResult, VerifierService } from "./types";
import { finalizeVerdict, makeCheck, type CheckFailDetail } from "./verdict";

export interface ExpectedAddress {
  origin: string;
  rpId: string;
}

const DETAIL: Record<number, CheckFailDetail> = {
  2: "unknown_key",
  3: "mismatch",
  4: "wrong_origin",
  5: "not_verified",
  6: "bad",
  7: "used",
};

export function createVerifier(db: PehchaanDB, expected: () => ExpectedAddress): VerifierService {
  return {
    async verify({ req, incoming, member }): Promise<VerdictResult> {
      const base = {
        requestId: req.requestId,
        memberId: member.id,
        memberLabel: member.label,
        elapsedMs: Math.max(0, incoming.receivedAt - req.createdAt),
        decidedAt: incoming.receivedAt,
        ...(req.reason ? { reason: req.reason } : {}),
        ...(req.amountInr ? { amountInr: req.amountInr } : {}),
      };
      const name = member.label;

      // 9.4: the answer couldn't be opened or read, so the verifier can't run. INVALID `changed`: check 3
      // failed ("changed on the way"); the rest were not checked.
      if (!incoming.sealOk || !incoming.ans) {
        const checks: CheckResult[] = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) =>
          n === 3 ? makeCheck(3, false, { detail: "sealed_changed" }) : makeCheck(n, false, { skipped: true }),
        );
        return finalizeVerdict({ ...base, verdict: "INVALID", invalidReason: "changed", checks });
      }

      const ans = incoming.ans;
      const r = await verifyAnswer({
        req,
        ans,
        envFrom: incoming.envFrom,
        member: { deviceId: member.deviceId, credId: member.keyId ?? "", passkeyPub: member.publicKey ?? "" },
        expected: expected(),
        receivedAt: incoming.receivedAt,
        isNonceUsed: async (nonce) => Boolean(await db.usedNonces.get(nonce)),
      });

      const sameRequest = ans.requestId === req.requestId && ans.nonce === req.nonce;
      const late = r.verdict === "NO_RESPONSE" || (r.verdict === "DENIED" && r.late === true);
      const checks: CheckResult[] = r.checks.map((c) => {
        if (c.n === 1) {
          const n = Math.max(0, Math.round((incoming.receivedAt - req.createdAt) / 1000));
          const detail: CheckFailDetail | undefined = late
            ? "late"
            : !c.passed
              ? sameRequest
                ? "expired"
                : "nonce_mismatch"
              : undefined;
          return makeCheck(1, c.passed, { params: { n }, ...(detail ? { detail } : {}) });
        }
        const params = c.n === 2 || c.n === 5 || c.n === 6 ? { name } : undefined;
        return makeCheck(c.n, c.passed, { detail: DETAIL[c.n], ...(params ? { params } : {}) });
      });

      // "Arjun's key · 4 s ago" is timed by when THIS phone received the answer. `ans.answeredAt` is the other
      // phone's clock, which may be minutes off, and is never compared with this one (8.7).
      const result: VerdictResult = { ...base, verdict: r.verdict, checks, answeredAt: incoming.receivedAt };
      if (r.verdict === "INVALID") result.invalidReason = r.invalidReason;
      if (r.verdict === "NO_RESPONSE") result.noResponseReason = "late";
      if (r.verdict === "DENIED" && r.late) result.late = true;
      if (r.verdict === "VERIFIED") result.confirmationWords = await confirmationWordsFor(ans);
      return finalizeVerdict(result);
    },

    async resetUsedNonces() {
      await db.usedNonces.clear();
    },
  };
}
