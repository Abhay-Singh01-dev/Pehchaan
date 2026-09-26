// RealRelay paths not covered by real-relay.test.ts (backend spec 7.2, 7.4, 7.5, 8.4, 8.8–8.10, 9.4, 9.5, 11.5,
// 12, 13, 14.2, 22.1; FC-6, FC-7, FC-13, FC-20; APP-08, C-8.9a, C-8.9b). Written from the spec against the
// scripted relay (helpers/fake-relay.ts): every envelope is really sealed and opened, every login really signed.
// A few timeout rules run on a fake clock; everything else runs in real time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { b64url } from "@pehchaan/crypto/bytes";
import { parseClientFrame, ulid, type DeliverBody, type Kind } from "@pehchaan/protocol";
import { appConfig } from "@/app/config";
import { RealRelay } from "@/services/real/relay/RealRelay";
import {
  alertPayload,
  answerPayload,
  promptPayload,
  requestPayload,
  unwrap,
  wrap,
} from "@/services/real/relay/envelope";
import { RelayError } from "@/services/errors";
import { newIdentity } from "@/services/identity";
import { createRequestFactory } from "@/services/requests";
import { db, type IdentityRow } from "@/store/db";
import type {
  CancelNotice,
  ConnectionState,
  FamilyAlert,
  FamilyMember,
  GuardPrompt,
  IncomingAnswer,
  IncomingRequest,
  PeerInfo,
  Receipt,
  RelayInfo,
  WireAnswer,
} from "@/services/types";
import { FakeRelay, RELAY_HOST, until, type ClientFrame, type FakeSocket } from "./helpers/fake-relay";

const requests = createRequestFactory();
let relay: FakeRelay;
let me: IdentityRow; // this phone (Arjun)
let maa: IdentityRow;
let client: RealRelay;

