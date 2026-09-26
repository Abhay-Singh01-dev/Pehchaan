// Envelopes (backend spec 7.4, 9.1–9.5, 10.2; FC-7; C-9.5a, SEC-05): wrap/unwrap for every kind with real device
// identities and the real security core. Opening fails closed: a changed ciphertext, a header that isn't the one
// that was sealed, a sender key that isn't the envelope's sender (or my saved card for them), readable `plain`
// where it isn't allowed or isn't signed, and a payload that doesn't match its schema are all unreadable.
import { beforeAll, describe, expect, it } from "vitest";
import { canonical, canonicalRequest } from "@pehchaan/crypto/canonical";
import { parsePayload, ulid, type DeliverBody, type Kind } from "@pehchaan/protocol";
import {
  alertPayload,
  answerPayload,
  promptPayload,
  requestPayload,
  unwrap,
  wireRequest,
  wrap,
} from "@/services/real/relay/envelope";
import { newIdentity } from "@/services/identity";
import { createRequestFactory } from "@/services/requests";
import type { IdentityRow } from "@/store/db";
import type { FamilyAlert, FamilyMember, GuardPrompt, VerifyRequest, WireAnswer } from "@/services/types";

const requests = createRequestFactory();
let maa: IdentityRow; // the asker, and the sender in most tests
let arjun: IdentityRow; // this phone: the recipient
let other: IdentityRow; // a third device (a stranger, or the relay's own key)
let req: VerifyRequest;

const b64 = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64url");

function anAnswer(r: VerifyRequest, decision: "ME" | "NOT_ME" = "NOT_ME"): WireAnswer {
  return {
    requestId: r.requestId,
    nonce: r.nonce,
    decision,
    keyType: "pk",
    credId: b64(16),
    authenticatorData: b64(37),
    clientDataJSON: b64(120),
    signature: b64(71),
    answeredAt: 1_761_900_004_000,
  };
}

const anAlert = (): FamilyAlert => ({
  id: "alert_7Qx",
  type: "impersonation",
  aboutDeviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F",
  aboutLabel: "Arjun",
  victimName: "Sunita",
  victimPhone: "+919812345678",
  amountInr: 50_000,
  createdAt: 1_761_900_000_000,
  read: false,
});

const aPrompt = (): GuardPrompt => ({
  claimedLabel: "Arjun",
  claimedDeviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F",
  amountInr: 20_000,
  tactics: ["urgency", "money"],
  at: 1_761_900_000_000,
});

interface Send {
  kind: Kind;
  payload: object;
  re?: string;
  /** Who the envelope says it is from (the relay-authenticated sender). Default: maa. */
  from?: IdentityRow;
  /** Whose device key signs it. Default: the sender. */
  signer?: IdentityRow;
  /** The recipient named in the sealed header. Default: arjun. */
  to?: string;
  mode?: "e2e" | "plain";
}

/** Seals (or signs as plain) exactly as the sender's phone does, and returns the deliver body the relay forwards. */
async function envelope(s: Send): Promise<{ id: string; body: DeliverBody }> {
  const from = s.from ?? maa;
  const id = ulid();
  const header = { kind: s.kind, id, from: from.deviceId, to: s.to ?? arjun.deviceId, ...(s.re ? { re: s.re } : {}) };
  const sealed = await wrap(s.payload, header, s.signer ?? from, arjun.encPub, s.mode ?? "e2e");
  return { id, body: { from: from.deviceId, kind: s.kind, ...(s.re ? { re: s.re } : {}), ttlMs: 45_000, ...sealed } };
}

const open = <K extends Kind>(
  kind: K,
  body: DeliverBody,
  id: string,
  o: { acceptPlain?: boolean; knownSenderDk?: string } = {},
) =>
  unwrap(kind, body, id, arjun, {
    acceptPlain: o.acceptPlain ?? false,
    ...(o.knownSenderDk ? { knownSenderDk: o.knownSenderDk } : {}),
  });

