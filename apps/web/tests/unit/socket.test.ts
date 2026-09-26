// RelaySocket, the app's WebSocket to the relay (backend spec 7.1–7.6, 8.7, 8.9; FC-6, FC-23; APP-08, C-7.1b,
// C-8.9a, C-8.9c). Written from the spec against the scripted relay in helpers/fake-relay.ts, so every login is
// really signed and really verified. The clock is fake (vi.useFakeTimers) so the 25 s and 30 s rules run at once;
// WebCrypto still runs for real, off the main thread, so tests wait for it with `settled` (real event-loop turns,
// not fake time).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseClientFrame, ulid, type RelayBody, type RelayFrame } from "@pehchaan/protocol";
import { RelaySocket, backoffMs } from "@/services/real/relay/socket";
import { newIdentity } from "@/services/identity";
import type { IdentityRow } from "@/store/db";
import type { ConnectionState } from "@/services/types";
import { FakeRelay, RELAY_HOST, type ClientFrame, type FakeSocket } from "./helpers/fake-relay";

let me: IdentityRow;
let relay: FakeRelay;
let socket: RelaySocket;
let states: ConnectionState[];
let frames: RelayFrame[];
let logins: Array<{ hello: RelayBody<"hello">; ok: RelayBody<"auth.ok"> }>;
let updates: number;

interface Options {
  random?: () => number;
  identity?: () => Promise<IdentityRow>;
  WebSocketImpl?: typeof WebSocket;
}

function make(o: Options = {}): RelaySocket {
  socket = new RelaySocket({
    url: "wss://relay.pehchaan.test/v1/ws",
    relayHost: RELAY_HOST,
    identity: o.identity ?? (async () => me),
    appVersion: "1.4.2",
    platform: "android-chrome",
    onFrame: (f) => frames.push(f),
    onLogin: (hello, ok) => logins.push({ hello, ok }),
    onState: (s) => states.push(s),
    onUpdateRequired: () => updates++,
    WebSocketImpl: o.WebSocketImpl ?? relay.Impl,
    // A random source of 0.5 means zero jitter, so every delay is exactly its step unless a test asks otherwise.
    random: o.random ?? (() => 0.5),
  });
  return socket;
}

/** Real event-loop turns (fake time stands still) until `check` passes: lets WebCrypto and the relay finish. */
async function settled(check: () => boolean, ms = 5000): Promise<void> {
  const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
  while (!check()) {
    if (process.hrtime.bigint() > end) throw new Error("condition not met in time");
    await new Promise<void>((r) => setImmediate(r));
  }
}

async function connect(): Promise<void> {
  socket.start();
  await settled(() => socket.state === "connected");
}

/** A real network never answers inside send(): the relay's pong arrives on a later turn. */
function answerPingsLater(s: FakeSocket, f: ClientFrame): boolean | void {
  if (f.t !== "ping") return;
  queueMicrotask(() => s.push("pong", { serverTime: Date.now() + relay.clockAheadMs }));
  return false;
}

const swallowPings = (_s: FakeSocket, f: ClientFrame): boolean | void => (f.t === "ping" ? false : undefined);

