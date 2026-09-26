// REL-09 request records; REL-10 answers and FIRST ANSWER WINS; REL-11 cancel; REL-17 open requests;
// C-8.6a answered elsewhere; C-6.4b answers need no binding; SEC-03 an answer from a non-target is refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIMING, ulid } from "@pehchaan/protocol";
import { TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("requests", { count: 2 });
});
afterAll(() => env.cleanup());

const A = () => env.relays[0]!;
const B = () => env.relays[1]!;
const P = () => env.iso.keyPrefix;

async function asked(ttlMs = 60_000) {
  const maa = await TestDevice.create();
  const arjun = await TestDevice.create();
  const a = await arjun.login(B());
  const m = await maa.login(A());
  const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant, ttlMs });
  m.send("send", req.body, req.id);
  await m.receipt(req.id, "accepted");
  await a.type("deliver", (f) => f.id === req.id);
  return { maa, arjun, m, a, req, re: req.re! };
}

describe("REL-09 · request records", () => {
  it("records who asked whom and the deadline on the relay's clock, clamped to 10–60 s", async () => {
    for (const [ttl, expected] of [
      [5_000, 10_000],
      [30_000, 30_000],
      [120_000, 60_000],
    ] as const) {
      const t0 = Date.now();
      const { maa, arjun, m, a, re } = await asked(ttl);
      const rec = await env.iso.redis.hgetall(`${P()}rq:${re}`);
      expect(rec).toMatchObject({ from: maa.deviceId, to: arjun.deviceId, state: "open" });
      const deadline = Number(rec.deadline);
      expect(deadline - t0).toBeGreaterThanOrEqual(expected - 50);
      expect(deadline - Date.now()).toBeLessThanOrEqual(expected);
      // The record lives until the deadline + 90 s.
      const pttl = await env.iso.redis.pttl(`${P()}rq:${re}`);
      expect(pttl).toBeGreaterThan(expected + TIMING.RECORD_EXTRA_MS - 5000);
      expect(pttl).toBeLessThanOrEqual(expected + TIMING.RECORD_EXTRA_MS);
      m.close();
      a.close();
    }
  });

  it("a reused request ID is refused with duplicate_request", async () => {
    const { maa, arjun, m, a, re } = await asked();
    const again = await maa.plainSend("verify.request", arjun, { re, grant: arjun.cardGrant }); // new message id
    m.send("send", again.body, again.id);
    expect((await m.error(again.id)).body.code).toBe("duplicate_request");
    m.close();
    a.close();
  });

  it("REL-17 · a 4th open request from one device is refused", async () => {
    const maa = await TestDevice.create();
    const m = await maa.login(A());
    const targets = await Promise.all([1, 2, 3, 4].map(() => TestDevice.create()));
    for (const t of targets) (await t.login(A())).close();
    const ids: string[] = [];
    for (const t of targets) {
      const r = await maa.plainSend("verify.request", t, { grant: t.cardGrant });
      m.send("send", r.body, r.id);
      ids.push(r.id);
    }
    for (const id of ids.slice(0, 3)) await m.receipt(id, "accepted");
    const e = await m.error(ids[3]!);
    expect(e.body.code).toBe("rate_limited");
    expect(e.body.retryAfterMs).toBeGreaterThan(0);
    m.close();
  });
});