function makeClient(): RealRelay {
  return new RealRelay({
    db,
    identity: async () => me,
    lookupMember: async () => undefined,
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

/** Polls an asynchronous condition in real time (IndexedDB reads). */
async function eventually(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const quiet = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** A real network never delivers a reply inside send(): scripted replies to queries arrive on a later turn. */
const later = (fn: () => void) => queueMicrotask(fn);

function collect<T>(subscribe: (cb: (v: T) => void) => unknown): T[] {
  const out: T[] = [];
  subscribe((v) => out.push(v));
  return out;
}

const card = (x: IdentityRow) => ({
  deviceId: x.deviceId,
  grant: `${x.grantId}.${x.grantSecret}`,
  encPub: x.encPub,
  devicePub: x.devicePub,
});

/** A request this phone sends to someone. */
const outgoing = (to: IdentityRow) =>
  requests.create({
    from: { deviceId: me.deviceId, name: "Arjun" },
    member: { deviceId: to.deviceId, label: "Maa" } as FamilyMember,
  });

/** A request Maa's phone sends to this phone. */
const incoming = (o: { reason?: "money"; amountInr?: number } = {}) =>
  requests.create({
    from: { deviceId: maa.deviceId, name: "Sunita" },
    member: { deviceId: me.deviceId, label: "Arjun" } as FamilyMember,
    ...o,
  });

/** Seals a payload from `from` (default Maa) to this phone, exactly as the sender's phone does. */
async function envelopeTo(
  kind: Kind,
  payload: object,
  o: { re?: string; from?: IdentityRow; plain?: boolean; late?: boolean } = {},
): Promise<{ id: string; body: DeliverBody }> {
  const from = o.from ?? maa;
  const id = ulid();
  const header = { kind, id, from: from.deviceId, to: me.deviceId, ...(o.re ? { re: o.re } : {}) };
  const sealed = await wrap(payload, header, from, me.encPub, o.plain ? "plain" : "e2e");
  return {
    id,
    body: {
      from: from.deviceId,
      kind,
      ...(o.re ? { re: o.re } : {}),
      ttlMs: 50_000,
      ...(o.late ? { late: true } : {}),
      ...sealed,
    },
  };
}

function anAnswer(re: string, nonce: string): WireAnswer {
  const b = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  return {
    requestId: re,
    nonce,
    decision: "NOT_ME",
    keyType: "pk",
    credId: b(16),
    authenticatorData: b(37),
    clientDataJSON: b(120),
    signature: b(71),
    answeredAt: Date.now(),
  };
}

const theAlert = (): FamilyAlert => ({
  id: "alert_42",
  type: "impersonation",
  aboutDeviceId: me.deviceId,
  aboutLabel: "Arjun",
  victimName: "Sunita",
  victimPhone: "+919812345678",
  amountInr: 50_000,
  createdAt: Date.now(),
  read: false,
});

const flipCt = (body: DeliverBody): DeliverBody => {
  const ct = body.e2e!.ct;
  return { ...body, e2e: { ...body.e2e!, ct: (ct[0] === "A" ? "B" : "A") + ct.slice(1) } };
};

beforeEach(async () => {
  relay = new FakeRelay();
  [me, maa] = await Promise.all([newIdentity(), newIdentity()]);
  await Promise.all([db.outbox.clear(), db.pushInbox.clear(), db.meta.clear()]);
  client = makeClient();
});

afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
  // 7.2: the relay parses strictly and answers anything malformed with bad_request. Every frame this app sent,
  // in every test, must pass the relay's own parser.
  for (const f of relay.frames) {
    const parsed = parseClientFrame(JSON.stringify(f));
    expect(parsed.ok, `${f.t} ${JSON.stringify(parsed)}`).toBe(true);
  }
});

describe("connection, login and Diagnostics (8.9, FC-20)", () => {
  it("onState reports the current state at once and then every change, until unsubscribed", async () => {
    const seen: ConnectionState[] = [];
    const off = client.onState((s) => seen.push(s));
    expect(seen).toEqual(["reconnecting"]);
    await connected();
    expect(seen).toEqual(["reconnecting", "connected"]);
    off();
    relay.last.kill(1006);
    expect(client.getState()).toBe("reconnecting");
    expect(seen).toEqual(["reconnecting", "connected"]);
  });

  it("the update prompt reaches every listener that is still subscribed (4426, FC-23)", async () => {
    const kept: number[] = [];
    const dropped: number[] = [];
    client.onUpdateRequired(() => kept.push(1));
    const off = client.onUpdateRequired(() => dropped.push(1));
    off();
    await connected();
    relay.last.kill(4426);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("onInfo reports the relay session: environment, gateway, E2E, push state and Lab opt-in", async () => {
    const infos: RelayInfo[] = [];
    const off = client.onInfo((i) => infos.push(i));
    expect(infos).toEqual([{ e2e: true }]);
    await connected();
    await until(() => infos.length >= 2);
    expect(client.info()).toEqual({
      env: "test",
      gatewayId: "gw-test",
      e2eRequired: false,
      pushStatus: "ok",
      vapidKeyId: "v1",
      lab: { optedIn: false },
      e2e: true,
    });
    off();
  });

  it("the Lab page's channel: lab.* frames reach it, and its commands resolve or fail with the relay's reason (14.2)", async () => {
    const frames: string[] = [];
    const off = client.onLabFrame((f) => frames.push(f.t));
    relay.reply = (s, f) => {
      if (f.t === "lab.join" && (f.body as { password: string }).password !== "right") {
        s.push("error", { code: "lab_denied", of: f.id });
        return false;
      }
    };
    await connected();
    await expect(client.labCommand("lab.join", { password: "wrong" })).rejects.toMatchObject({ reason: "lab_denied" });
    await client.labCommand("lab.join", { password: "right" });
    expect(relay.sent("lab.join")).toHaveLength(2);
    relay.last.push("lab.traffic", {
      event: { id: "e1", at: 1, kind: "request", from: "a", to: "b", summary: "request" },
    });
    relay.last.push("lab.state", { active: true, optedIn: [], since: 1 });
    await until(() => frames.length === 2);
    expect(frames).toEqual(["lab.traffic", "lab.state"]);
    off();
  });

  it("an expired subscription isn't re-sent at login: the push controller replaces it (11.2)", async () => {
    client.pushSubscribe({
      endpoint: "https://fcm.googleapis.com/fcm/send/dead",
      p256dh: maa.encPub,
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
      vapidKeyId: "v1",
    });
    await connected();
    await until(() => relay.sent("push.subscribe").length >= 1);
    relay.pushStatus = "expired";
    relay.last.kill(1006);
    await until(() => relay.sent("auth").length === 2 && client.getState() === "connected");
    await until(() => relay.last.frames.some((f) => f.t === "grant.set"));
    await quiet();
    expect(relay.last.frames.some((f) => f.t === "push.subscribe")).toBe(false);
  });

  it("address, last message time, peers and announce", async () => {
    expect(client.address()).toBe("wss://relay.pehchaan.test/v1/ws");
    const defaults = new RealRelay({
      db,
      identity: async () => me,
      lookupMember: async () => undefined,
      rotateLocalGrant: async () => me,
    });
    expect(defaults.address()).toBe(appConfig.relayUrl);
    expect(client.lastMessageAt()).toBeNull();
    const peers: PeerInfo[][] = [];
    client.onPeers((p) => peers.push(p))();
    expect(peers).toEqual([[]]); // the real relay knows no names (0, rule 5)
    await connected();
    const before = relay.frames.length;
    client.announce();
    expect(relay.frames.length).toBe(before);
    relay.last.push("receipt", { of: ulid(), state: "delivered" });
    await until(() => client.lastMessageAt() !== null);
  });

  it("ping() measures a round trip to the relay, and fails as offline when not connected", async () => {
    await expect(client.ping()).rejects.toMatchObject({ code: "offline" });
    relay.reply = (s, f) => {
      if (f.t !== "ping") return;
      setTimeout(() => s.push("pong", { serverTime: Date.now() }), 25);
      return false;
    };
    await connected();
    const rtt = await client.ping();
    expect(rtt).toBeGreaterThanOrEqual(10);
    expect(rtt).toBeLessThan(2_000);
  });

  it("reconnect() (a notification tap, Diagnostics) opens a new connection at once and logs in again", async () => {
    await connected();
    const n = relay.sockets.length;
    client.reconnect();
    expect(relay.sockets.length).toBe(n + 1);
    await until(() => relay.sent("auth").length === 2 && client.getState() === "connected");
  });

  it("re-sends grant.set and the saved push.subscribe after every login (C-8.9b)", async () => {
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: maa.encPub,
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
      vapidKeyId: "v1",
    };
    client.pushSubscribe(sub);
    await connected();
    await until(() => relay.sent("push.subscribe").length >= 1 && relay.sent("grant.set").length === 1);
    relay.last.kill(1006);
    await until(() => relay.sent("auth").length === 2 && client.getState() === "connected");
    const second = relay.last;
    await until(() => second.frames.some((f) => f.t === "grant.set"));
    await until(() => second.frames.some((f) => f.t === "push.subscribe"));
    expect(second.frames.filter((f) => f.t === "push.subscribe").map((f) => f.body)).toContainEqual(sub);
  });

  it("after a login, grant.set and push.subscribe go out before the outbox is flushed (8.9 steps 1 then 2)", async () => {
    client.pushSubscribe({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: maa.encPub,
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
      vapidKeyId: "v1",
    });
    await client.sendAlert(theAlert(), [card(maa)]); // written while the connection was down: waits in the outbox
    expect(relay.sockets).toHaveLength(0);
    await connected();
    await until(() => relay.sent("send").length === 1 && relay.sent("grant.set").length === 1);
    const order = relay.last.frames.map((f) => f.t);
    expect(order.indexOf("grant.set")).toBeLessThan(order.indexOf("send"));
    expect(order.indexOf("push.subscribe")).toBeLessThan(order.indexOf("send"));
  });

  it("a refused grant.set doesn't break the connection", async () => {
    relay.reply = (s, f) => {
      if (f.t !== "grant.set") return;
      s.push("error", { code: "bad_request", of: f.id });
      return false;
    };
    await connected();
    await until(() => relay.sent("grant.set").length === 1);
    await quiet();
    expect(client.getState()).toBe("connected");
  });

  it("'Reset my code' while connected registers the new grant at once, with rotate: true (6.4)", async () => {
    await connected();
    await until(() => relay.sent("grant.set").length === 1);
    const grant = await client.rotateGrant();
    expect(grant).toBe(`${me.grantId}.${me.grantSecret}`);
    expect(relay.sent("grant.set").at(-1)!.body).toMatchObject({ grantId: me.grantId, rotate: true });
    expect(await db.meta.get("grant:rotatePending")).toBeUndefined();
  });

  it("`unauthenticated` from the relay makes the app log in again (7.5)", async () => {
    await connected();
    client.markSeen(ulid());
    await until(() => relay.sent("seen").length === 1);
    relay.last.push("error", { code: "unauthenticated", of: relay.sent("seen")[0]!.id });
    await until(() => relay.sent("auth").length === 2);
  });

  it("errors without an id, or for a message it isn't waiting on, change nothing", async () => {
    await connected();
    relay.last.push("error", { code: "bad_request" });
    relay.last.push("error", { code: "not_allowed", of: ulid() });
    relay.last.push("receipt", { of: ulid(), state: "rejected", reason: "not_allowed" });
    await quiet();
    expect(client.getState()).toBe("connected");
  });
});

describe("the service worker (11.5, C-8.9a)", () => {
  it("a notification tap reconnects at once; push-frame and becoming visible process the push inbox", async () => {
    const sw = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("navigator", { serviceWorker: sw, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0" });
    vi.stubGlobal("document", doc);
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();

    const n = relay.sockets.length;
    sw.dispatchEvent(new MessageEvent("message", { data: { type: "navigate", url: "/request/x" } }));
    expect(relay.sockets.length).toBe(n + 1);

    const stored = async () => {
      const r = incoming();
      const { id, body } = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId });
      await db.pushInbox.put({ id, at: Date.now(), frame: { v: 1, t: "deliver", id, sts: Date.now(), body } });
    };
    await stored();
    sw.dispatchEvent(new MessageEvent("message", { data: { type: "push-frame" } }));
    await until(() => got.length === 1);

    await stored();
    sw.dispatchEvent(new MessageEvent("message", { data: { type: "something-else" } }));
    sw.dispatchEvent(new MessageEvent("message", { data: null }));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await quiet();
    expect(got).toHaveLength(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await until(() => got.length === 2);
    await eventually(async () => (await db.pushInbox.count()) === 0);
  });

  it("frames in the push inbox that aren't deliveries are discarded", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await db.pushInbox.bulkPut([
      { id: "w1", at: 1, frame: { t: "wake", id: "x" } },
      { id: "w2", at: 2, frame: null },
      { id: "w3", at: 3, frame: { t: "deliver", id: ulid() } },
    ]);
    await client.drainPushInbox();
    expect(await db.pushInbox.count()).toBe(0);
    expect(got).toHaveLength(0);
  });
});

describe("sending (7.5, 8.4, FC-13)", () => {
  it("sendRequest fails at once as offline when the phone has no network, and sends nothing", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    relay.onOpen = async () => {}; // nothing answers
    client = makeClient();
    client.connect(me.deviceId);
    await until(() => client.getState() === "offline");
    await expect(client.sendRequest(outgoing(maa), card(maa))).rejects.toMatchObject({ code: "offline" });
    expect(relay.sent("send")).toHaveLength(0);
  });

  it("a rejected receipt ends the wait with the relay's reason; not_allowed ends it with FC-13's line", async () => {
    let reason = "duplicate_request";
    relay.reply = (s, f) => {
      if (f.t !== "send") return;
      s.push("receipt", { of: f.id, to: maa.deviceId, re: f.body.re as string, state: "rejected", reason });
      return false;
    };
    const receipts = collect<Receipt>((cb) => client.onReceipt(cb));
    await connected();
    await expect(client.sendRequest(outgoing(maa), card(maa))).rejects.toMatchObject({
      code: "rejected",
      reason: "duplicate_request",
    });
    reason = "not_allowed";
    await expect(client.sendRequest(outgoing(maa), card(maa))).rejects.toMatchObject({ code: "not_allowed" });
    const refused = receipts.filter((r) => r.state === "rejected");
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ to: maa.deviceId, reason: "duplicate_request" });
  });

  it("an unknown_target error ends a request with FC-13's line too", async () => {
    relay.reply = (s, f) => {
      if (f.t !== "send") return;
      s.push("error", { code: "unknown_target", of: f.id });
      return false;
    };
    await connected();
    const err = await client.sendRequest(outgoing(maa), card(maa)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err).toMatchObject({ code: "not_allowed", reason: "unknown_target" });
  });

  it("an answer refused as already_answered, cancelled or expired is reported with that reason (F4)", async () => {
    relay.reply = (s, f) => {
      if (f.t !== "send") return;
      s.push("error", { code: (f.body.re as string) === reRefused.a ? "already_answered" : reRefused.code, of: f.id });
      return false;
    };
    const reRefused = { a: ulid(), code: "cancelled" };
    await connected();
    const first = await client.sendAnswer(anAnswer(reRefused.a, b64url(new Uint8Array(32))), card(maa)).catch((e) => e);
    expect(first).toMatchObject({ code: "rejected", reason: "already_answered" });
    for (const code of ["cancelled", "expired"]) {
      reRefused.code = code;
      const err = await client.sendAnswer(anAnswer(ulid(), b64url(new Uint8Array(32))), card(maa)).catch((e) => e);
      expect(err).toMatchObject({ code: "rejected", reason: code });
    }
    await eventually(async () => (await db.outbox.count()) === 0); // refused answers aren't kept for a retry
  });

  it("an answer waits in IndexedDB while the relay can't be reached, and a reloaded app sends it with the same id (8.4)", async () => {
    const before = client; // never connects: the relay is out of reach
    void before.sendAnswer(anAnswer(ulid(), b64url(new Uint8Array(32))), card(maa)).catch(() => {});
    await eventually(async () => (await db.outbox.count()) === 1);
    const row = (await db.outbox.toArray())[0]!;
    before.disconnect();

    client = makeClient(); // the app reloads
    await connected();
    await until(() => relay.sent("send").length === 1);
    expect(relay.sent("send")[0]).toEqual(JSON.parse(row.frame));
    await eventually(async () => (await db.outbox.count()) === 0); // accepted: forgotten
  });

  it("sendAnswer resolves on `accepted`, sealed to the asker with the request id as `re`", async () => {
    await connected();
    const re = ulid();
    await client.sendAnswer(anAnswer(re, b64url(new Uint8Array(32))), card(maa));
    const f = relay.sent("send")[0]!;
    expect(f.body).toMatchObject({ kind: "verify.answer", to: maa.deviceId, re });
    expect(f.body.e2e).toBeDefined();
  });

  it("a family alert goes to each recipient separately, sealed for that recipient alone (13.1)", async () => {
    const papa = await newIdentity();
    await connected();
    const out = await client.sendAlert(theAlert(), [card(maa), card(papa)]);
    expect(out.map((o) => o.deviceId)).toEqual([maa.deviceId, papa.deviceId]);
    await until(() => relay.sent("send").length === 2);
    const sends = relay.sent("send");
    expect(sends.map((f) => f.id)).toEqual(out.map((o) => o.msgId));
    expect(sends.map((f) => f.body.to)).toEqual([maa.deviceId, papa.deviceId]);
    for (const f of sends) {
      expect(f.body).toMatchObject({ kind: "alert", ttlMs: 24 * 60 * 60_000 });
      expect(f.body.re).toBeUndefined();
    }
    // Each recipient opens its own copy; Maa can't open Papa's.
    const asDelivered = (f: ClientFrame): DeliverBody => ({
      from: me.deviceId,
      kind: "alert",
      ttlMs: 1000,
      e2e: f.body.e2e as DeliverBody["e2e"],
    });
    const forMaa = await unwrap("alert", asDelivered(sends[0]!), sends[0]!.id, maa, { acceptPlain: false });
    expect(forMaa.ok && forMaa.payload.alert).toMatchObject({ aboutLabel: "Arjun", victimName: "Sunita" });
    expect((await unwrap("alert", asDelivered(sends[1]!), sends[1]!.id, maa, { acceptPlain: false })).ok).toBe(false);
    expect((await unwrap("alert", asDelivered(sends[1]!), sends[1]!.id, papa, { acceptPlain: false })).ok).toBe(true);
  });

  it("a Call Guard prompt is sealed to the phone and resolves on `accepted` (13.2)", async () => {
    await connected();
    await client.sendGuardPrompt(
      { claimedLabel: "Arjun", claimedDeviceId: me.deviceId, amountInr: 5_000, tactics: ["urgency"], at: Date.now() },
      card(maa),
    );
    const f = relay.sent("send")[0]!;
    expect(f.body).toMatchObject({ kind: "guard.prompt", to: maa.deviceId, ttlMs: 2 * 60_000 });
    expect(f.body.e2e).toBeDefined();
    expect(JSON.stringify(f)).not.toContain("urgency");
  });

  it("cancelling a request that isn't pending still tells the relay (8.6); seen tells the asker (F1 open)", async () => {
    await connected();
    const re = ulid();
    await client.cancelRequest(re);
    expect(relay.sent("cancel")[0]!.body).toEqual({ re });
    client.markSeen(re);
    await until(() => relay.sent("seen").length === 1);
    expect(relay.sent("seen")[0]!.body).toEqual({ re });
  });

  it("control messages: block, unblock, delete my device, test alert (FC-19, FC-18, FC-8)", async () => {
    await connected();
    await client.revokeContact(maa.deviceId);
    await client.unrevokeContact(maa.deviceId);
    await client.retire();
    await client.sendTestAlert();
    expect(relay.sent("contact.revoke")[0]!.body).toEqual({ deviceId: maa.deviceId });
    expect(relay.sent("contact.unrevoke")[0]!.body).toEqual({ deviceId: maa.deviceId });
    expect(relay.sent("device.retire")[0]!.body).toEqual({});
    expect(relay.sent("push.test")[0]!.body).toEqual({});
  });
});