/** From now on the relay drops every new connection at once. Returns a function that brings it back. */
function relayDown(): () => void {
  const up = relay.onOpen.bind(relay);
  relay.onOpen = async (s) => s.kill(1006);
  return () => {
    relay.onOpen = up;
  };
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

/** The browser objects the socket listens to (Node has none of them). */
function browser() {
  const win = new EventTarget();
  const doc = new FakeDocument();
  const nav = { onLine: true };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", nav);
  return { win, doc, nav };
}

const aFrame = () => ({ v: 1, t: "seen", id: ulid(), ts: Date.now(), body: { re: ulid() } });

beforeAll(async () => {
  me = await newIdentity();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  relay = new FakeRelay();
  relay.reply = answerPingsLater;
  states = [];
  frames = [];
  logins = [];
  updates = 0;
  make();
});

afterEach(() => {
  socket.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connection states (8.9, C-8.9c)", () => {
  it("starts as reconnecting, then shows connected once the relay accepts the signed login (7.3)", async () => {
    expect(socket.state).toBe("reconnecting");
    expect(socket.isAuthed).toBe(false);
    await connect();
    expect(states).toEqual(["connected"]);
    expect(socket.isAuthed).toBe(true);
    expect(relay.loginFailures).toBe(0);
    expect(relay.last.protocols).toBe("pehchaan.v1");
    const auth = relay.sent("auth")[0]!;
    expect(auth.body).toMatchObject({
      deviceId: me.deviceId,
      devicePub: me.devicePub,
      client: { ver: "1.4.2", platform: "android-chrome" },
    });
    expect(parseClientFrame(JSON.stringify(auth)).ok).toBe(true);
    expect(logins).toHaveLength(1);
    expect(logins[0]!.hello).toMatchObject({ gatewayId: "gw-test", env: "test", e2eRequired: false });
    expect(logins[0]!.ok).toMatchObject({ pushStatus: "ok", lab: { optedIn: false } });
    // hello and auth.ok are the socket's own business, not the app's
    expect(frames).toEqual([]);
  });

  it("start() twice still opens a single connection", async () => {
    socket.start();
    socket.start();
    await settled(() => socket.state === "connected");
    expect(relay.sockets).toHaveLength(1);
  });

  it("a dropped connection shows reconnecting at once, not offline", async () => {
    await connect();
    relay.last.kill(1006);
    expect(socket.state).toBe("reconnecting");
    expect(socket.isAuthed).toBe(false);
    expect(states).toEqual(["connected", "reconnecting"]);
  });

  it("shows offline once reconnecting has lasted 30 s", async () => {
    await connect();
    relayDown();
    relay.last.kill(1006);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(socket.state).toBe("reconnecting");
    expect(relay.sockets.length).toBeGreaterThan(4); // it kept trying all along
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.state).toBe("offline");
  });

  it("an attempt that connects but never logs in also shows offline at 30 s", async () => {
    relay.onOpen = async () => {}; // the relay accepts the socket and then says nothing
    socket.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(socket.state).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.state).toBe("offline");
  });

  it("keeps retrying while offline, and shows connected as soon as a login succeeds", async () => {
    await connect();
    const up = relayDown();
    relay.last.kill(1006);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(socket.state).toBe("offline");
    up();
    await vi.advanceTimersByTimeAsync(8_000); // retries continue every 8 s
    await settled(() => socket.state === "connected");
    expect(states.at(-1)).toBe("connected");
  });

  it("shows offline at once when the browser says it has no network (navigator.onLine false)", async () => {
    const { nav } = browser();
    await connect();
    nav.onLine = false;
    relay.last.kill(1006);
    expect(socket.state).toBe("offline");
  });

  it("the browser's offline event shows offline; its online event reconnects at once, without waiting (C-8.9a)", async () => {
    const { win, nav } = browser();
    await connect();
    nav.onLine = false;
    win.dispatchEvent(new Event("offline"));
    expect(socket.state).toBe("offline");
    relay.last.kill(1006); // the dead connection finally closes
    expect(socket.state).toBe("offline");
    const before = relay.sockets.length;
    nav.onLine = true;
    win.dispatchEvent(new Event("online"));
    expect(relay.sockets.length).toBe(before + 1);
    await settled(() => socket.state === "connected");
  });

  it("becoming visible reconnects at once while disconnected (C-8.9a)", async () => {
    const { doc } = browser();
    await connect();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    relay.last.kill(1006); // a retry is now scheduled 0.5 s ahead
    const before = relay.sockets.length;
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(relay.sockets.length).toBe(before + 1);
    await settled(() => socket.state === "connected");
  });

  it("becoming visible while connected doesn't open another connection", async () => {
    const { doc } = browser();
    await connect();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(relay.sockets).toHaveLength(1);
    expect(relay.last.readyState).toBe(1);
  });

  it("reconnectNow() (a notification tap) replaces the connection at once", async () => {
    await connect();
    const old = relay.last;
    socket.reconnectNow();
    expect(old.readyState).toBe(3);
    expect(relay.sockets).toHaveLength(2);
    await settled(() => socket.state === "connected" && socket.isAuthed);
    expect(relay.sent("auth")).toHaveLength(2);
  });

  it("stop() closes the connection and nothing brings it back", async () => {
    const { win, doc } = browser();
    await connect();
    const s = relay.last;
    socket.stop();
    expect(s.readyState).toBe(3);
    expect(socket.send(aFrame())).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    win.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    socket.reconnectNow();
    expect(relay.sockets).toHaveLength(1);
  });

  it("reconnectNow() before start() does nothing", () => {
    socket.reconnectNow();
    expect(relay.sockets).toHaveLength(0);
  });
});

