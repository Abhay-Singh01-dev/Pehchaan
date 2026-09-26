// PRO-01: every message and payload type: a valid sample passes; unknown fields, oversized strings and bad
// ID formats are rejected. C-7.2a: unknown `t` values are rejected by the outer envelope.
import { describe, expect, it } from "vitest";
import {
  CLIENT_BODIES,
  CLIENT_TYPES,
  clientFrame,
  KINDS,
  PAYLOADS,
  parseClientFrame,
  parsePayload,
  parseRelayFrame,
  RELAY_BODIES,
  RELAY_TYPES,
  relayFrame,
  sealed,
  type ClientType,
  type RelayType,
} from "../src/index";
import { clientBodies, frame, ID, KEY, NONCE, payloads, relayBodies, sealedSample, SIG } from "./samples";

describe("PRO-01 · app → relay messages", () => {
  it("has a sample for every message type, and every sample parses", () => {
    expect(Object.keys(clientBodies).sort()).toEqual([...CLIENT_TYPES].sort());
    for (const t of CLIENT_TYPES) {
      const r = parseClientFrame(frame(t, clientBodies[t]));
      expect(r.ok, t).toBe(true);
    }
  });

  it("rejects an unknown field in every body (strict)", () => {
    for (const t of CLIENT_TYPES) {
      const body = { ...(clientBodies[t] as object), extra: 1 };
      const r = parseClientFrame(frame(t, body));
      expect(r, t).toMatchObject({ ok: false, reason: "body" });
    }
  });

  it("rejects an unknown field on the envelope, and wrong envelope types", () => {
    const f = JSON.parse(frame("ping", {}));
    expect(parseClientFrame(JSON.stringify({ ...f, extra: 1 }))).toMatchObject({
      ok: false,
      reason: "envelope",
      id: f.id,
    });
    expect(parseClientFrame(JSON.stringify({ ...f, v: 2 }))).toMatchObject({ ok: false, reason: "envelope" });
    expect(parseClientFrame(JSON.stringify({ ...f, ts: -1 }))).toMatchObject({ ok: false });
    expect(parseClientFrame(JSON.stringify({ ...f, id: "not-a-ulid" }))).toEqual({ ok: false, reason: "envelope" });
  });

  it("C-7.2a · rejects unknown t values", () => {
    const r = parseClientFrame(frame("admin.shutdown", {}));
    expect(r).toMatchObject({ ok: false, reason: "envelope" });
  });

  it("returns the id of a frame whose body is bad, so the relay can say which one", () => {
    const f = JSON.parse(frame("ack", { of: "x" }));
    expect(parseClientFrame(JSON.stringify(f))).toEqual({ ok: false, id: f.id, reason: "body" });
  });

  it("rejects non-JSON, JSON that isn't an object, and null", () => {
    expect(parseClientFrame("{")).toEqual({ ok: false, reason: "json" });
    expect(parseClientFrame("[]")).toEqual({ ok: false, reason: "envelope" });
    expect(parseClientFrame("null")).toEqual({ ok: false, reason: "envelope" });
  });

  it("rejects bad ID formats", () => {
    const bad: Array<[ClientType, unknown]> = [
      ["ack", { of: "01jb7y8q3z6n4v5w2k9c0d1e2f" }], // lower case isn't Crockford ULID
      ["ack", { of: "01JB7Y8Q3Z6N4V5W2K9C0D1E2" }], // 25 chars
      ["ack", { of: "01JB7Y8Q3Z6N4V5W2K9C0D1E2I" }], // I is not in the alphabet
      ["contact.revoke", { deviceId: "short" }],
      ["contact.revoke", { deviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F=" }],
      ["presence.query", { ids: ["x"] }],
      ["auth", { ...(clientBodies.auth as object), devicePub: KEY.slice(1) }],
      ["auth", { ...(clientBodies.auth as object), sig: SIG + "A" }],
    ];
    for (const [t, body] of bad) expect(parseClientFrame(frame(t, body)).ok, JSON.stringify(body)).toBe(false);
  });

  it("rejects oversized strings and lists", () => {
    const bad: Array<[ClientType, unknown]> = [
      ["lab.join", { password: "x".repeat(257) }],
      ["presence.query", { ids: Array(51).fill(ID.arjun) }],
      ["presence.query", { ids: [] }],
      ["push.subscribe", { ...(clientBodies["push.subscribe"] as object), endpoint: "https://" + "a".repeat(1100) }],
      ["auth", { ...(clientBodies.auth as object), client: { ver: "1.0.0" + "x".repeat(40), platform: "x" } }],
      ["auth", { ...(clientBodies.auth as object), client: { ver: "one", platform: "android-chrome" } }],
      ["auth", { ...(clientBodies.auth as object), client: { ver: "1.0.0", platform: "Android Chrome" } }],
      ["lab.report", { requestId: ID.req, verdict: "INVALID", failedChecks: [3, 3] }],
      ["lab.report", { requestId: ID.req, verdict: "INVALID", failedChecks: [8] }],
      ["push.subscribe", { ...(clientBodies["push.subscribe"] as object), vapidKeyId: "v 1" }],
    ];
    for (const [t, body] of bad) expect(parseClientFrame(frame(t, body)).ok, t).toBe(false);
  });

  describe("send", () => {
    const base = clientBodies.send as Record<string, unknown>;
    const plainAnswer = {
      kind: "verify.answer",
      to: ID.maa,
      re: ID.req,
      ttlMs: 0,
      plain: payloads["verify.answer"],
      psig: SIG,
    };

    it("accepts e2e, or plain with psig", () => {
      expect(parseClientFrame(frame("send", base)).ok).toBe(true);
      expect(parseClientFrame(frame("send", plainAnswer)).ok).toBe(true);
      const alert = { kind: "alert", to: ID.arjun, ttlMs: 0, plain: payloads.alert, psig: SIG };
      expect(parseClientFrame(frame("send", alert)).ok).toBe(true); // re isn't needed for alerts
    });

    it("rejects both e2e and plain, or neither", () => {
      expect(parseClientFrame(frame("send", { ...plainAnswer, e2e: sealedSample })).ok).toBe(false);
      const { e2e: _e, ...neither } = base;
      expect(parseClientFrame(frame("send", neither)).ok).toBe(false);
    });

    it("rejects plain without psig, and psig with e2e", () => {
      const { psig: _p, ...noSig } = plainAnswer;
      expect(parseClientFrame(frame("send", noSig)).ok).toBe(false);
      expect(parseClientFrame(frame("send", { ...base, psig: SIG })).ok).toBe(false);
    });

    it("requires re for requests and answers", () => {
      const { re: _r, ...noRe } = base;
      expect(parseClientFrame(frame("send", noRe)).ok).toBe(false);
      const { re: _r2, ...answerNoRe } = plainAnswer;
      expect(parseClientFrame(frame("send", answerNoRe)).ok).toBe(false);
    });

    it("rejects a plain payload that doesn't match its kind", () => {
      expect(parseClientFrame(frame("send", { ...plainAnswer, kind: "alert" })).ok).toBe(false);
    });

    it("limits ttlMs and the sealed ciphertext (8 KiB)", () => {
      expect(parseClientFrame(frame("send", { ...base, ttlMs: 86_400_001 })).ok).toBe(false);
      expect(parseClientFrame(frame("send", { ...base, ttlMs: 1.5 })).ok).toBe(false);
      const big = { ...sealedSample, ct: "A".repeat(10_924) };
      expect(parseClientFrame(frame("send", { ...base, e2e: big })).ok).toBe(false);
      expect(sealed.safeParse({ ...sealedSample, ct: "A".repeat(10_923) }).success).toBe(true);
      expect(sealed.safeParse({ ...sealedSample, iv: "AAAA" }).success).toBe(false);
    });
  });

  it("clientFrame builds an envelope the parser accepts", () => {
    const f = clientFrame("seen", ID.msg, { re: ID.req }, 5);
    expect(f).toEqual({ v: 1, t: "seen", id: ID.msg, ts: 5, body: { re: ID.req } });
    expect(parseClientFrame(JSON.stringify(f)).ok).toBe(true);
    expect(clientFrame("ping", ID.msg, {}).ts).toBeGreaterThan(0);
  });

  it("every body schema is exported", () => {
    expect(Object.keys(CLIENT_BODIES)).toHaveLength(23);
  });
});

describe("PRO-01 · payloads", () => {
  it("a valid sample of each kind passes", () => {
    expect(Object.keys(payloads).sort()).toEqual([...KINDS].sort());
    for (const k of KINDS) expect(parsePayload(k, payloads[k]), k).not.toBeNull();
  });

  it("rejects unknown fields at every level", () => {
    for (const k of KINDS) {
      expect(parsePayload(k, { ...payloads[k], extra: 1 }), k).toBeNull();
    }
    const r = payloads["verify.request"];
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, fromPhone: "+91 1" } })).toBeNull();
    const a = payloads["verify.answer"];
    expect(parsePayload("verify.answer", { ...a, ans: { ...a.ans, userVerified: true } })).toBeNull();
  });

  it("rejects bad values", () => {
    const r = payloads["verify.request"];
    const a = payloads["verify.answer"];
    const al = payloads.alert;
    const g = payloads["guard.prompt"];
    expect(parsePayload("verify.request", { ...r, fromName: "x".repeat(41) })).toBeNull();
    expect(parsePayload("verify.request", { ...r, fromName: "   " })).toBeNull();
    expect(parsePayload("verify.request", { ...r, fromName: "Sunita\n" })).toBeNull();
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, v: 2 } })).toBeNull();
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, nonce: NONCE.slice(1) } })).toBeNull();
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, amountInr: 1.5 } })).toBeNull();
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, amountInr: 0 } })).toBeNull();
    expect(parsePayload("verify.request", { ...r, req: { ...r.req, reason: "gift" } })).toBeNull();
    expect(parsePayload("verify.answer", { ...a, ans: { ...a.ans, decision: "MAYBE" } })).toBeNull();
    expect(parsePayload("verify.answer", { ...a, ans: { ...a.ans, signature: "!!" } })).toBeNull();
    expect(parsePayload("verify.answer", { ...a, ans: { ...a.ans, keyType: "pin" } })).not.toBeNull();
    expect(parsePayload("alert", { ...al, alert: { ...al.alert, type: "other" } })).toBeNull();
    expect(parsePayload("alert", { ...al, alert: { ...al.alert, id: "has space" } })).toBeNull();
    expect(parsePayload("alert", { ...al, alert: { ...al.alert, victimPhone: "1\u0007" } })).toBeNull();
    expect(parsePayload("guard.prompt", { ...g, prompt: { ...g.prompt, tactics: ["bribery"] } })).toBeNull();
    expect(parsePayload("guard.prompt", { ...g, prompt: { ...g.prompt, tactics: Array(7).fill("money") } })).toBeNull();
    expect(Object.keys(PAYLOADS)).toEqual([...KINDS]);
  });
});