describe("presence and contacts (12, FC-18)", () => {
  const someIds = (n: number) => Array.from({ length: n }, () => b64url(crypto.getRandomValues(new Uint8Array(16))));

  it("asks about at most 50 distinct devices, and keeps the list of reachable ones up to date", async () => {
    let offline = new Set<string>();
    relay.reply = (s, f) => {
      if (f.t !== "presence.query") return;
      const ids = f.body.ids as string[];
      const states = Object.fromEntries(
        ids.map((id, i) => [id, offline.has(id) ? "offline" : (["online", "push", "offline"] as const)[i % 3]]),
      );
      later(() => s.push("presence", { states }));
      return false;
    };
    const lists = collect<string[]>((cb) => client.onPresence(cb));
    expect(lists).toEqual([[]]);
    await connected();
    expect(await client.queryPresence([])).toEqual({});
    expect(relay.sent("presence.query")).toHaveLength(0);

    const ids = someIds(60);
    const states = await client.queryPresence([...ids, ...ids]);
    expect(relay.sent("presence.query")[0]!.body.ids).toEqual(ids.slice(0, 50));
    expect(Object.keys(states)).toHaveLength(50);
    const reachable = ids.slice(0, 50).filter((_, i) => i % 3 !== 2);
    expect(lists.at(-1)).toEqual([...reachable].sort());

    offline = new Set([reachable[0]!]);
    await client.queryPresence([reachable[0]!]);
    expect(lists.at(-1)).toEqual(reachable.slice(1).sort());
  });

  it("lists who can reach me", async () => {
    const contacts = [{ deviceId: maa.deviceId, since: 1_761_900_000_000, via: "grant" as const }];
    relay.reply = (s, f) => {
      if (f.t !== "contact.list") return;
      later(() => s.push("contact.list.result", { contacts }));
      return false;
    };
    await connected();
    expect(await client.contacts()).toEqual(contacts);
  });

  it("presence and contacts fail as offline when not connected", async () => {
    await expect(client.queryPresence([maa.deviceId])).rejects.toMatchObject({ code: "offline" });
    await expect(client.contacts()).rejects.toMatchObject({ code: "offline" });
  });
});