describe("backoff with jitter (8.9)", () => {
  it("is 0.5, 1, 2, 4, 8 s, then every 8 s, when the jitter happens to be zero", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50, 10_000].map((n) => backoffMs(n, () => 0.5))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000,
    ]);
  });

  it("keeps every delay within ±30% of its step, across the whole random range", () => {
    const steps = [500, 1000, 2000, 4000, 8000, 8000, 8000];
    for (let i = 0; i <= 100; i++) {
      const r = i / 100;
      steps.forEach((step, n) => {
        const d = backoffMs(n, () => r);
        expect(d).toBeGreaterThanOrEqual(step * 0.7);
        expect(d).toBeLessThanOrEqual(step * 1.3);
      });
    }
  });

  it("uses real randomness by default, so phones don't all come back at the same instant", () => {
    const delays = Array.from({ length: 200 }, () => backoffMs(4));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(5600);
      expect(d).toBeLessThanOrEqual(10_400);
    }
    expect(new Set(delays).size).toBeGreaterThan(20);
  });

  it("reconnects after a close on that schedule, then every 8 s", async () => {
    await connect();
    relayDown();
    relay.last.kill(1006);
    for (const gap of [500, 1000, 2000, 4000, 8000, 8000, 8000]) {
      const n = relay.sockets.length;
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(relay.sockets.length).toBe(n);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.sockets.length).toBe(n + 1);
    }
  });

  it("applies the jitter to real reconnects: at its lowest, each wait is 30% shorter", async () => {
    make({ random: () => 0 });
    await connect();
    relayDown();
    relay.last.kill(1006);
    for (const gap of [350, 700, 1400, 2800]) {
      const n = relay.sockets.length;
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(relay.sockets.length).toBe(n);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.sockets.length).toBe(n + 1);
    }
  });

  it("a successful login starts the schedule again from 0.5 s", async () => {
    await connect();
    const up = relayDown();
    relay.last.kill(1006);
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000); // three failed attempts
    up();
    await vi.advanceTimersByTimeAsync(4000);
    await settled(() => socket.state === "connected");
    relay.last.kill(1006);
    const n = relay.sockets.length;
    await vi.advanceTimersByTimeAsync(499);
    expect(relay.sockets.length).toBe(n);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.sockets.length).toBe(n + 1);
  });

  it("a connection the browser refuses to even create is retried on the same schedule", async () => {
    let refusals = 2;
    const Impl = function (url: string, protocols: string | string[]) {
      if (refusals-- > 0) throw new DOMException("blocked", "SecurityError");
      return new relay.Impl(url, protocols);
    } as unknown as typeof WebSocket;
    make({ WebSocketImpl: Impl });
    socket.start();
    expect(relay.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(relay.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(relay.sockets).toHaveLength(1);
    await settled(() => socket.state === "connected");
  });
});

