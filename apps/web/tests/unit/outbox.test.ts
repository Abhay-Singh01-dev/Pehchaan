// The outbox (backend spec 7.5, 8.4, 8.9; FC-6; APP-08): every message is sent at once when possible and re-sent
// with the SAME frame every 2 s until the relay settles it; a rate limit holds it back for retryAfterMs; when its
// time runs out it is dropped and reported; answers are kept in IndexedDB so a reload can't lose one. Timing runs
// on a fake clock; the IndexedDB tests use the real one (fake-indexeddb, set up in setup.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "@pehchaan/protocol";
import { Outbox, type OutboxEntry } from "@/services/real/relay/outbox";
import { db, type OutboxRow } from "@/store/db";

let sent: object[];
let up: boolean;
let expired: OutboxEntry[];

/** The socket: accepts a frame only while logged in. */
const send = (frame: object): boolean => {
  if (!up) return false;
  sent.push(frame);
  return true;
};

const outbox = (withDb = true) => new Outbox(send, withDb ? db : null, (e) => expired.push(e));

function entry(o: { ttlMs?: number; persist?: boolean; kind?: string } = {}) {
  const id = ulid();
  const kind = o.kind ?? "verify.answer";
  return {
    id,
    kind,
    frame: { v: 1, t: "send", id, ts: Date.now(), body: { kind, to: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F", re: ulid(), ttlMs: 0 } },
    expiresAt: Date.now() + (o.ttlMs ?? 60_000),
    persist: o.persist ?? false,
  };
}

/** Polls IndexedDB (real time) until the row appears or disappears. */
async function rowSoon(id: string, present = true): Promise<OutboxRow | undefined> {
  for (let i = 0; i < 200; i++) {
    const row = await db.outbox.get(id);
    if (Boolean(row) === present) return row;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`outbox row ${id} never ${present ? "appeared" : "went away"}`);
}

beforeEach(async () => {
  sent = [];
  up = true;
  expired = [];
  await db.outbox.clear();
});

describe("re-sending until the relay answers (8.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("sends a new message at once when the connection is up", () => {
    const box = outbox(false);
    const e = entry();
    box.add(e);
    expect(sent).toEqual([e.frame]);
    expect(box.has(e.id)).toBe(true);
  });

  it("re-sends the SAME frame every 2 s until the relay settles it, then never again", async () => {
    const box = outbox(false);
    box.start();
    const e = entry();
    box.add(e);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(3);
    for (const f of sent) expect(f).toBe(e.frame); // same id, same bytes: the relay deduplicates by id
    box.settle(e.id);
    expect(box.has(e.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(3);
    box.stop();
  });

  it("re-sends 2 s after the previous attempt, whatever moment the message was added", async () => {
    const box = outbox(false);
    box.start();
    await vi.advanceTimersByTimeAsync(700);
    const e = entry();
    box.add(e); // first attempt at 0.7 s
    await vi.advanceTimersByTimeAsync(2_000); // 2.7 s: one retry period later
    expect(sent).toHaveLength(2);
    box.stop();
  });

  it("a message that couldn't go out (not logged in) is sent by the next flush", async () => {
    up = false;
    const box = outbox(false);
    box.start();
    const e = entry();
    box.add(e);
    expect(sent).toHaveLength(0);
    up = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual([e.frame]);
    box.stop();
  });

  it("flush(force), as after a login, re-sends at once; a normal flush waits for the 2 s", () => {
    const box = outbox(false);
    const e = entry();
    box.add(e);
    box.flush();
    expect(sent).toHaveLength(1);
    box.flush(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(e.frame);
  });

  it("start() twice doesn't double the re-sending, and stop() ends it", async () => {
    const box = outbox(false);
    box.start();
    box.start();
    box.add(entry());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(2);
    box.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(2);
  });

  it("settle() and holdOff() for a message it doesn't hold are harmless", () => {
    const box = outbox(false);
    expect(() => box.settle(ulid())).not.toThrow();
    expect(() => box.holdOff(ulid(), 5_000)).not.toThrow();
    box.flush(true);
    expect(sent).toHaveLength(0);
  });
});

describe("rate limits: wait for retryAfterMs (7.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("holds a message back until retryAfterMs has passed, even through a forced flush, then re-sends the same frame", async () => {
    const box = outbox(false);
    box.start();
    const e = entry();
    box.add(e);
    box.holdOff(e.id, 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    box.flush(true);
    expect(sent).toHaveLength(1);
    // After the wait it goes out again within one retry period: exactly once in [5.0 s, 7.0 s). (At 7.0 s
    // itself the next 2 s re-send is due, which 8.4 allows.)
    await vi.advanceTimersByTimeAsync(1 + 1_999);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(e.frame);
    box.stop();
  });
});

