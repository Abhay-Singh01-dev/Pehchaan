// Phase 7: the Security Lab on the relay (spec 14; SEC-09, C-14.1a…, C-14.3a…). Two gateways, real Valkey and
// Postgres, real device keys. A "Lab page" here is a test device that joined with the password.
import { argon2id } from "hash-wasm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TIMING, ulid } from "@pehchaan/protocol";
import { createAdmin } from "../src/admin/commands";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

const PASSWORD = "judging session lab test";
const HOLD_MS = 1500;

let env: Env;
let off: Env;
beforeAll(async () => {
  // A cheap hash (the cost is read from the hash itself): these tests check the rules, not Argon2's cost.
  const hash = await argon2id({
    password: PASSWORD,
    salt: new Uint8Array(16).fill(7),
    parallelism: 1,
    iterations: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: "encoded",
  });
  env = await setupRelays("lab", {
    count: 2,
    // One IP_HASH_KEY for both gateways, as in production: per-IP limits are shared across gateways.
    env: {
      LAB_ENABLED: "true",
      LAB_PASSWORD_HASH: hash,
      LAB_HOLD_MS: String(HOLD_MS),
      IP_HASH_KEY: "ab".repeat(32),
    },
  });
  off = await setupRelays("labOff", { count: 1 });
});
afterAll(async () => {
  await env.cleanup();
  await off.cleanup();
});

const A = () => env.relays[0]!;
const B = () => env.relays[1]!;
const P = () => env.iso.keyPrefix;
const q = (sql: string, args: unknown[] = []) => env.iso.pool.query(sql, args);
const admin = () =>
  createAdmin({
    store: A().hub.store,
    redis: A().hub.redis,
    keys: A().hub.keys,
    bus: A().hub.bus,
    audit: A().hub.audit,
    retire: (d) => A().hub.retire(d, "admin"),
  });

/** Every test starts with the switch on, nothing armed, no opt-ins, sessions or recorded attacks, and fresh
 *  rate limits. (Gateway liveness and routes are left alone: deleting them would cut the two gateways apart.) */
beforeEach(async () => {
  const keys = [
    ...(await env.iso.redis.keys(`${P()}lab:*`)),
    ...(await env.iso.redis.keys(`${P()}rl:*`)),
    `${P()}cfg:lab`,
  ];
  await env.iso.redis.del(...keys);
  await q("delete from lab_attacks");
  await admin().lab(true);
});

/** The next frame of this type that arrives AFTER now (frames already received don't count). */
function nextNew<T extends Parameters<TestClient["type"]>[0]>(
  c: TestClient,
  t: T,
  pred: Parameters<TestClient["type"]>[1] = () => true,
) {
  const start = c.frames.length;
  return c.next((f) => c.frames.indexOf(f) >= start && f.t === t && pred!(f as never));
}

interface Phone {
  d: TestDevice;
  c: TestClient;
}

async function phone(relay = A()): Promise<Phone> {
  const d = await TestDevice.create();
  return { d, c: await d.login(relay) };
}

/** A control message and its outcome: "accepted", or the error code. */
async function control(c: TestClient, t: Parameters<TestClient["send"]>[0], body: Record<string, unknown>) {
  const id = c.send(t, body);
  const f = await c.next((x) => (x.t === "receipt" || x.t === "error") && x.body.of === id);
  return f.t === "receipt" ? "accepted" : (f.body as { code: string }).code;
}

/** Scenes log several test devices in from one IP: give each deliberate, correct password its own budget (the
 *  shared per-IP limit itself is the subject of its own test). */
const resetPasswordLimit = async () => {
  const keys = await env.iso.redis.keys(`${P()}rl:lab_password_ip:*`);
  if (keys.length) await env.iso.redis.del(...keys);
};

async function optIn(p: Phone) {
  await resetPasswordLimit();
  expect(await control(p.c, "lab.optin", { password: PASSWORD })).toBe("accepted");
}

async function labPage(relay = B()): Promise<Phone> {
  const p = await phone(relay);
  await resetPasswordLimit();
  expect(await control(p.c, "lab.join", { password: PASSWORD })).toBe("accepted");
  return p;
}

/** Maa (asker) and Arjun (answerer) opted in, Maa holding Arjun's grant, plus a Lab page on the OTHER gateway. */
async function scene() {
  const [maa, arjun] = [await phone(A()), await phone(A())];
  await optIn(maa);
  await optIn(arjun);
  const lab = await labPage(B());
  await lab.c.type(
    "lab.state",
    (f) => f.body.optedIn.includes(maa.d.deviceId) && f.body.optedIn.includes(arjun.d.deviceId),
  );
  return { maa, arjun, lab };
}