describe("close codes (7.5, FC-23)", () => {
  it("4426 (app too old): asks for an update once, and never reconnects on its own", async () => {
    await connect();
    relay.last.kill(4426);
    expect(updates).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(relay.sockets).toHaveLength(1);
    expect(updates).toBe(1);
  });

  for (const [code, meaning] of [
    [4403, "retired or blocked"],
    [4409, "replaced by a newer socket"],
  ] as const) {
    it(`${code} (${meaning}): never reconnects on its own, and asks for no update`, async () => {
      await connect();
      relay.last.kill(code);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(relay.sockets).toHaveLength(1);
      expect(updates).toBe(0);
    });
  }

  for (const code of [1006, 1012, 4400, 4401, 4408, 4429]) {
    it(`${code}: reconnects after the backoff`, async () => {
      await connect();
      relay.last.kill(code);
      await vi.advanceTimersByTimeAsync(499);
      expect(relay.sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.sockets).toHaveLength(2);
      await settled(() => socket.state === "connected");
      expect(updates).toBe(0);
    });
  }
});

describe("reconnect { afterMs } from a draining relay (8.9, 18.9)", () => {
  it("leaves at once, waits afterMs, then connects and logs in again", async () => {
    await connect();
    const old = relay.last;
    old.push("reconnect", { afterMs: 2_000 });
    expect(old.readyState).toBe(3);
    expect(socket.state).toBe("reconnecting");
    expect(socket.send(aFrame())).toBe(false);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(relay.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.sockets).toHaveLength(2);
    await settled(() => socket.state === "connected");
    expect(frames.map((f) => f.t)).not.toContain("reconnect");
  });

  it("never waits more than 5 s, whatever afterMs says", async () => {
    await connect();
    relay.last.push("reconnect", { afterMs: 600_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.sockets).toHaveLength(2);
  });
});

describe("heartbeat (7.1, C-7.1b)", () => {
  it('sends {t:"ping"} every 25 s while the app is in the foreground, and stays connected while pongs come back', async () => {
    await connect();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(relay.sent("ping")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.sent("ping")).toHaveLength(1);
    const ping = relay.sent("ping")[0]!;
    expect(ping).toMatchObject({ v: 1, t: "ping", body: {} });
    expect(parseClientFrame(JSON.stringify(ping)).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(3 * 25_000);
    expect(relay.sent("ping")).toHaveLength(4);
    expect(relay.sockets).toHaveLength(1);
    expect(socket.state).toBe("connected");
  });

  it("treats a missing pong after 10 s as a dead connection, and reconnects", async () => {
    relay.reply = swallowPings;
    await connect();
    const first = relay.last;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(relay.sent("ping")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(first.readyState).toBe(1);
    expect(socket.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(1);
    expect(first.readyState).toBe(3);
    expect(socket.state).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(relay.sockets).toHaveLength(2);
    await settled(() => socket.state === "connected");
  });

  it("doesn't ping while the app is in the background", async () => {
    const { doc } = browser();
    doc.visibilityState = "hidden";
    await connect();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(relay.sent("ping")).toHaveLength(0);
    expect(relay.sockets).toHaveLength(1);
  });
});

describe("ping() round trip (FC-20)", () => {
  it("measures the time to the relay's pong", async () => {
    relay.reply = (s, f) => {
      if (f.t !== "ping") return;
      setTimeout(() => s.push("pong", { serverTime: Date.now() }), 120);
      return false;
    };
    await connect();
    const rtt = socket.ping();
    await vi.advanceTimersByTimeAsync(120);
    await expect(rtt).resolves.toBe(120);
  });

  it("rejects at once when not logged in, and sends nothing", async () => {
    await expect(socket.ping()).rejects.toThrow();
    expect(relay.frames).toHaveLength(0);
  });

  it("rejects when no pong arrives within 10 s", async () => {
    relay.reply = swallowPings;
    await connect();
    let done = false;
    const outcome = socket.ping().then(
      () => "resolved",
      () => "rejected",
    );
    void outcome.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("rejected");
  });
});

describe("clock offset, for display only (8.7)", () => {
  it("is the relay's clock minus this phone's, from auth.ok and then from every pong", async () => {
    relay.clockAheadMs = 120_000;
    await connect();
    expect(socket.clockOffsetMs).toBe(120_000);
    relay.clockAheadMs = -45_000;
    await vi.advanceTimersByTimeAsync(25_000); // the heartbeat's ping and its pong
    expect(socket.clockOffsetMs).toBe(-45_000);
  });

  it("a relay clock hours away from this phone's changes nothing about the connection", async () => {
    relay.clockAheadMs = 5 * 60 * 60_000;
    await connect();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(socket.state).toBe("connected");
    expect(relay.sockets).toHaveLength(1);
    expect(relay.sent("ping")).toHaveLength(4);
  });
});

describe("sending (8.4)", () => {
  it("send() is refused until the login completes, and again once the connection drops", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    make({
      identity: async () => {
        await gate;
        return me;
      },
    });
    const frame = aFrame();
    expect(socket.send(frame)).toBe(false);
    socket.start();
    await settled(() => socket.hello !== null);
    expect(socket.send(frame)).toBe(false); // connected to the relay, not yet logged in
    release();
    await settled(() => socket.state === "connected");
    expect(socket.send(frame)).toBe(true);
    expect(relay.sent("seen")).toHaveLength(1);
    expect(relay.sent("seen")[0]).toEqual(frame);
    relay.last.kill(1006);
    expect(socket.send(frame)).toBe(false);
    expect(relay.sent("seen")).toHaveLength(1);
  });

  it("a login signed for a connection that was replaced meanwhile is never sent on it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    make({
      identity: async () => {
        await gate;
        return me;
      },
    });
    socket.start();
    const first = relay.last;
    await settled(() => socket.hello !== null); // hello arrived; the login is being prepared
    socket.reconnectNow();
    const second = relay.last;
    expect(second).not.toBe(first);
    await settled(() => second.readyState === 1);
    release();
    await settled(() => socket.state === "connected");
    expect(first.frames.filter((f) => f.t === "auth")).toHaveLength(0);
    expect(second.frames.filter((f) => f.t === "auth")).toHaveLength(1);
  });
});