beforeAll(async () => {
  [maa, arjun, other] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  req = {
    ...requests.create({
      from: { deviceId: maa.deviceId, name: "Sunita", phone: "+919800000001" },
      member: { deviceId: arjun.deviceId, label: "Arjun" } as FamilyMember,
      reason: "money",
      amountInr: 50_000,
    }),
  };
});

describe("sealing and opening every kind (9.2)", () => {
  const cases = () =>
    [
      { kind: "verify.request", payload: requestPayload(req, maa), re: req.requestId },
      { kind: "verify.answer", payload: answerPayload(anAnswer(req), maa), re: req.requestId },
      { kind: "alert", payload: alertPayload(anAlert(), maa) },
      { kind: "guard.prompt", payload: promptPayload(aPrompt(), maa) },
    ] as const;

  for (const kind of ["verify.request", "verify.answer", "alert", "guard.prompt"] as const) {
    it(`${kind}: the recipient opens exactly what was sealed, and the relay sees none of it`, async () => {
      const c = cases().find((x) => x.kind === kind)!;
      const { id, body } = await envelope({ kind: c.kind, payload: c.payload, ...("re" in c ? { re: c.re } : {}) });
      expect(body.e2e).toBeDefined();
      expect(body.plain).toBeUndefined();
      expect(body.psig).toBeUndefined();
      const wire = JSON.stringify(body);
      for (const secret of ["Sunita", "Arjun", "50000", "20000", "+919812345678", req.nonce]) {
        expect(wire).not.toContain(secret);
      }
      const o = await open(kind, body, id, { knownSenderDk: maa.devicePub });
      expect(o).toEqual({ ok: true, plain: false, payload: c.payload });
    });
  }

  it("opens without a saved card too (the sender isn't in my family list, like a judge's phone)", async () => {
    const { id, body } = await envelope({
      kind: "verify.request",
      payload: requestPayload(req, maa),
      re: req.requestId,
    });
    const o = await open("verify.request", body, id);
    expect(o.ok).toBe(true);
  });

  it("plain, between two Lab-opted-in phones, opens when this phone accepts plain (9.5)", async () => {
    for (const c of cases()) {
      const { id, body } = await envelope({
        kind: c.kind,
        payload: c.payload,
        ...("re" in c ? { re: c.re } : {}),
        mode: "plain",
      });
      expect(body.e2e).toBeUndefined();
      expect(body.psig).toMatch(/^[A-Za-z0-9_-]{86}$/);
      const o = await open(c.kind, body, id, { acceptPlain: true, knownSenderDk: maa.devicePub });
      expect(o).toEqual({ ok: true, plain: true, payload: c.payload });
    }
  });
});