describe("PRO-01 · relay → app messages (parsed leniently, 7.6)", () => {
  it("has a sample for every type, and every sample parses", () => {
    expect(Object.keys(relayBodies).sort()).toEqual([...RELAY_TYPES].sort());
    for (const t of RELAY_TYPES) {
      const f = relayFrame(t as RelayType, ID.msg, relayBodies[t] as never, 7);
      const parsed = parseRelayFrame(JSON.stringify(f));
      expect(parsed?.t, t).toBe(t);
      expect(parsed?.sts).toBe(7);
    }
    expect(relayFrame("pong", ID.msg, { serverTime: 1 }).sts).toBeGreaterThan(0);
  });

  it("ignores unknown fields instead of rejecting (outbound notices)", () => {
    const f = relayFrame("pong", ID.msg, { serverTime: 1, newField: "x" } as never, 1);
    expect(parseRelayFrame(JSON.stringify({ ...f, extra: true }))).toEqual({
      v: 1,
      t: "pong",
      id: ID.msg,
      sts: 1,
      body: { serverTime: 1 },
    });
  });

  it("returns null for unknown types, bad bodies and non-JSON", () => {
    expect(parseRelayFrame(JSON.stringify(relayFrame("pong" as RelayType, ID.msg, {} as never)))).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ v: 1, t: "future.thing", id: ID.msg, sts: 1, body: {} }))).toBeNull();
    expect(parseRelayFrame("{")).toBeNull();
    expect(parseRelayFrame("[]")).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ v: 1, t: "toString", id: ID.msg, sts: 1, body: {} }))).toBeNull();
  });

  it("a deliver frame can carry a system notice", () => {
    const f = relayFrame(
      "deliver",
      ID.msg,
      { from: ID.maa, kind: "verify.cancel", re: ID.req, ttlMs: 60000, system: { reason: "asker_cancelled" } },
      1,
    );
    expect(parseRelayFrame(JSON.stringify(f))?.t).toBe("deliver");
  });

  it("every relay body schema is exported", () => {
    expect(Object.keys(RELAY_BODIES)).toHaveLength(13);
  });
});