describe("receiving (7.4, 8.4, 8.8, 8.10, 9.4, 13)", () => {
  it("hands over a request with its reason and amount; the same request again under a new frame id is dropped", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const r = incoming({ reason: "money", amountInr: 50_000 });
    const a = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId });
    const b = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId });
    relay.last.push("deliver", a.body, a.id);
    await until(() => got.length === 1);
    relay.last.push("deliver", b.body, b.id);
    await until(() => relay.sent("ack").length === 2); // the duplicate is still acked
    await quiet();
    expect(got).toHaveLength(1);
    expect(got[0]!.req).toMatchObject({
      requestId: r.requestId,
      reason: "money",
      amountInr: 50_000,
      fromName: "Sunita",
      claimedLabel: "Arjun",
    });
  });

  it("drops a request whose sealed request id isn't the envelope's (FC-27)", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    await connected();
    const r = incoming();
    const other = ulid();
    const e = await envelopeTo("verify.request", requestPayload(r, maa), { re: other });
    relay.last.push("deliver", e.body, e.id);
    await until(() => relay.sent("ack").length === 1);
    await quiet();
    expect(got).toHaveLength(0);
  });

  it("a cancel without a relay notice still closes the request; a cancel without a request id is ignored", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    const cancels = collect<CancelNotice>((cb) => client.onCancel(cb));
    await connected();
    const r = incoming();
    relay.last.push("deliver", { from: maa.deviceId, kind: "verify.cancel", re: r.requestId, ttlMs: 60_000 });
    relay.last.push("deliver", {
      from: maa.deviceId,
      kind: "verify.cancel",
      ttlMs: 60_000,
      system: { reason: "expired" },
    });
    const e = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId });
    relay.last.push("deliver", e.body, e.id);
    await until(() => relay.sent("ack").length === 3);
    await quiet();
    expect(got).toHaveLength(0);
    expect(cancels).toHaveLength(0);
  });

  it("hands over an answer with the relay's late mark, and one that arrived in time without it (8.8)", async () => {
    const answers = collect<IncomingAnswer>((cb) => client.onAnswer(cb));
    await connected();
    const re = ulid();
    const ans = anAnswer(re, b64url(crypto.getRandomValues(new Uint8Array(32))));
    const late = await envelopeTo("verify.answer", answerPayload(ans, maa), { re, late: true });
    const onTime = await envelopeTo("verify.answer", answerPayload(ans, maa), { re });
    relay.last.push("deliver", late.body, late.id);
    await until(() => answers.length === 1);
    relay.last.push("deliver", onTime.body, onTime.id);
    await until(() => answers.length === 2);
    expect(answers[0]).toMatchObject({ sealOk: true, envFrom: maa.deviceId, re, late: true, ans });
    expect(answers[1]).toMatchObject({ sealOk: true, re, ans });
    expect(answers[1]!.late).toBeUndefined();
  });

  it("a family alert keeps its optional fields; a tampered alert is dropped (9.4)", async () => {
    const alerts = collect<FamilyAlert>((cb) => client.onAlert(cb));
    await connected();
    const sent = theAlert();
    const good = await envelopeTo("alert", alertPayload(sent, maa));
    const bad = await envelopeTo("alert", alertPayload({ ...sent, id: "alert_43" }, maa));
    relay.last.push("deliver", flipCt(bad.body), bad.id);
    relay.last.push("deliver", good.body, good.id);
    await until(() => alerts.length === 1);
    await quiet();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "alert_42",
      aboutDeviceId: me.deviceId,
      victimPhone: "+919812345678",
      amountInr: 50_000,
      victimDeviceId: maa.deviceId,
      read: false,
    });
  });

  it("a Call Guard prompt reaches this phone with or without its optional fields; a tampered one is dropped", async () => {
    const prompts = collect<GuardPrompt>((cb) => client.onGuardPrompt(cb));
    await connected();
    const full: GuardPrompt = {
      claimedLabel: "Arjun",
      claimedDeviceId: me.deviceId,
      amountInr: 5_000,
      tactics: ["urgency", "secrecy"],
      at: 1_761_900_000_000,
    };
    const bare: GuardPrompt = { claimedLabel: "Bank", tactics: [], at: 1_761_900_000_001 };
    const a = await envelopeTo("guard.prompt", promptPayload(full, maa));
    const b = await envelopeTo("guard.prompt", promptPayload(bare, maa));
    const c = await envelopeTo("guard.prompt", promptPayload({ ...bare, claimedLabel: "Police" }, maa));
    relay.last.push("deliver", a.body, a.id);
    relay.last.push("deliver", b.body, b.id);
    relay.last.push("deliver", flipCt(c.body), c.id);
    await until(() => prompts.length === 2);
    await quiet();
    expect(prompts).toHaveLength(2);
    expect(prompts).toEqual(expect.arrayContaining([full, bare]));
  });
});