describe("opening fails closed (9.2–9.4)", () => {
  const sealedRequest = () =>
    envelope({ kind: "verify.request", payload: requestPayload(req, maa), re: req.requestId });

  const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

  it("a ciphertext changed in transit", async () => {
    const { id, body } = await sealedRequest();
    const o = await open("verify.request", { ...body, e2e: { ...body.e2e!, ct: flip(body.e2e!.ct) } }, id);
    expect(o).toEqual({ ok: false });
  });

  it("an iv, ephemeral key or sender signature changed in transit", async () => {
    const { id, body } = await sealedRequest();
    for (const field of ["iv", "epk", "sig"] as const) {
      const o = await open("verify.request", { ...body, e2e: { ...body.e2e!, [field]: flip(body.e2e![field]) } }, id);
      expect(o, field).toEqual({ ok: false });
    }
  });

  it("an unknown algorithm", async () => {
    const { id, body } = await sealedRequest();
    const o = await open("verify.request", { ...body, e2e: { ...body.e2e!, alg: "none" } }, id);
    expect(o).toEqual({ ok: false });
  });

  it("a different frame id than the one sealed (a replayed or re-labelled envelope)", async () => {
    const { body } = await sealedRequest();
    expect(await open("verify.request", body, ulid())).toEqual({ ok: false });
  });

  it("a different sender than the one sealed (the relay claims someone else sent it)", async () => {
    const { id, body } = await sealedRequest();
    expect(await open("verify.request", { ...body, from: other.deviceId }, id)).toEqual({ ok: false });
  });

  it("a header naming another recipient than this phone", async () => {
    const { id, body } = await envelope({
      kind: "verify.request",
      payload: requestPayload(req, maa),
      re: req.requestId,
      to: other.deviceId,
    });
    expect(await open("verify.request", body, id)).toEqual({ ok: false });
  });

  it("a different request id (re) than the one sealed, or none at all", async () => {
    const { id, body } = await sealedRequest();
    expect(await open("verify.request", { ...body, re: ulid() }, id)).toEqual({ ok: false });
    const { re: _dropped, ...withoutRe } = body;
    expect(await open("verify.request", withoutRe, id)).toEqual({ ok: false });
  });

  it("a different kind than the one sealed (an alert opened as a Call Guard prompt)", async () => {
    const { id, body } = await envelope({ kind: "alert", payload: alertPayload(anAlert(), maa) });
    expect(await open("guard.prompt", { ...body, kind: "guard.prompt" }, id)).toEqual({ ok: false });
  });

  it("a sender key that doesn't match my saved card for that person", async () => {
    const { id, body } = await sealedRequest();
    expect(await open("verify.request", body, id, { knownSenderDk: other.devicePub })).toEqual({ ok: false });
    expect((await open("verify.request", body, id, { knownSenderDk: maa.devicePub })).ok).toBe(true);
  });

  it("a request the relay forged: Maa's public keys in the payload, but sealed and signed with the relay's key", async () => {
    const { id, body } = await envelope({
      kind: "verify.request",
      payload: requestPayload(req, maa),
      re: req.requestId,
      signer: other,
    });
    expect(await open("verify.request", body, id)).toEqual({ ok: false });
  });

  it("a payload whose signing key isn't the envelope's sender", async () => {
    // A real device, signing honestly with its own key, but the envelope says it came from Maa.
    const payload = requestPayload(req, other);
    const { id, body } = await envelope({ kind: "verify.request", payload, re: req.requestId, signer: other });
    expect(await open("verify.request", body, id)).toEqual({ ok: false });
  });

  it("a validly sealed payload that doesn't match its schema: never trusted just because the seal verified (9.3)", async () => {
    const good = requestPayload(req, maa);
    const bad: Array<[string, object]> = [
      ["an unknown field", { ...good, req: { ...good.req, fromPhone: "+919800000001" } }],
      ["a missing field", { spk: good.spk, sek: good.sek, req: good.req }],
      ["a wrong type", { ...good, req: { ...good.req, createdAt: "yesterday" } }],
    ];
    for (const [what, payload] of bad) {
      const { id, body } = await envelope({ kind: "verify.request", payload, re: req.requestId });
      expect(await open("verify.request", body, id), what).toEqual({ ok: false });
    }
    const answer = { ...answerPayload(anAnswer(req), maa), ans: { ...anAnswer(req), decision: "MAYBE" } };
    const a = await envelope({ kind: "verify.answer", payload: answer, re: req.requestId });
    expect(await open("verify.answer", a.body, a.id)).toEqual({ ok: false });
  });

  it("an envelope with neither a seal nor plain", async () => {
    const { id, body } = await sealedRequest();
    const { e2e: _e2e, ...empty } = body;
    expect(await open("verify.request", empty, id, { acceptPlain: true })).toEqual({ ok: false });
  });
});

