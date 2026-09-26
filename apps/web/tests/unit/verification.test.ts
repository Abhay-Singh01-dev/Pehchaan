// The asker's check controller (app/verification.ts; backend spec 10.5–10.9, 13.1, FC-12, FC-13; APP-06, APP-07).
// The relay transport is replaced by spies (answers are handed to the controller as the relay client would);
// the verifier, the WebCrypto signatures and the database are real.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSoftCredential, softAnswer, type SoftCredential } from "@pehchaan/crypto/soft-authenticator";
import { TIMING } from "@pehchaan/protocol";
import { services } from "@/services";
import { newIdentity } from "@/services/identity";
import { RelayError } from "@/services/errors";
import type { Decision, FamilyMember, IncomingAnswer, Receipt, VerifyRequest } from "@/services/types";
import { db, type OutgoingRecord } from "@/store/db";
import { useSession } from "@/app/session";
import {
  alertFamily,
  cancelCheck,
  finishNoResponse,
  installVerificationController,
  pruneUsedNonces,
  startCheck,
} from "@/app/verification";

let deliverAnswer: (a: IncomingAnswer) => void = () => {};
let deliverReceipt: (r: Receipt) => void = () => {};
let arjunKey: SoftCredential;
let arjun: FamilyMember;
let papa: FamilyMember;
let priya: FamilyMember;
const sendRequest = vi.fn<typeof services.relay.sendRequest>();
const cancelRequest = vi.fn<typeof services.relay.cancelRequest>();
const sendAlert = vi.fn<typeof services.relay.sendAlert>();

async function member(label: string, verifiable: boolean): Promise<FamilyMember> {
  const id = await newIdentity();
  const key = verifiable ? await createSoftCredential() : null;
  if (label === "Arjun" && key) arjunKey = key;
  return {
    v: 2,
    id: `m_${label}`,
    deviceId: id.deviceId,
    name: `${label} Sharma`,
    color: "indigo",
    canBeVerified: verifiable,
    devicePub: id.devicePub,
    encPub: id.encPub,
    grant: `${id.grantId}.${id.grantSecret}`,
    ...(key ? { keyType: "pk" as const, keyId: key.credId, publicKey: key.publicKey } : {}),
    createdAt: 1,
    safetyWords: ["ABLE", "BABY", "CABIN", "DANCE"],
    label,
    relation: "son",
    addedAt: 1,
    addedBy: "in_person",
  };
}

