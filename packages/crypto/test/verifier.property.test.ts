// CRY-08: for any set of failed checks, the reason is the highest in the priority order.
// CRY-09: 10,000 random mutations of a valid answer; never VERIFIED unless the mutation changes nothing.
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { b64url, b64urlDecode, utf8 } from "../src/bytes";
import { challengeFor } from "../src/canonical";
import { softAnswer, softAssert } from "../src/soft-authenticator";
import type { InvalidReason, WireAnswer } from "../src/types";
import { PRIORITY, verifyAnswer, type VerifyInput } from "../src/verifier";
import { credential, failedOf, genuine, ORIGIN, PRIYA, request, RP_ID, type Fixture } from "./verifier-fixture";

// Each mutation breaks exactly one check, independently of the others.
const MUTATIONS = {
  late: 1, // received after expiresAt (same request)
  otherNonce: 1, // the answer's unsigned nonce field changed
  envFrom: 2, // the relay says it came from someone else
  credId: 2, // signed by a different credential ID than the card's
  flip: 3, // decision changed in transit
  origin: 4, // signed on a look-alike origin
  noUV: 5, // signed without user verification
  sig: 6, // a valid signature, but over other data
  used: 7, // the nonce was already used
} as const;
type Mutation = keyof typeof MUTATIONS;

async function build(muts: Set<Mutation>, decision: "ME" | "NOT_ME"): Promise<{ input: VerifyInput; ans: WireAnswer }> {
  const cred = await credential();
  const req = request();
  let ans = await softAnswer({
    req,
    decision,
    credId: cred.credId,
    privateKey: cred.privateKey,
    rpId: RP_ID,
    origin: muts.has("origin") ? "https://app.yourdomain.in.evil.test" : ORIGIN,
    flags: muts.has("noUV") ? 0x01 : 0x05,
    answeredAt: req.createdAt + 3000,
  });
  if (muts.has("flip")) ans = { ...ans, decision: decision === "ME" ? "NOT_ME" : "ME" };
  if (muts.has("otherNonce")) ans = { ...ans, nonce: b64url(new Uint8Array(32).fill(9)) };
  if (muts.has("sig")) {
    const other = await softAssert({
      privateKey: cred.privateKey,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: utf8("other"),
    });
    ans = { ...ans, signature: other.signature };
  }
  const input: VerifyInput = {
    req,
    ans,
    envFrom: muts.has("envFrom") ? PRIYA : req.toDeviceId,
    member: {
      deviceId: req.toDeviceId,
      credId: muts.has("credId") ? b64url(new Uint8Array(16).fill(1)) : cred.credId,
      passkeyPub: cred.publicKey,
    },
    expected: { origin: ORIGIN, rpId: RP_ID },
    receivedAt: muts.has("late") ? req.expiresAt + 9000 : req.createdAt + 5000,
    isNonceUsed: async () => muts.has("used"),
  };
  return { input, ans };
}

describe("CRY-08 · the reason is always the highest failed reason (property)", () => {
  it("holds for every combination of failures", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(Object.keys(MUTATIONS) as Mutation[]),
        fc.constantFrom("ME" as const, "NOT_ME" as const),
        async (list, decision) => {
          const muts = new Set(list);
          const { input } = await build(muts, decision);
          const r = await verifyAnswer(input);
          const expectedFailed = [...new Set(list.map((m) => MUTATIONS[m]))].sort();
          expect(failedOf(r)).toEqual(expectedFailed);

          if (expectedFailed.length === 0) {
            expect(r.verdict).toBe(decision === "ME" ? "VERIFIED" : "DENIED");
            return;
          }
          if (list.length === 1 && list[0] === "late") {
            expect(r.verdict).toBe(decision === "ME" ? "NO_RESPONSE" : "DENIED");
            return;
          }
          const reasons = new Set<InvalidReason>(
            list.map((m) =>
              m === "late"
                ? "expired"
                : m === "otherNonce"
                  ? "reused"
                  : (["", "", "wrong_key", "changed", "wrong_app", "not_unlocked", "bad_signature", "reused"][
                      MUTATIONS[m]
                    ] as InvalidReason),
            ),
          );
          const highest = PRIORITY.find((p) => reasons.has(p));
          expect(r).toMatchObject({ verdict: "INVALID", invalidReason: highest });
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("CRY-09 · mutations never produce VERIFIED (property)", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await genuine("ME");
  });

  // The fields the verifier reads. answeredAt and keyType are display-only and unsigned: they are not an input
  // of any check, so they're not mutation targets. (ECDSA's own (r, n−s) malleability is inherent and harmless:
  // it is still Arjun's key signing the same bytes; see confirm-words.test.ts.)
  const flipByte = (s: string, i: number, bit: number) => {
    const b = b64urlDecode(s);
    if (b.length === 0) return s + "A";
    b[i % b.length] = b[i % b.length]! ^ (1 << bit);
    return b64url(b);
  };

  const mutation = fc.oneof(
    fc.record({ field: fc.constant("authenticatorData" as const), i: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ field: fc.constant("clientDataJSON" as const), i: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ field: fc.constant("signature" as const), i: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
    fc.record({ field: fc.constantFrom("requestId" as const, "nonce" as const, "credId" as const), s: fc.string() }),
    fc.record({ field: fc.constant("decision" as const), s: fc.constantFrom("NOT_ME", "me", "ME ", "", "YES") }),
    fc.record({
      field: fc.constant("truncate" as const),
      which: fc.constantFrom("authenticatorData", "clientDataJSON", "signature"),
      n: fc.integer({ min: 1, max: 40 }),
    }),
    fc.record({ field: fc.constant("envFrom" as const), s: fc.string() }),
  );

  it("10,000 random single mutations of a valid answer", async () => {
    let verifiedUnchanged = 0;
    await fc.assert(
      fc.asyncProperty(mutation, async (m) => {
        let ans: WireAnswer = { ...f.ans };
        let envFrom = f.req.toDeviceId;
        if (m.field === "authenticatorData" || m.field === "clientDataJSON" || m.field === "signature") {
          ans = { ...ans, [m.field]: flipByte(ans[m.field], m.i, m.bit) };
        } else if (m.field === "truncate") {
          const v = ans[m.which];
          ans = { ...ans, [m.which]: v.slice(0, Math.max(0, v.length - m.n)) };
        } else if (m.field === "envFrom") {
          envFrom = m.s;
        } else if (m.field === "decision") {
          ans = { ...ans, decision: m.s as WireAnswer["decision"] };
        } else {
          ans = { ...ans, [m.field]: m.s };
        }
        const unchanged = JSON.stringify(ans) === JSON.stringify(f.ans) && envFrom === f.req.toDeviceId;
        const r = await verifyAnswer(f.input({ ans, envFrom }));
        if (unchanged) {
          verifiedUnchanged++;
          expect(r.verdict).toBe("VERIFIED");
        } else {
          expect(r.verdict).not.toBe("VERIFIED");
        }
      }),
      { numRuns: 10_000 },
    );
    expect(verifiedUnchanged).toBeLessThan(10_000);
  }, 120_000);

  it("the unmodified answer is VERIFIED (the property isn't vacuous)", async () => {
    expect((await verifyAnswer(f.input())).verdict).toBe("VERIFIED");
    expect(b64url(await challengeFor(f.req, "ME"))).toBeTruthy();
  });
});
