// The 7 checks (spec B4) and every INVALID reason, run against the simulated verifier.
// The same expectations apply to the team's RealVerifier (Part E).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/store/db";
import { createSimVerifier } from "@/services/sim/SimVerifier";
import { makeSignedAnswer } from "@/services/sim/simSign";
import { createRequestFactory } from "@/services/requests";
import { assertMayPersist, decideVerdict, failedChecks, makeCheck } from "@/services/verdict";
import type { FamilyMember, SignedAnswer, VerifyRequest } from "@/services/types";

const verifier = createSimVerifier(db);
const requests = createRequestFactory();

const arjun: FamilyMember = {
  v: 1,
  id: "m_arjun",
  deviceId: "sim-arjun",
  name: "Arjun Sharma",
  color: "indigo",
  canBeVerified: true,
  keyId: "key_arjun_test",
  publicKey: "pk_test",
  safetyWords: ["TIGER", "MANGO", "RIVER", "LAMP"],
  label: "Arjun",
  relation: "son",
  addedAt: 0,
  addedBy: "in_person",
};

async function pendingRequest(): Promise<VerifyRequest> {
  const req = requests.create({
    from: { deviceId: "sim-maa", name: "Sunita" },
    member: arjun,
    reason: "money",
    amountInr: 50000,
  });
  await db.outgoing.put({
    requestId: req.requestId,
    request: req,
    memberId: arjun.id,
    memberDeviceId: arjun.deviceId,
    memberLabel: arjun.label,
    status: "pending",
    createdAt: req.createdAt,
  });
  return req;
}

const sign = (req: Pick<VerifyRequest, "requestId" | "nonce">, decision: "ME" | "NOT_ME", keyId = arjun.keyId!) =>
  makeSignedAnswer({ keyId, req, decision, fromDeviceId: arjun.deviceId });

const failed = (r: { checks: { n: number; passed: boolean }[] }) => failedChecks(r.checks as never);

beforeEach(async () => {
  await Promise.all([db.outgoing.clear(), db.usedNonces.clear()]);
});

describe("genuine answers", () => {
  it("YES with all 7 checks passing is VERIFIED, with confirmation words", async () => {
    const req = await pendingRequest();
    const r = await verifier.verify(req, await sign(req, "ME"), arjun);
    expect(r.verdict).toBe("VERIFIED");
    expect(r.checks).toHaveLength(7);
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.confirmationWords).toHaveLength(2);
    expect(() => assertMayPersist(r)).not.toThrow();
  });

  it("NOT ME with all 7 checks passing is DENIED (a genuine 'not me')", async () => {
    const req = await pendingRequest();
    const r = await verifier.verify(req, await sign(req, "NOT_ME"), arjun);
    expect(r.verdict).toBe("DENIED");
    expect(failed(r)).toEqual([]);
    expect(r.confirmationWords).toBeUndefined();
  });
});

