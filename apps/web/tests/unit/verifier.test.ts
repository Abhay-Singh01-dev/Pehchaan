// The app's verifier (backend spec 10.5–10.7, 9.4, FC-5) over the security core's 7 checks, with answers signed
// exactly as a passkey signs them (a software authenticator, real WebCrypto, nothing mocked). SimVerifier and
// RealVerifier are the same code expecting different addresses (D-008).
import { beforeEach, describe, expect, it } from "vitest";
import { b64url, b64urlDecode } from "@pehchaan/crypto/bytes";
import { createSoftCredential, softAnswer, type SoftCredential } from "@pehchaan/crypto/soft-authenticator";
import { db } from "@/store/db";
import { createSimVerifier } from "@/services/sim/SimVerifier";
import { createRealVerifier } from "@/services/real/RealVerifier";
import { createRequestFactory } from "@/services/requests";
import { newIdentity } from "@/services/identity";
import { assertMayPersist, failedChecks, isGreenAllowed, makeCheck } from "@/services/verdict";
import type { Decision, FamilyMember, IncomingAnswer, VerifyRequest, WireAnswer } from "@/services/types";

const ORIGIN = "https://pehchaan.test";
const RP_ID = "pehchaan.test";
const verifier = createSimVerifier(db);
const requests = createRequestFactory();

let arjunKey: SoftCredential;
let arjun: FamilyMember;

async function makeArjun(): Promise<FamilyMember> {
  const id = await newIdentity();
  arjunKey = await createSoftCredential();
  return {
    v: 2,
    id: "m_arjun",
    deviceId: id.deviceId,
    name: "Arjun Sharma",
    color: "indigo",
    canBeVerified: true,
    devicePub: id.devicePub,
    encPub: id.encPub,
    grant: `${id.grantId}.${id.grantSecret}`,
    keyType: "pk",
    keyId: arjunKey.credId,
    publicKey: arjunKey.publicKey,
    createdAt: 1,
    safetyWords: ["ABLE", "BABY", "CABIN", "DANCE"],
    label: "Arjun",
    relation: "son",
    addedAt: 1,
    addedBy: "in_person",
  };
}

function newRequest(): VerifyRequest {
  return requests.create({
    from: { deviceId: "maa-device-0000000000000", name: "Sunita" },
    member: arjun,
    reason: "money",
    amountInr: 50000,
  });
}

function sign(
  req: VerifyRequest,
  decision: Decision,
  o: { key?: SoftCredential; origin?: string; flags?: number } = {},
): Promise<WireAnswer> {
  const key = o.key ?? arjunKey;
  return softAnswer({
    req,
    decision,
    credId: key.credId,
    privateKey: key.privateKey,
    rpId: RP_ID,
    origin: o.origin ?? ORIGIN,
    ...(o.flags === undefined ? {} : { flags: o.flags }),
  });
}

/** As the relay delivers it: from Arjun's device, received now (or at `at`). */
const incoming = (
  req: VerifyRequest,
  ans: WireAnswer | undefined,
  o: Partial<IncomingAnswer> = {},
): IncomingAnswer => ({
  sealOk: ans !== undefined,
  envFrom: arjun.deviceId,
  re: req.requestId,
  receivedAt: Date.now(),
  ...(ans ? { ans } : {}),
  ...o,
});

const verify = (req: VerifyRequest, i: IncomingAnswer) => verifier.verify({ req, incoming: i, member: arjun });

beforeEach(async () => {
  await db.usedNonces.clear();
  arjun = await makeArjun();
});

describe("genuine answers", () => {
  it("YES with all 7 checks passing is VERIFIED, with confirmation words", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "ME")));
    expect(r.verdict).toBe("VERIFIED");
    expect(r.checks).toHaveLength(7);
    expect(r.checks.every((c) => c.passed && !c.skipped)).toBe(true);
    expect(r.confirmationWords).toEqual([expect.stringMatching(/^[A-Z]+$/), expect.stringMatching(/^[A-Z]+$/)]);
    expect(r).toMatchObject({ memberLabel: "Arjun", reason: "money", amountInr: 50000 });
    expect(() => assertMayPersist(r)).not.toThrow();
  });

  it("the confirmation words are the ones Arjun's phone shows (10.8)", async () => {
    const req = newRequest();
    const ans = await sign(req, "ME");
    const r = await verify(req, incoming(req, ans));
    expect(r.confirmationWords).toEqual(await requests.confirmationWords(ans));
  });

  it("NOT ME with all 7 checks passing is DENIED, without words", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "NOT_ME")));
    expect(r.verdict).toBe("DENIED");
    expect(failedChecks(r.checks)).toEqual([]);
    expect(r.confirmationWords).toBeUndefined();
  });

  it("times the answer by THIS phone's receive time, never by the answerer's clock (8.7)", async () => {
    const req = newRequest();
    const skewed = { ...(await sign(req, "ME")), answeredAt: Date.now() + 7 * 60_000 };
    const receivedAt = Date.now();
    const r = await verify(req, incoming(req, skewed, { receivedAt }));
    expect(r.verdict).toBe("VERIFIED");
    expect(r.answeredAt).toBe(receivedAt);
    expect(r.decidedAt).toBe(receivedAt);
  });

  it("never marks the nonce used itself: the controller does, at the right moment (10.9)", async () => {
    const req = newRequest();
    await verify(req, incoming(req, await sign(req, "ME")));
    expect(await db.usedNonces.count()).toBe(0);
  });
});