const outgoing = (id: string) => db.outgoing.get(id) as Promise<OutgoingRecord>;

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`condition not met: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Arjun's phone signs the request as it received it (same page address as this test's verifier expects). */
async function answerFrom(req: VerifyRequest, decision: Decision, receivedAt = Date.now()): Promise<IncomingAnswer> {
  const ans = await softAnswer({
    req,
    decision,
    credId: arjunKey.credId,
    privateKey: arjunKey.privateKey,
    rpId: "pehchaan.test",
    origin: "https://pehchaan.test",
  });
  return { ans, sealOk: true, envFrom: arjun.deviceId, re: req.requestId, receivedAt };
}

/** Makes a waiting check's request look older, as if it had been sent `ageMs` ago (its signed times too). */
async function age(requestId: string, ageMs: number): Promise<VerifyRequest> {
  const rec = await outgoing(requestId);
  const req = { ...rec.request!, createdAt: rec.request!.createdAt - ageMs, expiresAt: rec.request!.expiresAt - ageMs };
  await db.outgoing.update(requestId, { request: req });
  return req;
}

beforeAll(async () => {
  vi.spyOn(services.relay, "onAnswer").mockImplementation((cb) => {
    deliverAnswer = cb;
    return () => {};
  });
  vi.spyOn(services.relay, "onReceipt").mockImplementation((cb) => {
    deliverReceipt = cb;
    return () => {};
  });
  vi.spyOn(services.relay, "onState").mockImplementation((cb) => {
    cb("connected");
    return () => {};
  });
  vi.spyOn(services.relay, "sendRequest").mockImplementation(sendRequest);
  vi.spyOn(services.relay, "cancelRequest").mockImplementation(cancelRequest);
  vi.spyOn(services.relay, "sendAlert").mockImplementation(sendAlert);
  vi.spyOn(services.relay, "reportVerdict").mockImplementation(() => {});
  useSession.setState({ deviceId: "maa-device-00000000000" });
  installVerificationController();
});

beforeEach(async () => {
  await Promise.all([db.outgoing.clear(), db.usedNonces.clear(), db.history.clear(), db.family.clear()]);
  [arjun, papa, priya] = await Promise.all([member("Arjun", true), member("Papa", false), member("Priya", false)]);
  await db.family.bulkPut([arjun, papa, priya]);
  sendRequest.mockReset().mockResolvedValue(undefined);
  cancelRequest.mockReset().mockResolvedValue(undefined);
  sendAlert
    .mockReset()
    .mockImplementation(async (_a, to) =>
      to.map((r, i) => ({ deviceId: r.deviceId, msgId: `msg_${i}_${r.deviceId}` })),
    );
});

describe("verdicts (10.5)", () => {
  it("a genuine YES is VERIFIED, and the nonce is marked right after (10.9)", async () => {
    const id = await startCheck({ member: arjun, reason: "money", amountInr: 50000 });
    const rec = await outgoing(id);
    expect(sendRequest).toHaveBeenCalledWith(rec.request, {
      deviceId: arjun.deviceId,
      grant: arjun.grant,
      encPub: arjun.encPub,
      devicePub: arjun.devicePub,
    });
    deliverAnswer(await answerFrom(rec.request!, "ME"));
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.status === "done",
    );
    expect(done.result?.verdict).toBe("VERIFIED");
    expect(done.nonceMarked).toBe(true);
    expect(await db.usedNonces.get(rec.request!.nonce)).toMatchObject({ requestId: id });
    expect(await db.history.where("requestId").equals(id).count()).toBe(1);
  });

  it("only the first answer counts: a second one is ignored", async () => {
    const id = await startCheck({ member: arjun });
    const req = (await outgoing(id)).request!;
    deliverAnswer(await answerFrom(req, "NOT_ME"));
    await waitFor(
      () => outgoing(id),
      (r) => r.status === "done",
    );
    deliverAnswer(await answerFrom(req, "ME"));
    await new Promise((r) => setTimeout(r, 150));
    expect((await outgoing(id)).result?.verdict).toBe("DENIED");
  });

  it("an answer relayed from someone else's device is INVALID, never green", async () => {
    const id = await startCheck({ member: arjun });
    const req = (await outgoing(id)).request!;
    deliverAnswer({ ...(await answerFrom(req, "ME")), envFrom: priya.deviceId });
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.status === "done",
    );
    expect(done.result).toMatchObject({ verdict: "INVALID", invalidReason: "wrong_key" });
  });

  it("FC-13: a refusal (not_allowed) ends the check at once with its own reason", async () => {
    sendRequest.mockRejectedValue(new RelayError("not_allowed", "not_allowed"));
    const id = await startCheck({ member: arjun });
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.status === "done",
    );
    expect(done.result).toMatchObject({ verdict: "NO_RESPONSE", noResponseReason: "not_allowed" });
  });

  it("a DENIED alerts every other family member, one envelope each (13.1)", async () => {
    const id = await startCheck({ member: arjun });
    deliverAnswer(await answerFrom((await outgoing(id)).request!, "NOT_ME"));
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.alertStatus === "sent",
    );
    const [alert, to] = sendAlert.mock.calls[0]!;
    expect(alert).toMatchObject({ type: "impersonation", aboutDeviceId: arjun.deviceId, aboutLabel: "Arjun" });
    expect(to.map((r) => r.deviceId).sort()).toEqual([papa.deviceId, priya.deviceId].sort());
    expect(done.alerts?.map((a) => a.state)).toEqual(["sending", "sending"]);
  });
});

describe("the late window (10.7)", () => {
  it("after a timeout, the nonce waits until the 30 s window closes", async () => {
    const id = await startCheck({ member: arjun });
    await age(id, 60_000 + TIMING.ANSWER_GRACE_MS - 300); // the window closes in 300 ms
    await finishNoResponse(id, "timeout");
    expect((await outgoing(id)).nonceMarked).toBeFalsy();
    const marked = await waitFor(
      () => outgoing(id),
      (r) => r.nonceMarked === true,
      2000,
    );
    expect(marked.result?.noResponseReason).toBe("timeout");
  });

  it("a late NOT ME within the window turns the result DENIED (late); only the first late answer counts", async () => {
    const id = await startCheck({ member: arjun });
    const req = await age(id, 65_000); // 5 s past the deadline
    await finishNoResponse(id, "timeout");
    deliverAnswer(await answerFrom(req, "NOT_ME"));
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.result?.verdict === "DENIED",
    );
    expect(done.result?.late).toBe(true);
    expect(done.lateHandled).toBe(true);
    expect(done.nonceMarked).toBe(true);
    expect(await db.history.where("requestId").equals(id).count()).toBe(1);
    deliverAnswer(await answerFrom(req, "ME"));
    await new Promise((r) => setTimeout(r, 150));
    expect((await outgoing(id)).result?.verdict).toBe("DENIED");
  });

  it("a late YES stays 'Not confirmed yet' with the late reason: never green", async () => {
    const id = await startCheck({ member: arjun });
    const req = await age(id, 65_000);
    await finishNoResponse(id, "timeout");
    deliverAnswer(await answerFrom(req, "ME"));
    const done = await waitFor(
      () => outgoing(id),
      (r) => r.result?.noResponseReason === "late",
    );
    expect(done.result?.verdict).toBe("NO_RESPONSE");
    expect(done.result?.confirmationWords).toBeUndefined();
  });

  it("an answer after the window closed is ignored", async () => {
    const id = await startCheck({ member: arjun });
    const req = await age(id, 60_000 + TIMING.ANSWER_GRACE_MS + 1000);
    await finishNoResponse(id, "timeout");
    deliverAnswer(await answerFrom(req, "NOT_ME"));
    await new Promise((r) => setTimeout(r, 150));
    expect((await outgoing(id)).result?.noResponseReason).toBe("timeout");
  });
});

describe("cancel and the used-nonce store (10.9)", () => {
  it("cancelling marks the nonce at once and tells the relay", async () => {
    const id = await startCheck({ member: arjun });
    const req = (await outgoing(id)).request!;
    await cancelCheck(id);
    expect((await outgoing(id)).status).toBe("cancelled");
    expect(await db.usedNonces.get(req.nonce)).toBeDefined();
    expect(cancelRequest).toHaveBeenCalledWith(id);
  });

  it("keeps used nonces 30 days", async () => {
    const now = Date.now();
    await db.usedNonces.bulkPut([
      { nonce: "old", requestId: "r1", usedAt: now - TIMING.USED_NONCE_KEEP_MS - 1 },
      { nonce: "recent", requestId: "r2", usedAt: now - TIMING.USED_NONCE_KEEP_MS + 60_000 },
    ]);
    expect(await pruneUsedNonces(now)).toBe(1);
    expect((await db.usedNonces.toArray()).map((n) => n.nonce)).toEqual(["recent"]);
  });
});

describe("receipts (FC-12, 13.1)", () => {
  it("D3's status line only moves forward", async () => {
    const id = await startCheck({ member: arjun });
    deliverReceipt({ of: id, state: "seen" });
    await waitFor(
      () => outgoing(id),
      (r) => r.delivery === "seen",
    );
    deliverReceipt({ of: id, state: "delivered" });
    await new Promise((r) => setTimeout(r, 100));
    expect((await outgoing(id)).delivery).toBe("seen");
  });

  it("family-alert rows follow each recipient's receipts, even ones that arrive together or early", async () => {
    const id = await startCheck({ member: arjun });
    // A fast relay confirms the first recipient before the controller has recorded the message ids.
    sendAlert.mockImplementation(async (_a, to) => {
      const ids = to.map((r, i) => ({ deviceId: r.deviceId, msgId: `early_${i}` }));
      deliverReceipt({ of: "early_0", state: "delivered" });
      return ids;
    });
    await db.outgoing.update(id, { status: "done" });
    await alertFamily(id);
    await waitFor(
      () => outgoing(id),
      (r) => r.alerts?.[0]?.state === "delivered",
    );
    // Two receipts at once, for different recipients: neither update is lost.
    deliverReceipt({ of: "early_1", state: "queued" });
    deliverReceipt({ of: "early_0", state: "seen" });
    const rec = await waitFor(
      () => outgoing(id),
      (r) => r.alerts?.[0]?.state === "seen" && r.alerts?.[1]?.state === "queued",
    );
    expect(rec.alerts?.map((a) => a.state)).toEqual(["seen", "queued"]);
  });
});