describe("refuse plain unless this phone is in the Security Lab (9.5, C-9.5a)", () => {
  it("downgrade: readable envelopes of every kind are refused when this phone doesn't accept plain (SEC-05)", async () => {
    const all = [
      { kind: "verify.request" as const, payload: requestPayload(req, maa), re: req.requestId },
      { kind: "verify.answer" as const, payload: answerPayload(anAnswer(req), maa), re: req.requestId },
      { kind: "alert" as const, payload: alertPayload(anAlert(), maa) },
      { kind: "guard.prompt" as const, payload: promptPayload(aPrompt(), maa) },
    ];
    for (const c of all) {
      const { id, body } = await envelope({ ...c, mode: "plain" }); // correctly signed by Maa
      expect(await open(c.kind, body, id, { acceptPlain: false }), c.kind).toEqual({ ok: false });
    }
  });

  it("a plain request, alert or prompt without a sender signature is refused", async () => {
    const all = [
      { kind: "verify.request" as const, payload: requestPayload(req, maa), re: req.requestId },
      { kind: "alert" as const, payload: alertPayload(anAlert(), maa) },
      { kind: "guard.prompt" as const, payload: promptPayload(aPrompt(), maa) },
    ];
    for (const c of all) {
      const { id, body } = await envelope({ ...c, mode: "plain" });
      const { psig: _psig, ...unsigned } = body;
      expect(await open(c.kind, unsigned, id, { acceptPlain: true }), c.kind).toEqual({ ok: false });
    }
  });

  it("a plain request, alert or prompt with a bad sender signature is refused", async () => {
    const r = await envelope({
      kind: "verify.request",
      payload: requestPayload(req, maa),
      re: req.requestId,
      mode: "plain",
    });
    // The payload changed after signing (the relay rewrites the claimed label).
    const changed = { ...r.body, plain: { ...r.body.plain, fromName: "Bank Manager" } };
    expect(await open("verify.request", changed, r.id, { acceptPlain: true })).toEqual({ ok: false });
    // The signature was made for another header (a different frame id).
    expect(await open("verify.request", r.body, ulid(), { acceptPlain: true })).toEqual({ ok: false });
    // Signed by a key that isn't the sender's (the relay fabricating "Maa is asking").
    const forged = await envelope({
      kind: "verify.request",
      payload: requestPayload(req, maa),
      re: req.requestId,
      signer: other,
      mode: "plain",
    });
    expect(await open("verify.request", forged.body, forged.id, { acceptPlain: true })).toEqual({ ok: false });
    // Correctly signed, but not by the key on my saved card for Maa.
    expect(await open("verify.request", r.body, r.id, { acceptPlain: true, knownSenderDk: other.devicePub })).toEqual({
      ok: false,
    });
    // Garbage in place of a signature.
    const a = await envelope({ kind: "alert", payload: alertPayload(anAlert(), maa), mode: "plain" });
    expect(await open("alert", { ...a.body, psig: "x".repeat(86) }, a.id, { acceptPlain: true })).toEqual({
      ok: false,
    });
    const p = await envelope({ kind: "guard.prompt", payload: promptPayload(aPrompt(), maa), mode: "plain" });
    expect(await open("guard.prompt", { ...p.body, psig: a.body.psig! }, p.id, { acceptPlain: true })).toEqual({
      ok: false,
    });
  });

  it("a plain answer is accepted without psig: the passkey and the 7 checks authenticate answers", async () => {
    const ans = anAnswer(req, "NOT_ME");
    const { id, body } = await envelope({
      kind: "verify.answer",
      payload: answerPayload(ans, maa),
      re: req.requestId,
      mode: "plain",
    });
    const { psig: _psig, ...unsigned } = body;
    const o = await open("verify.answer", unsigned, id, { acceptPlain: true });
    expect(o).toEqual({ ok: true, plain: true, payload: { spk: maa.devicePub, ans } });
    // The Security Lab's altered answer (NOT_ME → ME) reaches the verifier, which is where it gets caught.
    const altered = { ...body, plain: { ...body.plain, ans: { ...ans, decision: "ME" } }, psig: "x".repeat(86) };
    const o2 = await open("verify.answer", altered, id, { acceptPlain: true });
    expect(o2.ok && o2.payload.ans.decision).toBe("ME");
  });

  it("a plain answer that doesn't match its schema is still refused", async () => {
    const { id, body } = await envelope({
      kind: "verify.answer",
      payload: answerPayload(anAnswer(req), maa),
      re: req.requestId,
      mode: "plain",
    });
    const bad = { ...body, plain: { ...body.plain, extra: true } };
    expect(await open("verify.answer", bad, id, { acceptPlain: true })).toEqual({ ok: false });
  });
});