describe("expiry: the TTL passes (8.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("drops a message whose time has run out, reports it once, and never sends it again", async () => {
    const box = outbox(false);
    box.start();
    const e = entry({ ttlMs: 3_000, kind: "verify.request" });
    box.add(e);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ id: e.id, kind: "verify.request" });
    expect(box.has(e.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(2);
    expect(expired).toHaveLength(1);
    box.stop();
  });

  it("reports a message that expired before it could ever be sent", async () => {
    up = false;
    const box = outbox(false);
    box.start();
    const e = entry({ ttlMs: 1_000 });
    box.add(e);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0);
    expect(expired.map((x) => x.id)).toEqual([e.id]);
    box.stop();
  });
});

describe("answers survive a reload (8.4)", () => {
  it("keeps a persist: true message in IndexedDB, and a new outbox re-sends the same frame after load()", async () => {
    up = false; // offline: the answer can't go out before the "reload"
    const before = outbox();
    const e = entry({ persist: true });
    before.add(e);
    const row = await rowSoon(e.id);
    expect(row).toMatchObject({ id: e.id, kind: "verify.answer", expiresAt: e.expiresAt });
    expect(JSON.parse(row!.frame)).toEqual(e.frame);

    up = true;
    const after = outbox(); // the app was reloaded
    await after.load();
    expect(after.has(e.id)).toBe(true);
    after.flush(true);
    expect(sent).toEqual([e.frame]);
    expect((sent[0] as { id: string }).id).toBe(e.id);
  });

  it("forgets the stored copy once the relay settles the message", async () => {
    const box = outbox();
    const e = entry({ persist: true });
    box.add(e);
    await rowSoon(e.id);
    box.settle(e.id);
    await rowSoon(e.id, false);
  });

  it("never stores a message that isn't marked persist", async () => {
    const box = outbox();
    const keep = entry({ persist: true });
    const skip = entry({ persist: false });
    box.add(skip);
    box.add(keep);
    await rowSoon(keep.id);
    expect(await db.outbox.get(skip.id)).toBeUndefined();
  });

  it("drops (and deletes) stored messages whose time ran out while the app was closed", async () => {
    const stale = entry({ persist: true });
    const fresh = entry({ persist: true });
    await db.outbox.bulkPut([
      { id: stale.id, kind: stale.kind, frame: JSON.stringify(stale.frame), expiresAt: Date.now() - 1, createdAt: 1 },
      { id: fresh.id, kind: fresh.kind, frame: JSON.stringify(fresh.frame), expiresAt: fresh.expiresAt, createdAt: 1 },
    ]);
    const box = outbox();
    await box.load();
    expect(box.has(stale.id)).toBe(false);
    expect(box.has(fresh.id)).toBe(true);
    expect(await db.outbox.get(stale.id)).toBeUndefined();
    box.flush(true);
    expect(sent).toEqual([fresh.frame]);
  });

  it("a restored message that then runs out of time is reported and deleted", async () => {
    const e = entry({ persist: true });
    await db.outbox.put({
      id: e.id,
      kind: e.kind,
      frame: JSON.stringify(e.frame),
      expiresAt: Date.now() + 30,
      createdAt: 1,
    });
    up = false;
    const box = outbox();
    await box.load();
    await new Promise((r) => setTimeout(r, 60));
    box.flush();
    expect(expired.map((x) => x.id)).toEqual([e.id]);
    await rowSoon(e.id, false);
  });

  it("without a database, load() does nothing and messages still go out", async () => {
    await db.outbox.put({ id: "x", kind: "verify.answer", frame: "{}", expiresAt: Date.now() + 60_000, createdAt: 1 });
    const box = outbox(false);
    await box.load();
    expect(box.has("x")).toBe(false);
    const e = entry({ persist: true });
    box.add(e);
    expect(sent).toEqual([e.frame]);
  });
});
