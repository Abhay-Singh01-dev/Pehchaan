// RealRelay, the app's relay client (backend spec 7–9, 8.4–8.10, FC-6, FC-7, FC-27; APP-08), against a scripted
// relay (helpers/fake-relay.ts). Every envelope is really sealed and opened, every login really signed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { b64url, b64urlDecode, sha256 } from "@pehchaan/crypto/bytes";
import { ulid } from "@pehchaan/protocol";
import { RealRelay } from "@/services/real/relay/RealRelay";
import { alertPayload, answerPayload, requestPayload, wrap } from "@/services/real/relay/envelope";
import { backoffMs } from "@/services/real/relay/socket";
import { RelayError } from "@/services/errors";
import { newIdentity } from "@/services/identity";
import { createRequestFactory } from "@/services/requests";
import { db, type IdentityRow } from "@/store/db";
import type {
  CancelNotice,
  FamilyAlert,
  FamilyMember,
  IncomingAnswer,
  IncomingRequest,
  Receipt,
  VerifyRequest,
} from "@/services/types";
import { FakeRelay, RELAY_HOST, until } from "./helpers/fake-relay";

const requests = createRequestFactory();
let relay: FakeRelay;
let me: IdentityRow;
let maa: IdentityRow;
let client: RealRelay;
const members = new Map<string, FamilyMember>();

function makeClient(): RealRelay {
  return new RealRelay({
    db,
    identity: async () => me,
    lookupMember: async (d) => members.get(d),
    rotateLocalGrant: async () => {
      me = {
        ...me,
        grantId: b64url(crypto.getRandomValues(new Uint8Array(8))),
        grantSecret: b64url(crypto.getRandomValues(new Uint8Array(16))),
      };
      return me;
    },
    url: "wss://relay.pehchaan.test/v1/ws",
    relayHost: RELAY_HOST,
    WebSocketImpl: relay.Impl,
  });
}

async function connected(c: RealRelay = client) {
  c.connect(me.deviceId);
  await until(() => c.getState() === "connected");
}

/** A request from Maa to me, sealed by Maa's device exactly as her phone would. */
async function requestFromMaa(o: { to?: string; fromDeviceId?: string; from?: string; plain?: boolean } = {}) {
  const member = { deviceId: me.deviceId, label: "Arjun" } as FamilyMember;
  const req: VerifyRequest = {
    ...requests.create({ from: { deviceId: o.fromDeviceId ?? maa.deviceId, name: "Sunita" }, member }),
    ...(o.to ? { toDeviceId: o.to } : {}),
  };
  const id = req.requestId;
  const from = o.from ?? maa.deviceId;
  const sealed = await wrap(
    requestPayload(req, maa),
    { kind: "verify.request", id, from, to: me.deviceId, re: id },
    maa,
    me.encPub,
    o.plain ? "plain" : "e2e",
  );
  return { req, id, body: { from, kind: "verify.request", re: id, ttlMs: 55_000, ...sealed } };
}

function collect<T>(subscribe: (cb: (v: T) => void) => unknown): T[] {
  const out: T[] = [];
  subscribe((v) => out.push(v));
  return out;
}

beforeEach(async () => {
  relay = new FakeRelay();
  [me, maa] = await Promise.all([newIdentity(), newIdentity()]);
  members.clear();
  await Promise.all([db.outbox.clear(), db.pushInbox.clear(), db.meta.clear()]);
  client = makeClient();
});

afterEach(() => client.disconnect());