/** Maa asks Arjun (readable, as opted-in phones do): returns the request id. */
async function ask(maa: Phone, arjun: Phone): Promise<string> {
  const r = await maa.d.plainSend("verify.request", arjun.d, { grant: arjun.d.cardGrant });
  maa.c.send("send", r.body, r.id);
  await maa.c.receipt(r.id, "accepted");
  return r.id;
}

/** Arjun answers (decision NOT_ME in the sample payload). */
async function answer(arjun: Phone, maa: Phone, re: string) {
  const r = await arjun.d.plainSend("verify.answer", maa.d, { re });
  arjun.c.send("send", r.body, r.id);
  await arjun.c.receipt(r.id, "accepted");
  return r;
}

const delivered = (p: Phone, kind: string, re: string, timeoutMs = 5000) =>
  p.c.type("deliver", (f) => f.body.kind === kind && f.body.re === re, timeoutMs);

describe("SEC-09 · the Lab can never touch real users' traffic (14.1)", () => {
  it("layer 1: without the module (LAB_ENABLED=false) every lab.* is refused", async () => {
    const d = await TestDevice.create();
    const c = await d.login(off.relays[0]!);
    for (const [t, body] of [
      ["lab.join", { password: PASSWORD }],
      ["lab.optin", { password: PASSWORD }],
      ["lab.optout", {}],
      ["lab.arm", { attack: "change", asker: d.deviceId, answerer: d.deviceId }],
      ["lab.disarm", {}],
      ["lab.release", { heldId: ulid() }],
      ["lab.report", { requestId: ulid(), verdict: "INVALID", failedChecks: [3] }],
    ] as const) {
      expect(await control(c, t, body)).toBe("lab_disabled");
    }
  });

  it("layer 1: with the module but the switch off, every lab.* is refused and nothing is intercepted", async () => {
    const { maa, arjun, lab } = await scene();
    expect(
      await control(lab.c, "lab.arm", { attack: "change", asker: maa.d.deviceId, answerer: arjun.d.deviceId }),
    ).toBe("accepted");
    await admin().lab(false);
    expect(await control(lab.c, "lab.join", { password: PASSWORD })).toBe("lab_disabled");
    expect(await control(maa.c, "lab.optin", { password: PASSWORD })).toBe("lab_disabled");
    // Phones hear that the Lab is off (and stop sending readable envelopes).
    await maa.c.type("lab.state", (f) => !f.body.active && f.body.optedIn.length === 0);
    const re = await ask(maa, arjun);
    await delivered(arjun, "verify.request", re);
    await answer(arjun, maa, re);
    const got = await delivered(maa, "verify.answer", re);
    expect((got.body.plain as { ans: { decision: string } }).ans.decision).toBe("NOT_ME");
    await sleep(200);
    expect(lab.c.all("lab.held")).toHaveLength(0);
    expect(lab.c.all("lab.traffic").filter((f) => f.body.event.requestId === re)).toHaveLength(0);
  });

  it("layer 2: a wrong password is refused, and wrong guesses on lab.join and lab.optin share one limit", async () => {
    const p = await phone(A());
    expect(await control(p.c, "lab.join", { password: "not the password" })).toBe("lab_denied");
    expect(await control(p.c, "lab.optin", { password: "still not it" })).toBe("lab_denied");
    expect(await control(p.c, "lab.join", { password: "third guess" })).toBe("lab_denied");
    // The burst (3) is used up for this IP: even the right password must wait now.
    expect(await control(p.c, "lab.optin", { password: PASSWORD })).toBe("rate_limited");
    const other = await phone(B());
    expect(await control(other.c, "lab.join", { password: PASSWORD })).toBe("rate_limited");
  });

  it("layer 2: only a Lab page with a session may arm, release or inject", async () => {
    const { maa, arjun } = await scene();
    for (const [t, body] of [
      ["lab.arm", { attack: "forge", asker: maa.d.deviceId, answerer: arjun.d.deviceId }],
      ["lab.disarm", {}],
      ["lab.release", { heldId: ulid() }],
      ["lab.inject", { as: arjun.d.deviceId, to: maa.d.deviceId, kind: "verify.answer", re: ulid(), plain: {} }],
    ] as const) {
      expect(await control(maa.c, t, body)).toBe("lab_denied");
    }
  });

  it("layers 3 and 4: a phone that didn't opt in is never seen, held or changed", async () => {
    const lab = await labPage(B());
    const maa = await phone(A());
    const papa = await phone(A());
    await optIn(maa); // Papa never opts in
    expect(
      await control(lab.c, "lab.arm", { attack: "replay", asker: maa.d.deviceId, answerer: papa.d.deviceId }),
    ).toBe("not_allowed");
    const re = await ask(maa, papa);
    await delivered(papa, "verify.request", re);
    await answer(papa, maa, re);
    await delivered(maa, "verify.answer", re);
    await sleep(200);
    expect(lab.c.all("lab.traffic").filter((f) => f.body.event.requestId === re)).toHaveLength(0);
    // …and it can't be used as either end of an injection.
    expect(
      await control(lab.c, "lab.inject", {
        as: papa.d.deviceId,
        to: maa.d.deviceId,
        kind: "verify.answer",
        re,
        plain: {},
      }),
    ).toBe("not_allowed");
  });

  it("layer 3: opting out stops the Lab seeing that phone at once", async () => {
    const { maa, arjun, lab } = await scene();
    expect(await control(arjun.c, "lab.optout", {})).toBe("accepted");
    await arjun.c.type("lab.state", (f) => !f.body.optedIn.includes(arjun.d.deviceId));
    const re = await ask(maa, arjun);
    await delivered(arjun, "verify.request", re);
    await sleep(200);
    expect(lab.c.all("lab.traffic").filter((f) => f.body.event.requestId === re)).toHaveLength(0);
  });

  it("layer 5: joining, opting in and every attack are in audit_events (without payloads)", async () => {
    const { maa, arjun, lab } = await scene();
    await control(lab.c, "lab.arm", { attack: "change", asker: maa.d.deviceId, answerer: arjun.d.deviceId });
    const { rows } = await q("select kind, meta from audit_events where kind like 'lab_%' order by at");
    const kinds = rows.map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["lab_session", "lab_optin", "lab_attack"]));
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });
});