describe("frames from the relay (7.2, 7.6)", () => {
  it("passes valid frames to the app and ignores malformed or unknown ones", async () => {
    await connect();
    const s = relay.last;
    const raw = (x: unknown) => s.onmessage?.({ data: typeof x === "string" ? x : JSON.stringify(x) });
    raw("not json at all");
    raw("null");
    raw({ v: 1, t: "surprise", id: ulid(), sts: Date.now(), body: {} });
    raw({ v: 1, t: "__proto__", id: ulid(), sts: Date.now(), body: {} });
    raw({ v: 1, t: "toString", id: ulid(), sts: Date.now(), body: {} });
    raw({ v: 1, t: "receipt", id: ulid(), body: { of: ulid(), state: "accepted" } }); // no sts
    raw({ v: 2, t: "receipt", id: ulid(), sts: Date.now(), body: { of: ulid(), state: "accepted" } });
    raw({ v: 1, t: "receipt", id: ulid(), sts: Date.now(), body: { of: ulid(), state: "teleported" } });
    raw({ v: 1, t: "receipt", id: "not-a-ulid", sts: Date.now(), body: { of: ulid(), state: "accepted" } });
    raw({ v: 1, t: "pong", id: ulid(), sts: Date.now(), body: { serverTime: -5 } });
    const good = ulid();
    s.push("receipt", { of: good, state: "delivered", addedInAFutureVersion: true });
    await settled(() => frames.length > 0);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ t: "receipt", body: { of: good, state: "delivered" } });
    expect(socket.state).toBe("connected");
    expect(relay.sockets).toHaveLength(1);
  });
});