describe("the Security Lab (9.5, 14.2)", () => {
  it("between two opted-in phones envelopes travel readable and signed; to anyone else they stay sealed", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    const infos = collect<RelayInfo>((cb) => client.onInfo(cb));
    await connected();
    await client.labOptIn("lab-password");
    expect(relay.sent("lab.optin")[0]!.body).toEqual({ password: "lab-password" });
    expect(client.info().lab).toEqual({ optedIn: true });
    const n = infos.length;
    relay.last.push("lab.state", { active: true, optedIn: [me.deviceId, maa.deviceId], since: Date.now() });
    await until(() => infos.length > n);

    await client.sendRequest(outgoing(maa), card(maa));
    const toPeer = relay.sent("send").at(-1)!;
    expect(toPeer.body.plain).toBeDefined();
    expect(toPeer.body.psig).toBeDefined();
    expect(toPeer.body.e2e).toBeUndefined();

    const stranger = await newIdentity();
    await client.sendRequest(outgoing(stranger), card(stranger));
    const toStranger = relay.sent("send").at(-1)!;
    expect(toStranger.body.e2e).toBeDefined();
    expect(toStranger.body.plain).toBeUndefined();

    // While this phone is opted in, it accepts readable envelopes (still signed).
    const r = incoming();
    const e = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId, plain: true });
    relay.last.push("deliver", e.body, e.id);
    await until(() => got.length === 1);
  });

  it("a Lab state that doesn't list this phone turns its opt-in off, and readable envelopes are refused again", async () => {
    const got = collect<IncomingRequest>((cb) => client.onRequest(cb));
    const infos = collect<RelayInfo>((cb) => client.onInfo(cb));
    await connected();
    await client.labOptIn("lab-password");
    const n = infos.length;
    relay.last.push("lab.state", { active: true, optedIn: [maa.deviceId], since: Date.now() });
    await until(() => infos.length > n);
    expect(client.info().lab).toEqual({ optedIn: false });
    const r = incoming();
    const e = await envelopeTo("verify.request", requestPayload(r, maa), { re: r.requestId, plain: true });
    relay.last.push("deliver", e.body, e.id);
    await until(() => relay.sent("ack").length === 1);
    await quiet();
    expect(got).toHaveLength(0);
  });

  it("reports verdicts only while opted in; opting out stops them and seals everything again", async () => {
    await connected();
    const verdict = {
      requestId: ulid(),
      verdict: "INVALID" as const,
      invalidReason: "changed" as const,
      failedChecks: [3],
    };
    client.reportVerdict(verdict);
    await client.labOptIn("lab-password");
    relay.last.push("lab.state", { active: true, optedIn: [me.deviceId, maa.deviceId], since: Date.now() });
    client.reportVerdict(verdict);
    await client.labOptOut();
    client.reportVerdict(verdict);
    await until(() => relay.sent("lab.report").length >= 1);
    await quiet();
    expect(relay.sent("lab.report").map((f) => f.body)).toEqual([verdict]);
    expect(relay.sent("lab.optout")[0]!.body).toEqual({});
    expect(client.info().lab).toEqual({ optedIn: false });
    await client.sendRequest(outgoing(maa), card(maa));
    expect(relay.sent("send").at(-1)!.body.e2e).toBeDefined();
  });
});

