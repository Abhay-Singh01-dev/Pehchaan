// The verifier's remaining branches (the 10.5 table itself is in verifier.table.test.ts, written
// independently from the spec), plus C-10.6a: verifier.ts stays short and commented, one comment per check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64url, b64urlDecode, utf8 } from "../src/bytes";
import { challengeFor } from "../src/canonical";
import { rawToDer } from "../src/der";
import { softAssert } from "../src/soft-authenticator";
import { PRIORITY, verifyAnswer } from "../src/verifier";
import { failedOf, genuine, ORIGIN, RP_ID } from "./verifier-fixture";

describe("verifier · reading clientDataJSON and authenticatorData", () => {
  it("JSON that isn't an object (array, null, number, string) fails 3, 4 and 6", async () => {
    const f = await genuine("ME");
    for (const json of ["[1]", "null", "5", '"x"']) {
      const r = await verifyAnswer(f.input({ ans: { ...f.ans, clientDataJSON: b64url(utf8(json)) } }));
      expect(r.verdict, json).toBe("INVALID");
      expect(failedOf(r), json).toEqual([3, 4, 6]);
    }
  });

  it("clientDataJSON that isn't valid UTF-8 fails like malformed JSON", async () => {
    const f = await genuine("ME");
    const r = await verifyAnswer(
      f.input({ ans: { ...f.ans, clientDataJSON: b64url(new Uint8Array([0xff, 0xfe, 0x7b])) } }),
    );
    expect(failedOf(r)).toEqual([3, 4, 6]);
  });

  it("authenticatorData that isn't base64url fails 4, 5 and 6", async () => {
    const f = await genuine("ME");
    const r = await verifyAnswer(f.input({ ans: { ...f.ans, authenticatorData: "*" } }));
    expect(failedOf(r)).toEqual([4, 5, 6]);
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_app" });
  });

  it("a passkey public key on the card that won't import fails check 6 only", async () => {
    const f = await genuine("ME");
    const r = await verifyAnswer(f.input({ member: { ...f.input().member, passkeyPub: b64url(new Uint8Array(65)) } }));
    expect(failedOf(r)).toEqual([6]);
    expect(r).toMatchObject({ invalidReason: "bad_signature" });
  });

  it("UV without UP fails check 5", async () => {
    const f = await genuine("ME", { flags: 0x04 });
    const r = await verifyAnswer(f.input());
    expect(failedOf(r)).toEqual([5]);
    expect(r).toMatchObject({ invalidReason: "not_unlocked" });
  });

  it("an assertion made with the wrong rpId fails check 4", async () => {
    const f = await genuine("ME", { rpId: "app.yourdomain.in.evil.test" });
    expect(failedOf(await verifyAnswer(f.input()))).toEqual([4]);
  });

  it("uses the answer's own signature bytes: a valid signature over other data fails 6", async () => {
    const f = await genuine("ME");
    const other = await softAssert({
      privateKey: f.cred.privateKey,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: await challengeFor(f.req, "NOT_ME"),
    });
    const r = await verifyAnswer(f.input({ ans: { ...f.ans, signature: other.signature } }));
    expect(failedOf(r)).toEqual([6]);
  });

  it("a DER signature with r and s swapped fails 6", async () => {
    const f = await genuine("ME");
    const der = b64urlDecode(f.ans.signature);
    // Rebuild raw r‖s from the DER, swap the halves, re-encode.
    const { derToRaw } = await import("../src/der");
    const raw = derToRaw(der);
    const swapped = new Uint8Array(64);
    swapped.set(raw.subarray(32), 0);
    swapped.set(raw.subarray(0, 32), 32);
    const r = await verifyAnswer(f.input({ ans: { ...f.ans, signature: b64url(rawToDer(swapped)) } }));
    expect(failedOf(r)).toEqual([6]);
  });
});

describe("verifier · verdicts", () => {
  it("VERIFIED only when all 7 pass and the decision is ME; DENIED for NOT_ME", async () => {
    const yes = await verifyAnswer((await genuine("ME")).input());
    expect(yes).toEqual({ verdict: "VERIFIED", checks: expect.any(Array) });
    expect(yes.checks.map((c) => c.key)).toEqual([
      "fresh",
      "key",
      "exact",
      "address",
      "unlocked",
      "signature",
      "unused",
    ]);
    const no = await verifyAnswer((await genuine("NOT_ME")).input());
    expect(no.verdict).toBe("DENIED");
    expect(no).not.toHaveProperty("late");
  });

  it("late: only time failed → DENIED (late) for NOT ME, NO_RESPONSE (late) for YES", async () => {
    const f = await genuine("NOT_ME");
    expect(await verifyAnswer(f.input({ receivedAt: f.req.expiresAt + 9000 }))).toMatchObject({
      verdict: "DENIED",
      late: true,
    });
    const y = await genuine("ME");
    expect(await verifyAnswer(y.input({ receivedAt: y.req.expiresAt + 9000 }))).toMatchObject({
      verdict: "NO_RESPONSE",
      noResponseReason: "late",
    });
  });

  it("late AND another failure → INVALID (the late policy needs everything else to pass)", async () => {
    const f = await genuine("NOT_ME");
    const r = await verifyAnswer(f.input({ receivedAt: f.req.expiresAt + 9000, envFrom: "someone-else-xxxxxxxxx" }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_key" });
  });

  it("only time failed but the check-1 failure was a different request → reused", async () => {
    const f = await genuine("ME");
    const r = await verifyAnswer(f.input({ ans: { ...f.ans, requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E3G" } }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "reused" });
    expect(failedOf(r)).toEqual([1]);
  });

  it("expired is the lowest-priority reason", () => {
    expect(PRIORITY).toEqual([
      "reused",
      "wrong_key",
      "wrong_app",
      "changed",
      "not_unlocked",
      "bad_signature",
      "expired",
    ]);
  });

  it("a timed-out answer that is also bad in another way reports the other reason first", async () => {
    const f = await genuine("ME", { flags: 0x01 });
    const r = await verifyAnswer(f.input({ receivedAt: f.req.expiresAt + 1 }));
    expect(failedOf(r)).toEqual([1, 5]);
    expect(r).toMatchObject({ invalidReason: "not_unlocked" });
  });

  it("lateness alone is never INVALID: the late policy applies, and any other failure outranks 'expired'", async () => {
    const f = await genuine("NOT_ME");
    const r = await verifyAnswer(f.input({ receivedAt: f.req.expiresAt + 1 }));
    expect(r.verdict).not.toBe("INVALID");
  });
});

describe("C-10.6a · verifier.ts stays readable (B5)", () => {
  const src = readFileSync(new URL("../src/verifier.ts", import.meta.url), "utf8");

  it("is under about 150 lines", () => {
    expect(src.split("\n").length).toBeLessThanOrEqual(150);
  });

  it("has one comment per check, in order", () => {
    const positions = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      src.indexOf(`// ${n} · ${["fresh", "key", "exact", "address", "unlocked", "signature", "unused"][n - 1]}`),
    );
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