describe("14.2 · sessions, opt-ins and lab.state", () => {
  it("C-14.1a: the switch turns itself off after 12 h at most, a Lab page session after 4 h", async () => {
    const lab = await labPage(B());
    const switchTtl = await env.iso.redis.pttl(`${P()}cfg:lab`);
    expect(switchTtl).toBeGreaterThan(TIMING.LAB_SWITCH_MS - 60_000);
    expect(switchTtl).toBeLessThanOrEqual(12 * 60 * 60_000);
    const sessionTtl = await env.iso.redis.pttl(`${P()}lab:session:${lab.d.deviceId}`);
    expect(sessionTtl).toBeGreaterThan(TIMING.LAB_SESSION_MS - 60_000);
    expect(sessionTtl).toBeLessThanOrEqual(4 * 60 * 60_000);
  });

  it("opt-ins last 4 h, and auth.ok says so", async () => {
    const p = await phone(A());
    await optIn(p);
    const again = await TestClient.open(A());
    const hello = await again.type("hello");
    again.send("auth", await p.d.authBody(hello.body.serverNonce));
    const ok = await again.type("auth.ok");
    expect(ok.body.lab.optedIn).toBe(true);
    expect(ok.body.lab.until! - Date.now()).toBeGreaterThan(TIMING.LAB_OPTIN_MS - 60_000);
    expect(ok.body.lab.until! - Date.now()).toBeLessThanOrEqual(TIMING.LAB_OPTIN_MS);
    // A phone that is opted in gets the Lab state right after logging in.
    await again.type("lab.state", (f) => f.body.active && f.body.optedIn.includes(p.d.deviceId));
  });

  it("a Lab page's session survives a reconnect: it gets lab.state at login and may arm without the password", async () => {
    const lab = await labPage(B());
    const maa = await phone(A());
    const arjun = await phone(A());
    await optIn(maa);
    await optIn(arjun);
    lab.c.close();
    const back = await lab.d.login(A());
    await back.type("lab.state", (f) => f.body.active);
    expect(
      await control(back, "lab.arm", { attack: "change", asker: maa.d.deviceId, answerer: arjun.d.deviceId }),
    ).toBe("accepted");
  });

  it("arming is shown to every Lab page and opted-in phone, on every gateway", async () => {
    const { maa, arjun, lab } = await scene();
    expect(
      await control(lab.c, "lab.arm", { attack: "forge", asker: maa.d.deviceId, answerer: arjun.d.deviceId }),
    ).toBe("accepted");
    for (const c of [lab.c, maa.c, arjun.c]) await c.type("lab.state", (f) => f.body.armed?.attack === "forge");
    const disarmed = nextNew(maa.c, "lab.state", (f) => (f as { body: { armed?: unknown } }).body.armed === null);
    expect(await control(lab.c, "lab.disarm", {})).toBe("accepted");
    await disarmed;
  });

  it("traffic between opted-in phones reaches the Lab page, readable, with the request it belongs to", async () => {
    const { maa, arjun, lab } = await scene();
    const re = await ask(maa, arjun);
    const ev = await lab.c.type("lab.traffic", (f) => f.body.event.requestId === re);
    expect(ev.body.event).toMatchObject({ kind: "request", from: maa.d.deviceId, to: arjun.d.deviceId });
    expect((ev.body.event.payload as { req: { requestId: string } }).req.requestId).toBe(re);
  });
});