describe("connecting (7.3, 8.9)", () => {
  it("logs in with a signature over this relay's host and one-time nonce, then shows Connected", async () => {
    await connected();
    expect(relay.loginFailures).toBe(0);
    const auth = relay.sent("auth")[0]!;
    expect(auth.body).toMatchObject({ deviceId: me.deviceId, devicePub: me.devicePub });
    expect(relay.last.protocols).toBe("pehchaan.v1");
  });

  it("re-registers its grant after every login: the SHA-256 of the secret, never the secret", async () => {
    await connected();
    await until(() => relay.sent("grant.set").length > 0);
    const hash = b64url(await sha256(b64urlDecode(me.grantSecret)));
    expect(relay.sent("grant.set")[0]!.body).toEqual({ grantId: me.grantId, hash, rotate: false });
    expect(JSON.stringify(relay.frames)).not.toContain(me.grantSecret);
  });

  it("keeps the relay's clock offset for display only (8.7)", async () => {
    relay.clockAheadMs = 120_000;
    await connected();
    expect(Math.abs(client.clockOffsetMs() - 120_000)).toBeLessThan(1000);
  });

  it("backs off 0.5, 1, 2, 4, 8 s, then every 8 s, each within ±30%", () => {
    const low = [0, 1, 2, 3, 4, 9].map((n) => backoffMs(n, () => 0));
    const high = [0, 1, 2, 3, 4, 9].map((n) => backoffMs(n, () => 1));
    expect(low).toEqual([350, 700, 1400, 2800, 5600, 5600]);
    expect(high).toEqual([650, 1300, 2600, 5200, 10_400, 10_400]);
  });

  it("stops and asks for an update when the relay says this version is too old (4426, FC-23)", async () => {
    const updates = collect<void>((cb) => client.onUpdateRequired(cb));
    await connected();
    const sockets = relay.sockets.length;
    relay.last.kill(4426);
    expect(updates).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1200));
    expect(relay.sockets.length).toBe(sockets);
  });
});

describe("sending (8.4)", () => {
  const card = () => ({
    deviceId: maa.deviceId,
    grant: `${maa.grantId}.${maa.grantSecret}`,
    encPub: maa.encPub,
    devicePub: maa.devicePub,
  });

  it("sends a request sealed end to end, with the request ID as the frame ID, and resolves on `accepted`", async () => {
    await connected();
    const req = requests.create({
      from: { deviceId: me.deviceId, name: "Arjun" },
      member: { deviceId: maa.deviceId, label: "Maa" } as FamilyMember,
    });
    await client.sendRequest(req, card());
    const f = relay.sent("send")[0]!;
    expect(f.id).toBe(req.requestId);
    expect(f.body).toMatchObject({ kind: "verify.request", to: maa.deviceId, re: req.requestId, grant: card().grant });
    expect(f.body.e2e).toBeDefined();
    expect(f.body.plain).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain("Arjun");
  });

  it("ends with not_allowed when the relay refuses: FC-13's line, not a network error", async () => {
    relay.reply = (s, f) => {
      if (f.t !== "send") return;
      s.push("error", { code: "not_allowed", of: f.id });
      return false;
    };
    await connected();
    const req = requests.create({
      from: { deviceId: me.deviceId, name: "Arjun" },
      member: { deviceId: maa.deviceId, label: "Maa" } as FamilyMember,
    });
    await expect(client.sendRequest(req, card())).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("without a receipt, re-sends with the SAME id every 2 s, and gives up waiting after 5 s", async () => {
    relay.reply = (_s, f) => (f.t === "send" ? false : undefined);
    await connected();
    const req = requests.create({
      from: { deviceId: me.deviceId, name: "Arjun" },
      member: { deviceId: maa.deviceId, label: "Maa" } as FamilyMember,
    });
    const started = Date.now();
    const err = await client.sendRequest(req, card()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).code).toBe("unreachable");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    const sends = relay.sent("send");
    expect(sends.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sends.map((s) => s.id))).toEqual(new Set([req.requestId]));
  }, 10_000);

  it("cancelling an unsent request stops re-sending it and tells the relay (8.6)", async () => {
    relay.reply = (_s, f) => (f.t === "send" ? false : undefined);
    await connected();
    const req = requests.create({
      from: { deviceId: me.deviceId, name: "Arjun" },
      member: { deviceId: maa.deviceId, label: "Maa" } as FamilyMember,
    });
    const pending = client.sendRequest(req, card()).catch((e: unknown) => e);
    await until(() => relay.sent("send").length === 1);
    await client.cancelRequest(req.requestId);
    expect(await pending).toBeInstanceOf(RelayError);
    expect(relay.sent("cancel")[0]!.body).toEqual({ re: req.requestId });
    await new Promise((r) => setTimeout(r, 2500));
    expect(relay.sent("send")).toHaveLength(1);
  }, 10_000);

  it("emits every receipt (D3's status line and the family-alert rows)", async () => {
    const receipts = collect<Receipt>((cb) => client.onReceipt(cb));
    await connected();
    relay.last.push("receipt", { of: ulid(), to: maa.deviceId, state: "delivered" });
    await until(() => receipts.some((r) => r.state === "delivered"));
  });

  it("ignores unknown fields in the relay's notices, so newer relays don't break older apps (7.6)", async () => {
    const receipts = collect<Receipt>((cb) => client.onReceipt(cb));
    await connected();
    const of = ulid();
    relay.last.push("receipt", { of, to: maa.deviceId, state: "seen", shippedNextYear: { anything: 1 } });
    relay.last.push("some.future.notice", { hello: true }); // an unknown type is ignored, not an error
    await until(() => receipts.some((r) => r.of === of));
    expect(receipts.find((r) => r.of === of)).toEqual({ of, to: maa.deviceId, state: "seen" });
    expect(client.getState()).toBe("connected");
  });

  it("'Reset my code' while offline is finished by the next login, with rotate: true", async () => {
    const grant = await client.rotateGrant();
    expect(grant).toBe(`${me.grantId}.${me.grantSecret}`);
    await connected();
    await until(() => relay.sent("grant.set").length > 0);
    expect(relay.sent("grant.set")[0]!.body).toMatchObject({ grantId: me.grantId, rotate: true });
    await until(() => relay.sent("grant.set").length > 0);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.meta.get("grant:rotatePending")).toBeUndefined();
  });
});