describe("every INVALID reason (the 10.5 table)", () => {
  it("changed: NOT ME flipped to ME in transit fails check 3 only", async () => {
    const req = newRequest();
    const genuine = await sign(req, "NOT_ME");
    const r = await verify(req, incoming(req, { ...genuine, decision: "ME" }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "changed" });
    expect(failedChecks(r.checks)).toEqual([3]);
  });

  it("changed: an envelope that couldn't be opened fails check 3; the rest are not checked (9.4)", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, undefined));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "changed" });
    expect(failedChecks(r.checks)).toEqual([3]);
    expect(r.checks.filter((c) => c.skipped).map((c) => c.n)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(r.checks.find((c) => c.n === 3)?.detail).toBe("sealed_changed");
    expect(isGreenAllowed(r)).toBe(false);
  });

  it("reused: Arjun's old YES replayed for a new request fails checks 1, 3 and 7", async () => {
    const oldReq = newRequest();
    const old = await sign(oldReq, "ME");
    await db.usedNonces.put({ nonce: oldReq.nonce, requestId: oldReq.requestId, usedAt: Date.now() });
    const req = newRequest();
    const r = await verify(req, incoming(req, { ...old, requestId: req.requestId }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "reused" });
    expect(failedChecks(r.checks)).toEqual([1, 3, 7]);
  });

  it("reused: the same answer after its nonce was used fails check 7", async () => {
    const req = newRequest();
    const ans = await sign(req, "ME");
    await db.usedNonces.put({ nonce: req.nonce, requestId: req.requestId, usedAt: Date.now() });
    const r = await verify(req, incoming(req, ans));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "reused" });
    expect(failedChecks(r.checks)).toEqual([7]);
  });

  it("wrong_key: a YES forged with the attacker's own key fails checks 2 and 6", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "ME", { key: await createSoftCredential() })));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_key" });
    expect(failedChecks(r.checks)).toEqual([2, 6]);
  });

  it("wrong_key: a genuine answer relayed from a device other than Arjun's fails check 2", async () => {
    const req = newRequest();
    const other = await newIdentity();
    const r = await verify(req, incoming(req, await sign(req, "ME"), { envFrom: other.deviceId }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_key" });
    expect(failedChecks(r.checks)).toEqual([2]);
  });

  it("wrong_app: signed on a look-alike website fails check 4", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "ME", { origin: "https://pehchaan-help.example" })));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_app" });
    expect(failedChecks(r.checks)).toEqual([4]);
  });

  it("not_unlocked: signed without a fingerprint or PIN fails check 5", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "ME", { flags: 0x01 })));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "not_unlocked" });
    expect(failedChecks(r.checks)).toEqual([5]);
  });

  it("bad_signature: the UV bit set in transit fails check 6", async () => {
    const req = newRequest();
    const ans = await sign(req, "ME", { flags: 0x01 });
    const ad = b64urlDecode(ans.authenticatorData);
    ad[32] = 0x05;
    const r = await verify(req, incoming(req, { ...ans, authenticatorData: b64url(ad) }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "bad_signature" });
    expect(failedChecks(r.checks)).toEqual([6]);
  });
});

describe("the late-answer policy (10.7)", () => {
  it("a genuine YES after the timer is NO_RESPONSE `late`, never green", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "ME"), { receivedAt: req.expiresAt + 9000 }));
    expect(r).toMatchObject({ verdict: "NO_RESPONSE", noResponseReason: "late" });
    expect(r.checks.find((c) => c.n === 1)).toMatchObject({ passed: false, detail: "late" });
    expect(r.confirmationWords).toBeUndefined();
  });

  it("a genuine NOT ME after the timer is still DENIED, marked late", async () => {
    const req = newRequest();
    const r = await verify(req, incoming(req, await sign(req, "NOT_ME"), { receivedAt: req.expiresAt + 9000 }));
    expect(r).toMatchObject({ verdict: "DENIED", late: true });
  });

  it("a late answer that fails anything else is INVALID", async () => {
    const req = newRequest();
    const genuine = await sign(req, "NOT_ME");
    const r = await verify(req, incoming(req, { ...genuine, decision: "ME" }, { receivedAt: req.expiresAt + 9000 }));
    expect(r).toMatchObject({ verdict: "INVALID", invalidReason: "changed" });
  });
});

describe("the green guard (B9 #1)", () => {
  it("never returns VERIFIED for a tampered answer", async () => {
    const req = newRequest();
    const genuine = await sign(req, "NOT_ME");
    const attempts: IncomingAnswer[] = [
      incoming(req, { ...genuine, decision: "ME" }),
      incoming(req, await sign(req, "ME", { key: await createSoftCredential() })),
      incoming(req, await sign(req, "ME", { flags: 0x00 })),
      incoming(req, { ...(await sign(req, "ME")), clientDataJSON: b64url(new TextEncoder().encode("{}")) }),
      incoming(req, undefined),
    ];
    for (const a of attempts) expect((await verify(req, a)).verdict).not.toBe("VERIFIED");
  });

  it("refuses to store a VERIFIED result the verifier didn't produce", () => {
    const fabricated = {
      requestId: "x",
      verdict: "VERIFIED" as const,
      checks: ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => makeCheck(n, true)),
      memberLabel: "Arjun",
      decidedAt: Date.now(),
    };
    expect(() => assertMayPersist(fabricated)).toThrow();
  });

  it("RealVerifier runs the same checks against the configured address", async () => {
    const real = createRealVerifier(db);
    const req = newRequest();
    const ok = await real.verify({ req, incoming: incoming(req, await sign(req, "ME")), member: arjun });
    expect(ok.verdict).toBe("VERIFIED");
    const elsewhere = await sign(req, "ME", { origin: "https://pehchaan.test.evil.example" });
    const bad = await real.verify({ req, incoming: incoming(req, elsewhere), member: arjun });
    expect(bad).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_app" });
  });
});