describe("14.3 · each attack, end to end through two gateways", () => {
  it("change: the next answer is held; the Lab flips it; the asker gets the changed answer with the old signature", async () => {
    const { maa, arjun, lab } = await scene();
    expect(
      await control(lab.c, "lab.arm", { attack: "change", asker: maa.d.deviceId, answerer: arjun.d.deviceId }),
    ).toBe("accepted");
    const re = await ask(maa, arjun);
    await delivered(arjun, "verify.request", re);
    const sent = await answer(arjun, maa, re);
    const held = await lab.c.type("lab.held", (f) => f.body.frame.body.re === re);
    expect(held.body.attack).toBe("change");
    await sleep(100);
    expect(maa.c.all("deliver").some((f) => f.body.kind === "verify.answer" && f.body.re === re)).toBe(false);
    const plain = held.body.frame.body.plain as { spk: string; ans: Record<string, unknown> };
    const flipped = { ...plain, ans: { ...plain.ans, decision: "ME" } };
    expect(await control(lab.c, "lab.release", { heldId: held.body.heldId, replacement: flipped })).toBe("accepted");
    const got = await delivered(maa, "verify.answer", re);
    const gotAns = (got.body.plain as { ans: Record<string, unknown> }).ans;
    expect(gotAns.decision).toBe("ME");
    // The attacker can't re-sign: everything else, the signature included, is what Arjun sent.
    expect(gotAns.signature).toBe((sent.body.plain as { ans: Record<string, unknown> }).ans.signature);
    await lab.c.type("lab.traffic", (f) => f.body.event.requestId === re && f.body.event.tampered === "change");
    // The hold fired once: the next answer isn't held.
    await lab.c.type("lab.state", (f) => f.body.armed === null);
  });

  it("replay: the request is held and never delivered; the injected old answer reaches the asker, as the target", async () => {
    const { maa, arjun, lab } = await scene();
    expect(
      await control(lab.c, "lab.arm", { attack: "replay", asker: maa.d.deviceId, answerer: arjun.d.deviceId }),
    ).toBe("accepted");
    const re = await ask(maa, arjun);
    const held = await lab.c.type("lab.held", (f) => f.body.heldId === re);
    expect(held.body.attack).toBe("replay");
    const old = arjun.d.samplePayload("verify.answer", maa.d.deviceId, ulid());
    const plain = { ...old, ans: { ...(old.ans as object), requestId: re, decision: "ME" } };
    expect(
      await control(lab.c, "lab.inject", {
        as: arjun.d.deviceId,
        to: maa.d.deviceId,
        kind: "verify.answer",
        re,
        plain,
      }),
    ).toBe("accepted");
    const got = await delivered(maa, "verify.answer", re);
    expect(got.body.from).toBe(arjun.d.deviceId);
    expect(got.body.plain).toEqual(plain);
    // Held and answered: Arjun never gets the request, not even after the hold time.
    await sleep(HOLD_MS + 500);
    expect(arjun.c.all("deliver").some((f) => f.body.re === re)).toBe(false);
  });

  it("an injected answer still goes through the request record: once, only as a target, only to the asker", async () => {
    const { maa, arjun, lab } = await scene();
    const papa = await phone(A());
    await optIn(papa);
    await control(lab.c, "lab.arm", { attack: "forge", asker: maa.d.deviceId, answerer: arjun.d.deviceId });
    const re = await ask(maa, arjun);
    await lab.c.type("lab.held", (f) => f.body.heldId === re);
    const inject = (as: string, to: string, kind = "verify.answer") =>
      control(lab.c, "lab.inject", { as, to, kind, re, plain: arjun.d.samplePayload("verify.answer", to, re) });
    expect(await inject(papa.d.deviceId, maa.d.deviceId)).toBe("not_allowed"); // Papa isn't a target
    expect(await inject(arjun.d.deviceId, papa.d.deviceId)).toBe("not_allowed"); // Papa didn't ask
    expect(await inject(arjun.d.deviceId, maa.d.deviceId, "alert")).toBe("bad_request");
    expect(await inject(arjun.d.deviceId, maa.d.deviceId)).toBe("accepted");
    expect(await inject(arjun.d.deviceId, maa.d.deviceId)).toBe("already_answered");
  });

  it("the Lab page doesn't answer in 10 s: the original goes on unchanged, and it's not counted as an attack", async () => {
    const { maa, arjun, lab } = await scene();
    await control(lab.c, "lab.arm", { attack: "change", asker: maa.d.deviceId, answerer: arjun.d.deviceId });
    const re = await ask(maa, arjun);
    await delivered(arjun, "verify.request", re);
    await answer(arjun, maa, re);
    const held = await lab.c.type("lab.held", (f) => f.body.frame.body.re === re);
    const got = await delivered(maa, "verify.answer", re, HOLD_MS + 3000);
    expect((got.body.plain as { ans: { decision: string } }).ans.decision).toBe("NOT_ME");
    await lab.c.type("lab.state", (f) => f.body.notice === "held_timeout");
    // Too late to release now, and exactly once: the original arrived a single time.
    expect(await control(lab.c, "lab.release", { heldId: held.body.heldId })).toBe("expired");
    expect(maa.c.all("deliver").filter((f) => f.body.re === re && f.body.kind === "verify.answer")).toHaveLength(1);
    expect(await control(maa.c, "lab.report", { requestId: re, verdict: "INVALID", failedChecks: [6] })).toBe(
      "accepted",
    );
    const { rows } = await q("select count(*)::int as n from lab_attacks");
    expect(rows[0].n).toBe(0);
  });
});