describe("payloads (7.4, 10.2)", () => {
  it("the wire request carries exactly the signed fields: nothing display-only (fromPhone, fromName, fromLabel, channel)", () => {
    const w = wireRequest(req);
    expect(Object.keys(w).sort()).toEqual(
      [
        "v",
        "requestId",
        "nonce",
        "fromDeviceId",
        "toDeviceId",
        "claimedLabel",
        "reason",
        "amountInr",
        "createdAt",
        "expiresAt",
      ].sort(),
    );
    expect(w.v).toBe(1);
    // Byte-for-byte the canonical request both phones hash (10.2): the answerer signs exactly what Maa sent.
    expect(canonical(w)).toBe(canonicalRequest(req));
    const wire = JSON.stringify(w);
    for (const local of ["Sunita", "+919800000001"]) expect(wire).not.toContain(local);
  });

  it("a request without a reason or amount carries neither field", () => {
    const plainReq = requests.create({
      from: { deviceId: maa.deviceId, name: "Sunita" },
      member: { deviceId: arjun.deviceId, label: "बेटा" } as FamilyMember,
    });
    const w = wireRequest(plainReq);
    expect("reason" in w).toBe(false);
    expect("amountInr" in w).toBe(false);
    expect(canonical(w)).toBe(canonicalRequest(plainReq));
    expect(parsePayload("verify.request", requestPayload(plainReq, maa))).not.toBeNull();
  });

  it("a request payload names the sender's keys and name next to the wire request", () => {
    const p = requestPayload(req, maa);
    expect(p).toEqual({ spk: maa.devicePub, sek: maa.encPub, fromName: "Sunita", req: wireRequest(req) });
    expect(parsePayload("verify.request", p)).not.toBeNull();
  });

  it("an answer payload is the sender's key and the answer, unchanged", () => {
    const ans = anAnswer(req, "ME");
    expect(answerPayload(ans, arjun)).toEqual({ spk: arjun.devicePub, ans });
    expect(parsePayload("verify.answer", answerPayload(ans, arjun))).not.toBeNull();
  });

  it("an alert payload carries the sender's keys and the alert fields, and matches its schema with or without the optional ones", () => {
    const full = alertPayload(anAlert(), maa);
    expect(full).toEqual({
      spk: maa.devicePub,
      sek: maa.encPub,
      alert: {
        id: "alert_7Qx",
        type: "impersonation",
        aboutDeviceId: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F",
        aboutLabel: "Arjun",
        victimName: "Sunita",
        victimPhone: "+919812345678",
        amountInr: 50_000,
        createdAt: 1_761_900_000_000,
      },
    });
    expect(parsePayload("alert", full)).not.toBeNull();
    const bare = alertPayload(
      { id: "alert_2", type: "check_on", aboutLabel: "Arjun", victimName: "", createdAt: 1, read: false },
      maa,
    );
    expect(Object.keys(bare.alert).sort()).toEqual(["aboutLabel", "createdAt", "id", "type", "victimName"]);
    // A sender with no name yet must still produce an alert the recipient can read.
    expect(parsePayload("alert", bare)).not.toBeNull();
  });

  it("a Call Guard prompt payload matches its schema with or without the optional fields", () => {
    const full = promptPayload(aPrompt(), maa);
    expect(full).toEqual({ spk: maa.devicePub, prompt: { ...aPrompt() } });
    expect(parsePayload("guard.prompt", full)).not.toBeNull();
    const bare = promptPayload({ claimedLabel: "Arjun", tactics: [], at: 5 }, maa);
    expect(bare.prompt).toEqual({ claimedLabel: "Arjun", tactics: [], at: 5 });
    expect(parsePayload("guard.prompt", bare)).not.toBeNull();
  });
});
