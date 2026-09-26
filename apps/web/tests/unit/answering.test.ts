// The answerer's controller (app/answering.ts; backend spec 8.6, 8.7, 10.4, FC-14, FC-15, FC-27; APP-09).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "@/services";
import { RelayError } from "@/services/errors";
import type { IncomingRequest, VerifyRequest, WireAnswer } from "@/services/types";
import { db, type IncomingRecord } from "@/store/db";
import { answerRequest, applyCancel, receiveRequest, sweepExpiredIncoming, type AnswerPhase } from "@/app/answering";

const ME = "arjun-device-000000000";
const MAA = "maa-device-00000000000";

function incoming(o: Partial<VerifyRequest> = {}, extra: Partial<IncomingRequest> = {}): IncomingRequest {
  const now = Date.now();
  const req: VerifyRequest = {
    requestId: `01J${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(23, "0")}`,
    nonce: "nonce",
    fromDeviceId: MAA,
    fromLabel: "Sunita",
    fromName: "Sunita",
    toDeviceId: ME,
    claimedLabel: "Arjun",
    channel: "call",
    createdAt: now,
    expiresAt: now + 60_000,
    ...o,
  };
  return { req, envFrom: MAA, ttlMs: 55_000, receivedAt: now, senderDevicePub: "dk", senderEncPub: "ek", ...extra };
}

const record = (id: string) => db.incoming.get(id) as Promise<IncomingRecord>;
const answer: WireAnswer = {
  requestId: "r",
  nonce: "n",
  decision: "NOT_ME",
  keyType: "pk",
  credId: "c",
  authenticatorData: "a",
  clientDataJSON: "b",
  signature: "s",
  answeredAt: 1,
};

beforeAll(() => {
  vi.spyOn(services.relay, "onState").mockImplementation((cb) => {
    cb("connected");
    return () => {};
  });
});

beforeEach(async () => {
  await Promise.all([db.incoming.clear(), db.history.clear()]);
});

describe("receiving a request (FC-27, FC-14)", () => {
  it("stores it with a deadline counted on THIS phone's clock from the relay's time left", async () => {
    const r = incoming({}, { ttlMs: 42_000 });
    expect(await receiveRequest(r, ME)).toBe(true);
    const rec = await record(r.req.requestId);
    expect(rec).toMatchObject({ status: "pending", envFrom: MAA, ttlMs: 42_000, localDeadline: r.receivedAt + 42_000 });
  });

  it("drops a request addressed to another device, or whose sender isn't the envelope's sender", async () => {
    expect(await receiveRequest(incoming({ toDeviceId: "someone-else-0000000000" }), ME)).toBe(false);
    expect(await receiveRequest(incoming({ fromDeviceId: "someone-else-0000000000" }), ME)).toBe(false);
    expect(await receiveRequest(incoming({}, { ttlMs: 0 }), ME)).toBe(false);
    expect(await db.incoming.count()).toBe(0);
  });

  it("opens in a second tab of this phone while pending, but not once it's answered", async () => {
    const r = incoming();
    expect(await receiveRequest(r, ME)).toBe(true);
    expect(await receiveRequest(r, ME)).toBe(true);
    await db.incoming.update(r.req.requestId, { status: "answered" });
    expect(await receiveRequest(r, ME)).toBe(false);
  });

  it("a wrong clock changes nothing: the asker's expiresAt is never compared with this phone's clock (8.7)", async () => {
    // Maa's clock says it expired 10 minutes ago; the relay says 55 s are left.
    const r = incoming({ createdAt: Date.now() - 11 * 60_000, expiresAt: Date.now() - 10 * 60_000 });
    expect(await receiveRequest(r, ME)).toBe(true);
    await sweepExpiredIncoming();
    expect((await record(r.req.requestId)).status).toBe("pending");
    // And when THIS phone's deadline passes, it expires.
    await db.incoming.update(r.req.requestId, { localDeadline: Date.now() - 1 });
    await sweepExpiredIncoming();
    expect((await record(r.req.requestId)).status).toBe("expired");
  });
});

describe("cancellation (FC-15)", () => {
  it("'Maa stopped waiting' closes it; a notice naming anyone else is ignored", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    await applyCancel({ requestId: r.req.requestId, reason: "asker_cancelled", from: "someone-else-0000000000" });
    expect((await record(r.req.requestId)).status).toBe("pending");
    await applyCancel({ requestId: r.req.requestId, reason: "asker_cancelled", from: MAA });
    expect(await record(r.req.requestId)).toMatchObject({ status: "cancelled", cancelReason: "asker_cancelled" });
  });

  it("answered on another device closes it too", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    await applyCancel({ requestId: r.req.requestId, reason: "answered_elsewhere", from: MAA });
    expect(await record(r.req.requestId)).toMatchObject({ status: "cancelled", cancelReason: "answered_elsewhere" });
  });
});

describe("answering (10.4, 8.6)", () => {
  it("starts the passkey prompt synchronously in the tap, before anything is awaited", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    const rec = await record(r.req.requestId);
    const sign = vi.spyOn(services.key, "signAnswer").mockResolvedValue(answer);
    vi.spyOn(services.relay, "sendAnswer").mockResolvedValue(undefined);
    const done = answerRequest(rec, "NOT_ME", () => {});
    expect(sign).toHaveBeenCalledWith(rec.request, "NOT_ME"); // before `done` has run a single await
    expect(await done).toBe("sent");
    // It goes back to whoever asked, with the keys that came with the request.
    expect(services.relay.sendAnswer).toHaveBeenCalledWith(answer, { deviceId: MAA, encPub: "ek", devicePub: "dk" });
    expect((await record(r.req.requestId)).status).toBe("answered");
  });

  it("a cancelled fingerprint prompt sends nothing (F5)", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    vi.spyOn(services.key, "signAnswer").mockRejectedValue(new Error("NotAllowedError"));
    const send = vi.spyOn(services.relay, "sendAnswer").mockResolvedValue(undefined);
    send.mockClear();
    expect(await answerRequest(await record(r.req.requestId), "ME", () => {})).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
    expect((await record(r.req.requestId)).status).toBe("pending");
  });

  it("if another device answered first, this one says so instead of pretending it was sent", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    vi.spyOn(services.key, "signAnswer").mockResolvedValue(answer);
    vi.spyOn(services.relay, "sendAnswer").mockRejectedValue(new RelayError("rejected", "already_answered"));
    const phases: AnswerPhase["kind"][] = [];
    expect(await answerRequest(await record(r.req.requestId), "ME", (p) => phases.push(p.kind))).toBe(
      "answered_elsewhere",
    );
    expect(phases.at(-1)).toBe("answered_elsewhere");
    expect(await record(r.req.requestId)).toMatchObject({ status: "cancelled", cancelReason: "answered_elsewhere" });
  });

  it("a request past the relay's grace is refused: F4", async () => {
    const r = incoming();
    await receiveRequest(r, ME);
    vi.spyOn(services.key, "signAnswer").mockResolvedValue(answer);
    vi.spyOn(services.relay, "sendAnswer").mockRejectedValue(new RelayError("rejected", "expired"));
    expect(await answerRequest(await record(r.req.requestId), "ME", () => {})).toBe("expired");
    expect((await record(r.req.requestId)).status).toBe("expired");
  });
});