describe("14.3–14.4 · reports, results and the false-green counter", () => {
  async function attacked(attack: "change" | "replay" | "forge") {
    const s = await scene();
    await control(s.lab.c, "lab.arm", { attack, asker: s.maa.d.deviceId, answerer: s.arjun.d.deviceId });
    const re = await ask(s.maa, s.arjun);
    const held = await s.lab.c.type("lab.held", (f) => f.body.heldId === re);
    const plain = s.arjun.d.samplePayload("verify.answer", s.maa.d.deviceId, re);
    await control(s.lab.c, "lab.inject", {
      as: s.arjun.d.deviceId,
      to: s.maa.d.deviceId,
      kind: "verify.answer",
      re: held.body.heldId,
      plain,
    });
    await delivered(s.maa, "verify.answer", re);
    return { ...s, re };
  }

  it("the asker's report after its verdict is recorded (lab_attacks), counted, and shown on the Lab page", async () => {
    const { maa, lab, re } = await attacked("forge");
    expect(
      await control(maa.c, "lab.report", {
        requestId: re,
        verdict: "INVALID",
        invalidReason: "wrong_key",
        failedChecks: [2, 6],
      }),
    ).toBe("accepted");
    const result = await lab.c.type("lab.result", (f) => f.body.requestId === re);
    expect(result.body).toMatchObject({
      attack: "forge",
      verdict: "INVALID",
      invalidReason: "wrong_key",
      falseGreen: false,
    });
    await lab.c.type("lab.traffic", (f) => f.body.event.requestId === re && f.body.event.verdictSeen === "INVALID");
    const { rows } = await q("select attack, verdict, invalid_reason, failed_checks, false_green from lab_attacks");
    expect(rows).toEqual([
      { attack: "forge", verdict: "INVALID", invalid_reason: "wrong_key", failed_checks: [2, 6], false_green: false },
    ]);
    const metrics = await A().hub.metrics.registry.getSingleMetricAsString("pehchaan_lab_attacks_total");
    expect(metrics).toMatch(/attack="forge",verdict="INVALID"} 1/);
  });

  it("a VERIFIED report for a tampered check is a false green: counted, logged as critical, never hidden", async () => {
    const { maa, lab, re } = await attacked("replay");
    await control(maa.c, "lab.report", { requestId: re, verdict: "VERIFIED", failedChecks: [] });
    const result = await lab.c.type("lab.result", (f) => f.body.requestId === re);
    expect(result.body.falseGreen).toBe(true);
    const { rows } = await q("select false_green from lab_attacks");
    expect(rows).toEqual([{ false_green: true }]);
    expect(env.logs.join("")).toContain("FALSE GREEN");
  });

  it("only the asker, opted in, may report on its own request", async () => {
    const { maa, arjun, re } = await attacked("forge");
    expect(await control(arjun.c, "lab.report", { requestId: re, verdict: "INVALID", failedChecks: [2] })).toBe(
      "not_allowed",
    );
    await control(maa.c, "lab.optout", {});
    expect(await control(maa.c, "lab.report", { requestId: re, verdict: "INVALID", failedChecks: [2] })).toBe(
      "not_allowed",
    );
  });
});