describe("receiving (8.3, 8.10, 9.4, 9.5, FC-27)", () => {
  it("acks at once by frame id, then opens the envelope and hands over the request", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const { req, id, body } = await requestFromMaa();
    relay.last.push("deliver", body, id);
    await until(() => got.length === 1);
    expect(relay.sent("ack")[0]!.body).toEqual({ of: id });
    expect(got[0]).toMatchObject({
      envFrom: maa.deviceId,
      ttlMs: 55_000,
      senderDevicePub: maa.devicePub,
      senderEncPub: maa.encPub,
    });
    expect(got[0]!.req).toMatchObject({ requestId: req.requestId, nonce: req.nonce, fromName: "Sunita" });
  });

  it("drops duplicates, by frame id and by request id", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const { id, body } = await requestFromMaa();
    relay.last.push("deliver", body, id);
    relay.last.push("deliver", body, id);
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(1);
  });

  it("FC-27: drops a request not addressed to this phone, or whose sender isn't the envelope's sender", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const other = await newIdentity();
    const misaddressed = await requestFromMaa({ to: other.deviceId });
    const spoofed = await requestFromMaa({ fromDeviceId: other.deviceId });
    relay.last.push("deliver", misaddressed.body, misaddressed.id);
    relay.last.push("deliver", spoofed.body, spoofed.id);
    const good = await requestFromMaa();
    relay.last.push("deliver", good.body, good.id);
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((r) => r.req.requestId)).toEqual([good.req.requestId]);
  });

  it("a cancel that arrives before its request closes it: the request is then dropped (8.10)", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    const cancels = collect<CancelNotice>((cb) => client.onCancel(cb));
    await connected();
    const { id, body } = await requestFromMaa();
    relay.last.push("deliver", {
      from: maa.deviceId,
      kind: "verify.cancel",
      re: id,
      ttlMs: 60_000,
      system: { reason: "asker_cancelled" },
    });
    await until(() => cancels.length === 1);
    relay.last.push("deliver", body, id);
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toHaveLength(0);
    expect(cancels[0]).toEqual({ requestId: id, reason: "asker_cancelled", from: maa.deviceId });
  });

  it("refuses a readable (plain) envelope: this phone isn't in the Security Lab, so the relay can't downgrade it (9.5)", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const plain = await requestFromMaa({ plain: true });
    relay.last.push("deliver", plain.body, plain.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toHaveLength(0);
  });

  it("an answer whose seal was tampered with arrives as unreadable, for the verifier to report (9.4)", async () => {
    const answers = collect<IncomingAnswer>((cb) => client.onAnswer(cb));
    await connected();
    const id = ulid();
    const re = ulid();
    const ans = {
      requestId: re,
      nonce: "n",
      decision: "ME",
      keyType: "pk",
      credId: "c",
      authenticatorData: "a",
      clientDataJSON: "b",
      signature: "s",
      answeredAt: 1,
    } as const;
    const sealed = await wrap(
      answerPayload(ans, maa),
      { kind: "verify.answer", id, from: maa.deviceId, to: me.deviceId, re },
      maa,
      me.encPub,
      "e2e",
    );
    const ct = sealed.e2e!.ct;
    const flipped = { ...sealed.e2e!, ct: (ct[0] === "A" ? "B" : "A") + ct.slice(1) };
    relay.last.push("deliver", { from: maa.deviceId, kind: "verify.answer", re, ttlMs: 0, e2e: flipped }, id);
    await until(() => answers.length === 1);
    expect(answers[0]).toMatchObject({ sealOk: false, envFrom: maa.deviceId, re });
    expect(answers[0]!.ans).toBeUndefined();
  });

  it("times a family alert by THIS phone's receive time, never the sender's clock (8.7)", async () => {
    const alerts = collect<FamilyAlert>((cb) => client.onAlert(cb));
    await connected();
    const sent: FamilyAlert = {
      id: "alert_1",
      type: "impersonation",
      aboutLabel: "Arjun",
      victimName: "Sunita",
      createdAt: Date.now() + 7 * 60_000,
      read: false,
    };
    const id = ulid();
    const sealed = await wrap(
      alertPayload(sent, maa),
      { kind: "alert", id, from: maa.deviceId, to: me.deviceId },
      maa,
      me.encPub,
      "e2e",
    );
    const before = Date.now();
    relay.last.push("deliver", { from: maa.deviceId, kind: "alert", ttlMs: 86_000_000, ...sealed }, id);
    await until(() => alerts.length === 1);
    expect(alerts[0]!.createdAt).toBeGreaterThanOrEqual(before);
    expect(alerts[0]!.createdAt).toBeLessThanOrEqual(Date.now());
    expect(alerts[0]).toMatchObject({ victimName: "Sunita", aboutLabel: "Arjun", victimDeviceId: maa.deviceId });
  });

  it("delivers what arrived before anyone was listening, to the right listener", async () => {
    await connected();
    const { id, body } = await requestFromMaa();
    relay.last.push("deliver", body, id);
    await until(() => relay.sent("ack").length === 1);
    await new Promise((r) => setTimeout(r, 100));
    const answers = collect<IncomingAnswer>((cb) => client.onAnswer(cb));
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    expect(answers).toHaveLength(0);
    expect(got).toHaveLength(1);
  });

  it("handles frames the service worker stored while the app was closed, once (11.5)", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    const { id, body } = await requestFromMaa();
    await db.pushInbox.put({ id, at: Date.now(), frame: { v: 1, t: "deliver", id, sts: Date.now(), body } });
    await connected();
    await until(() => got.length === 1);
    expect(await db.pushInbox.count()).toBe(0);
    relay.last.push("deliver", body, id); // the live copy of the same frame
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toHaveLength(1);
  });
});