describe("waiting on the relay's terms (7.5, 8.4, 12), on a fake clock", () => {
  /** Real event-loop turns (fake time stands still) until `check` passes. */
  async function settled(check: () => boolean, ms = 5000): Promise<void> {
    const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
    while (!check()) {
      if (process.hrtime.bigint() > end) throw new Error("condition not met in time");
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  async function connectedNow(): Promise<void> {
    client.connect(me.deviceId);
    await settled(() => client.getState() === "connected");
    await settled(() => relay.sent("grant.set").length === 1);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("rate_limited: waits retryAfterMs, then re-sends the same message by itself", async () => {
    let refusals = 1;
    relay.reply = (s: FakeSocket, f: ClientFrame) => {
      if (f.t !== "send" || refusals-- <= 0) return;
      s.push("error", { code: "rate_limited", of: f.id, retryAfterMs: 7_000 });
      return false;
    };
    await connectedNow();
    let done = false;
    const sending = client
      .sendAnswer(anAnswer(ulid(), b64url(new Uint8Array(32))), card(maa))
      .then(() => (done = true));
    await settled(() => relay.sent("send").length === 1);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(relay.sent("send")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_001); // within one retry period after the wait
    await settled(() => done);
    await sending;
    const sends = relay.sent("send");
    expect(sends).toHaveLength(2);
    expect(sends[1]!.id).toBe(sends[0]!.id);
  });

  it("a rate limit that outlasts the message is reported at once as rate_limited, not as a timeout (11.8)", async () => {
    relay.reply = (s: FakeSocket, f: ClientFrame) => {
      if (f.t !== "push.test") return;
      s.push("error", { code: "rate_limited", of: f.id, retryAfterMs: 20 * 60_000 });
      return false;
    };
    await connectedNow();
    let err: unknown = null;
    const sending = client.sendTestAlert().catch((e: unknown) => (err = e));
    await settled(() => relay.sent("push.test").length === 1);
    await vi.advanceTimersByTimeAsync(50);
    await settled(() => err !== null);
    await sending;
    expect(err).toMatchObject({ code: "rejected", reason: "rate_limited" });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(relay.sent("push.test")).toHaveLength(1); // dropped, not re-sent 20 minutes later
  });

  it("unavailable: keeps the message and retries it with the same id", async () => {
    let refusals = 2;
    relay.reply = (s: FakeSocket, f: ClientFrame) => {
      if (f.t !== "send" || refusals-- <= 0) return;
      s.push("error", { code: "unavailable", of: f.id });
      return false;
    };
    await connectedNow();
    let done = false;
    void client.sendAnswer(anAnswer(ulid(), b64url(new Uint8Array(32))), card(maa)).then(() => (done = true));
    await settled(() => relay.sent("send").length === 1);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled(() => done);
    expect(new Set(relay.sent("send").map((f) => f.id)).size).toBe(1);
    expect(relay.sent("send").length).toBe(3);
  });

  it("a request that gets no `accepted` while the phone loses its network ends as offline, not unreachable", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    relay.reply = (_s: FakeSocket, f: ClientFrame) => (f.t === "send" ? false : undefined);
    await connectedNow();
    const result = client.sendRequest(outgoing(maa), card(maa)).catch((e: unknown) => e);
    await settled(() => relay.sent("send").length === 1);
    win.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ code: "offline" });
  });

  it("a control message the relay never confirms is re-sent with the same id, then given up as unreachable", async () => {
    relay.reply = (_s: FakeSocket, f: ClientFrame) => (f.t === "contact.revoke" ? false : undefined);
    await connectedNow();
    const result = client.revokeContact(maa.deviceId).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ code: "unreachable" });
    const sent = relay.sent("contact.revoke");
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sent.map((f) => f.id)).size).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(relay.sent("contact.revoke")).toHaveLength(sent.length); // and never again
  });

  it("an unanswered presence query gives up after 10 s, and doesn't swallow the next query's reply", async () => {
    let answer = false;
    relay.reply = (s: FakeSocket, f: ClientFrame) => {
      if (f.t !== "presence.query") return;
      if (answer) later(() => s.push("presence", { states: { [maa.deviceId]: "online" } }));
      return false;
    };
    await connectedNow();
    const first = client.queryPresence([maa.deviceId]).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toMatchObject({ code: "unreachable" });
    answer = true;
    await expect(client.queryPresence([maa.deviceId])).resolves.toEqual({ [maa.deviceId]: "online" });
  });
});