describe("every INVALID reason", () => {
  it("changed: a flipped decision fails check 3 but passes check 6", async () => {
    const req = await pendingRequest();
    const genuine = await sign(req, "NOT_ME");
    const r = await verifier.verify(req, { ...genuine, decision: "ME" }, arjun);
    expect(r.verdict).toBe("INVALID");
    expect(r.invalidReason).toBe("changed");
    expect(failed(r)).toEqual([3]);
    expect(r.checks.find((c) => c.n === 6)?.passed).toBe(true);
  });

  it("reused: an old genuine YES re-sent for a new request", async () => {
    const oldReq = await pendingRequest();
    const oldAnswer = await sign(oldReq, "ME");
    expect((await verifier.verify(oldReq, oldAnswer, arjun)).verdict).toBe("VERIFIED");
    const req = await pendingRequest();
    const replayed: SignedAnswer = { ...oldAnswer, requestId: req.requestId };
    const r = await verifier.verify(req, replayed, arjun);
    expect(r.verdict).toBe("INVALID");
    expect(r.invalidReason).toBe("reused");
    expect(failed(r)).toEqual(expect.arrayContaining([1, 3, 7]));
  });

  it("reused: the same answer verified twice fails check 7 the second time", async () => {
    const req = await pendingRequest();
    const ans = await sign(req, "ME");
    await verifier.verify(req, ans, arjun);
    const r = await verifier.verify(req, ans, arjun);
    expect(r.verdict).toBe("INVALID");
    expect(r.checks.find((c) => c.n === 7)?.passed).toBe(false);
  });

  it("wrong_key: a YES signed with the attacker's own key", async () => {
    const req = await pendingRequest();
    const r = await verifier.verify(req, await sign(req, "ME", "key_attacker_x"), arjun);
    expect(r.verdict).toBe("INVALID");
    expect(r.invalidReason).toBe("wrong_key");
    expect(failed(r)).toEqual([2, 6]);
  });

  it("wrong_app: signed for a different website", async () => {
    const req = await pendingRequest();
    const ans = await makeSignedAnswer({
      keyId: arjun.keyId!,
      req,
      decision: "ME",
      fromDeviceId: arjun.deviceId,
      origin: "https://evil.example",
    });
    const r = await verifier.verify(req, ans, arjun);
    expect(r.invalidReason).toBe("wrong_app");
    expect(failed(r)).toEqual([4]);
  });

  it("not_unlocked: user verification missing", async () => {
    const req = await pendingRequest();
    const ans = { ...(await sign(req, "ME")), userVerified: false };
    const r = await verifier.verify(req, ans, arjun);
    expect(r.invalidReason).toBe("not_unlocked");
    expect(failed(r)).toEqual([5]);
  });

  it("bad_signature: the signature doesn't verify", async () => {
    const req = await pendingRequest();
    const ans = { ...(await sign(req, "ME")), signature: "00".repeat(32) };
    const r = await verifier.verify(req, ans, arjun);
    expect(r.invalidReason).toBe("bad_signature");
    expect(failed(r)).toEqual([6]);
  });

  it("expired: the answer arrives after the request's 60 s", async () => {
    const req = await pendingRequest();
    const late = { ...req, expiresAt: Date.now() - 1 };
    const r = await verifier.verify(late, await sign(req, "ME"), arjun);
    expect(r.invalidReason).toBe("expired");
    expect(failed(r)).toContain(1);
  });
});

describe("the green guard (B9 #1)", () => {
  it("never returns VERIFIED for a tampered answer", async () => {
    const req = await pendingRequest();
    const genuine = await sign(req, "NOT_ME");
    const attempts: SignedAnswer[] = [
      { ...genuine, decision: "ME" },
      await sign(req, "ME", "key_attacker"),
      { ...(await sign(req, "ME")), userPresent: false },
      { ...(await sign(req, "ME")), clientData: "{}" },
    ];
    for (const a of attempts) {
      await db.usedNonces.clear();
      expect((await verifier.verify(req, a, arjun)).verdict).not.toBe("VERIFIED");
    }
  });

  it("refuses to store a VERIFIED result the verifier didn't produce", () => {
    const fabricated = {
      requestId: "x",
      verdict: "VERIFIED" as const,
      checks: [1, 2, 3, 4, 5, 6, 7].map((n) => makeCheck(n as 1, true)),
      memberLabel: "Arjun",
      decidedAt: Date.now(),
    };
    expect(() => assertMayPersist(fabricated)).toThrow();
  });

  it("maps checks to verdicts exactly as the spec's table", () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((n) => makeCheck(n as 1, true));
    expect(decideVerdict(all, "ME", false).verdict).toBe("VERIFIED");
    expect(decideVerdict(all, "NOT_ME", false).verdict).toBe("DENIED");
    const one = all.map((c) => (c.n === 4 ? makeCheck(4, false) : c));
    expect(decideVerdict(one, "ME", false)).toEqual({ verdict: "INVALID", invalidReason: "wrong_app" });
    expect(decideVerdict(all.slice(0, 6), "ME", false).verdict).toBe("INVALID");
  });
});