describe("REL-10 · answers", () => {
  it("only the target may answer, and only to the asker (SEC-03)", async () => {
    const { maa, m, a, arjun, re } = await asked();
    const priya = await TestDevice.create();
    const p = await priya.login(A());
    const fromStranger = await priya.plainSend("verify.answer", maa, { re });
    p.send("send", fromStranger.body, fromStranger.id);
    expect((await p.error(fromStranger.id)).body.code).toBe("not_allowed");
    const toSomeoneElse = await arjun.plainSend("verify.answer", priya, { re });
    a.send("send", toSomeoneElse.body, toSomeoneElse.id);
    expect((await a.error(toSomeoneElse.id)).body.code).toBe("not_allowed");
    [m, a, p].forEach((c) => c.close());
  });

  it("C-6.4b · the answerer needs no binding to the asker", async () => {
    const { maa, arjun, m, a, re } = await asked();
    // Arjun never added Maa: no binding "maa ← arjun" exists, yet his answer goes through.
    const rows = await env.iso.pool.query("select 1 from contact_bindings where target_device_id = $1", [maa.deviceId]);
    expect(rows.rowCount).toBe(0);
    const ans = await arjun.plainSend("verify.answer", maa, { re });
    a.send("send", ans.body, ans.id);
    await m.type("deliver", (f) => f.id === ans.id);
    m.close();
    a.close();
  });

  it("already_answered, cancelled and expired", async () => {
    const one = await asked();
    const first = await one.arjun.plainSend("verify.answer", one.maa, { re: one.re });
    one.a.send("send", first.body, first.id);
    await one.a.receipt(first.id, "accepted");
    const second = await one.arjun.plainSend("verify.answer", one.maa, { re: one.re });
    one.a.send("send", second.body, second.id);
    expect((await one.a.error(second.id)).body.code).toBe("already_answered");

    const two = await asked();
    two.m.send("cancel", { re: two.re });
    await two.a.type("deliver", (f) => f.body.kind === "verify.cancel");
    const late = await two.arjun.plainSend("verify.answer", two.maa, { re: two.re });
    two.a.send("send", late.body, late.id);
    expect((await two.a.error(late.id)).body.code).toBe("cancelled");

    const none = await two.arjun.plainSend("verify.answer", two.maa, { re: ulid() });
    two.a.send("send", none.body, none.id);
    expect((await two.a.error(none.id)).body.code).toBe("expired");
    [one.m, one.a, two.m, two.a].forEach((c) => c.close());
  });

  it("an answer within the 30 s grace is forwarded with late: true (ok_late)", async () => {
    const { maa, arjun, m, a, re } = await asked(10_000);
    await sleep(10_300);
    const ans = await arjun.plainSend("verify.answer", maa, { re });
    a.send("send", ans.body, ans.id);
    const got = await m.type("deliver", (f) => f.id === ans.id);
    expect(got.body.late).toBe(true);
    m.close();
    a.close();
  }, 30_000);

  it("after deadline + 30 s the answer is refused as expired", async () => {
    const { maa, arjun, m, a, re } = await asked(10_000);
    // Move the record's deadline back so it lies more than 30 s in the past (the relay's own clock decides).
    await env.iso.redis.hset(`${P()}rq:${re}`, "deadline", String(Date.now() - 31_000));
    const ans = await arjun.plainSend("verify.answer", maa, { re });
    a.send("send", ans.body, ans.id);
    expect((await a.error(ans.id)).body.code).toBe("expired");
    m.close();
    a.close();
  });

  it("the 50-way race: exactly one answer is accepted", async () => {
    const { maa, arjun, m, a, re } = await asked();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        (i % 2 ? A() : B()).hub.requests.answer(re, arjun.deviceId, maa.deviceId, Date.now()),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const reasons = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code);
    expect(new Set(reasons)).toEqual(new Set(["already_answered"]));
    m.close();
    a.close();
  });

  it("the race on the wire (3 sockets of one device): one accepted, the rest already_answered", async () => {
    const { maa, arjun, m, a, re } = await asked();
    const tabs = [a, await arjun.login(A()), await arjun.login(B())];
    const answers = await Promise.all(tabs.map(() => arjun.plainSend("verify.answer", maa, { re })));
    answers.forEach((ans, i) => tabs[i]!.send("send", ans.body, ans.id));
    const outcomes = await Promise.all(
      answers.map((ans, i) =>
        Promise.race([
          tabs[i]!.receipt(ans.id, "accepted").then(() => "accepted"),
          tabs[i]!.error(ans.id).then((e) => e.body.code),
        ]),
      ),
    );
    expect(outcomes.filter((o) => o === "accepted")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_answered")).toHaveLength(2);
    await sleep(300);
    expect(m.all("deliver").filter((f) => f.body.kind === "verify.answer")).toHaveLength(1);
    [m, ...tabs].forEach((c) => c.close());
  });
});

describe("C-8.6a · multi-device: the other targets are told `answered_elsewhere`", () => {
  it("sends verify.cancel { answered_elsewhere } to every other target", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const tablet = await TestDevice.create();
    const a = await arjun.login(A());
    const t = await tablet.login(B());
    // A v2-style record with two targets (8.11); the relay logic is already multi-target.
    const re = ulid();
    await A().hub.requests.create(re, maa.deviceId, [arjun.deviceId, tablet.deviceId], Date.now() + 60_000, Date.now());
    const m = await maa.login(A());
    const ans = await arjun.plainSend("verify.answer", maa, { re });
    a.send("send", ans.body, ans.id);
    await a.receipt(ans.id, "accepted");
    const c = await t.type("deliver", (f) => f.body.kind === "verify.cancel");
    expect(c.body).toMatchObject({ re, from: maa.deviceId, system: { reason: "answered_elsewhere" } });
    [a, t, m].forEach((x) => x.close());
  });
});

describe("REL-11 · cancel", () => {
  it("only the asker may cancel; targets get verify.cancel { asker_cancelled }; the state becomes cancelled", async () => {
    const { m, a, re } = await asked();
    const id = a.send("cancel", { re });
    expect((await a.error(id)).body.code).toBe("not_allowed");
    const ok = m.send("cancel", { re });
    await m.receipt(ok, "accepted");
    const c = await a.type("deliver", (f) => f.body.kind === "verify.cancel");
    expect(c.body.system).toEqual({ reason: "asker_cancelled" });
    expect(await env.iso.redis.hget(`${P()}rq:${re}`, "state")).toBe("cancelled");
    // The cancelled request no longer counts toward the asker's 3 open requests.
    expect(
      await env.iso.redis.zscore(`${P()}oq:${(await env.iso.redis.hget(`${P()}rq:${re}`, "from"))!}`, re),
    ).toBeNull();
    const again = m.send("cancel", { re });
    expect((await m.error(again)).body.code).toBe("cancelled");
    m.close();
    a.close();
  });
});
