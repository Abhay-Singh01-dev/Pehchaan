// RealLab (backend spec 14.2–14.4, FC-21): the Security Lab page against the relay's Lab protocol. The relay is a
// stand-in that records the page's lab.* commands and plays the relay's lab.* frames. Every attack the page builds
// is then checked by the REAL verifier, exactly as the asker's phone would: none may ever come out VERIFIED.
import { beforeEach, describe, expect, it } from "vitest";
import { createSoftCredential, softAnswer, type SoftCredential } from "@pehchaan/crypto/soft-authenticator";
import type { RelayBody, RelayFrame } from "@pehchaan/protocol";
import { appConfig } from "@/app/config";
import { db } from "@/store/db";
import { RelayError } from "@/services/errors";
import { newIdentity } from "@/services/identity";
import { createRequestFactory } from "@/services/requests";
import { createSimVerifier } from "@/services/sim/SimVerifier";
import { RealLab } from "@/services/real/RealLab";
import type { RealRelay } from "@/services/real/relay/RealRelay";
import { answerPayload, requestPayload } from "@/services/real/relay/envelope";
import type { IdentityRow } from "@/store/db";
import type { FamilyMember, LabStatus, RelayEvent, VerifyRequest, WireAnswer } from "@/services/types";

type LabFrame = Extract<RelayFrame, { t: `lab.${string}` }>;

const verifier = createSimVerifier(db);
const requests = createRequestFactory();

let maa: IdentityRow;
let arjunId: IdentityRow;
let arjunKey: SoftCredential;
let arjun: FamilyMember;

class FakeRelay {
  commands: Array<{ t: string; body: Record<string, unknown> }> = [];
  refuse: string | null = null;
  connected: string[] = [];
  private cb: ((f: LabFrame) => void) | null = null;
  onLabFrame(cb: (f: LabFrame) => void) {
    this.cb = cb;
    return () => (this.cb = null);
  }
  async labCommand(t: string, body: Record<string, unknown>) {
    this.commands.push({ t, body });
    if (this.refuse) throw new RelayError("rejected", this.refuse);
  }
  connect(deviceId: string) {
    this.connected.push(deviceId);
  }
  play<T extends LabFrame["t"]>(t: T, body: RelayBody<T>) {
    this.cb?.({ v: 1, t, id: "01JB0000000000000000000000", sts: Date.now(), body } as LabFrame);
  }
  async waitFor(t: string) {
    for (let i = 0; i < 400; i++) {
      const c = this.commands.find((x) => x.t === t);
      if (c) return c;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no ${t}`);
  }
}

let relay: FakeRelay;
let lab: RealLab;
let status: LabStatus;
let events: RelayEvent[];

function newRequest(): VerifyRequest {
  return requests.create({
    from: { deviceId: maa.deviceId, name: "Sunita" },
    member: arjun,
    reason: "money",
    amountInr: 50_000,
  });
}

const genuine = (req: VerifyRequest, decision: "ME" | "NOT_ME") =>
  softAnswer({
    req,
    decision,
    credId: arjunKey.credId,
    privateKey: arjunKey.privateKey,
    rpId: appConfig.rpId,
    origin: appConfig.origin,
  });

/** What the asker's phone decides about an answer: the real verifier, the saved card for Arjun. */
const verdictOf = async (req: VerifyRequest, ans: WireAnswer) =>
  verifier.verify({
    req,
    incoming: { sealOk: true, envFrom: arjun.deviceId, re: req.requestId, receivedAt: Date.now(), ans },
    member: arjun,
  });

/** The relay holds Maa's next request for the armed attack. */
function holdRequest(req: VerifyRequest, attack: "replay" | "forge") {
  relay.play("lab.held", {
    heldId: req.requestId,
    attack,
    frame: {
      v: 1,
      t: "deliver",
      id: req.requestId,
      sts: Date.now(),
      body: {
        from: maa.deviceId,
        kind: "verify.request",
        re: req.requestId,
        ttlMs: 50_000,
        plain: requestPayload(req, maa),
      },
    },
  });
}

/** Arjun's genuine answer passes through the relay (and the Lab sees it). */
function seeAnswer(req: VerifyRequest, ans: WireAnswer, extra: Partial<RelayBody<"lab.traffic">["event"]> = {}) {
  relay.play("lab.traffic", {
    event: {
      id: `ans-${req.requestId}`,
      at: Date.now(),
      kind: "answer",
      from: arjun.deviceId,
      to: maa.deviceId,
      summary: "answer",
      payload: answerPayload(ans, arjunId),
      requestId: req.requestId,
      ...extra,
    },
  });
}

beforeEach(async () => {
  await Promise.all([db.meta.clear(), db.labAttacks.clear(), db.usedNonces.clear(), db.identity.clear()]);
  [maa, arjunId] = await Promise.all([newIdentity(), newIdentity()]);
  await db.identity.put({ ...maa, id: "me" } as IdentityRow);
  arjunKey = await createSoftCredential();
  arjun = {
    v: 2,
    id: "m_arjun",
    deviceId: arjunId.deviceId,
    name: "Arjun Sharma",
    color: "indigo",
    canBeVerified: true,
    devicePub: arjunId.devicePub,
    encPub: arjunId.encPub,
    grant: `${arjunId.grantId}.${arjunId.grantSecret}`,
    keyType: "pk",
    keyId: arjunKey.credId,
    publicKey: arjunKey.publicKey,
    createdAt: 1,
    safetyWords: ["ABLE", "BABY", "CABIN", "DANCE"],
    label: "Arjun",
    relation: "son",
    addedAt: 1,
    addedBy: "in_person",
  };
  relay = new FakeRelay();
  lab = new RealLab(relay as unknown as RealRelay, db);
  events = [];
  lab.onStatus((s) => (status = s));
  lab.onTraffic((e) => events.push(e));
  lab.start();
  relay.play("lab.state", { active: true, optedIn: [maa.deviceId, arjun.deviceId], since: 1 });
  lab.setRoles({ askerDeviceId: maa.deviceId, targetDeviceId: arjun.deviceId });
  await new Promise((r) => setTimeout(r, 20));
});

describe("joining (14.1 layer 2)", () => {
  it("asks for the password, joins, and remembers the 4-hour session across a reload", async () => {
    expect(lab.needsPassword).toBe(true);
    expect(status.joined).toBe(false);
    await lab.join!("judging session lab");
    expect(relay.commands[0]).toEqual({ t: "lab.join", body: { password: "judging session lab" } });
    expect(status.joined).toBe(true);
    const again = new RealLab(relay as unknown as RealRelay, db);
    let s: LabStatus | undefined;
    again.onStatus((x) => (s = x));
    again.start();
    await new Promise((r) => setTimeout(r, 20));
    again.stop();
    expect(s?.joined).toBe(true);
  });

  it("a wrong password is reported, and a session the relay no longer knows asks for the password again", async () => {
    relay.refuse = "lab_denied";
    await expect(lab.join!("wrong")).rejects.toMatchObject({ reason: "lab_denied" });
    expect(status).toMatchObject({ joined: false, notice: "lab_denied" });
    relay.refuse = null;
    await lab.join!("right");
    relay.refuse = "lab_denied";
    lab.disarm();
    await new Promise((r) => setTimeout(r, 20));
    expect(status.joined).toBe(false);
  });

  it("the Lab page connects its own device to the relay (it isn't inside the family app)", () => {
    expect(relay.connected).toEqual([maa.deviceId]);
  });
});

describe("what the page shows", () => {
  it("names phones from the traffic (the relay knows no names) and follows who can be verified", async () => {
    const req = newRequest();
    relay.play("lab.traffic", {
      event: {
        id: req.requestId,
        at: Date.now(),
        kind: "request",
        from: maa.deviceId,
        to: arjun.deviceId,
        summary: "request",
        payload: requestPayload(req, maa),
        requestId: req.requestId,
      },
    });
    let peers: Array<{ deviceId: string; name: string; canBeVerified?: boolean }> = [];
    lab.onPeers((p) => (peers = p));
    expect(peers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: maa.deviceId, name: "Sunita" }),
        expect.objectContaining({ deviceId: arjun.deviceId, name: "Arjun", canBeVerified: true }),
      ]),
    );
    expect(events[0]!.summary).toMatch(/^request · Money ₹50,000 · nonce /);
    expect((events[0]!.payload as { fromDeviceId: string }).fromDeviceId).toBe(maa.deviceId);
  });

  it("a phone's verdict report marks the answer rows of that request", async () => {
    const req = newRequest();
    seeAnswer(req, await genuine(req, "ME"));
    relay.play("lab.traffic", {
      event: {
        id: `verdict-${req.requestId}`,
        at: Date.now(),
        kind: "answer",
        from: maa.deviceId,
        to: maa.deviceId,
        summary: "",
        requestId: req.requestId,
        verdictSeen: "VERIFIED",
      },
    });
    expect(events.at(-1)).toMatchObject({ id: `ans-${req.requestId}`, verdictSeen: "VERIFIED" });
    expect(events.filter((e) => e.id.startsWith("verdict-"))).toEqual([]);
  });
});

describe("14.3 · every attack, checked by the real verifier", () => {
  beforeEach(async () => {
    await lab.join!("judging session lab");
  });

  it("change: the held answer's decision is flipped, the signature left alone → INVALID changed", async () => {
    lab.arm("change");
    expect((await relay.waitFor("lab.arm")).body).toEqual({
      attack: "change",
      asker: maa.deviceId,
      answerer: arjun.deviceId,
    });
    const req = newRequest();
    const no = await genuine(req, "NOT_ME");
    relay.play("lab.held", {
      heldId: "01JB0000000000000000000001",
      attack: "change",
      frame: {
        v: 1,
        t: "deliver",
        id: "01JB0000000000000000000001",
        sts: Date.now(),
        body: {
          from: arjun.deviceId,
          kind: "verify.answer",
          re: req.requestId,
          ttlMs: 50_000,
          plain: answerPayload(no, arjunId),
        },
      },
    });
    const release = await relay.waitFor("lab.release");
    const changed = (release.body.replacement as { ans: WireAnswer }).ans;
    expect(changed).toEqual({ ...no, decision: "ME" });
    const v = await verdictOf(req, changed);
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toBe("changed");
  });

  it("replay: Arjun's earlier genuine YES is injected as the answer to the new request → INVALID reused", async () => {
    const first = newRequest();
    const yes = await genuine(first, "ME");
    seeAnswer(first, yes);
    expect((await verdictOf(first, yes)).verdict).toBe("VERIFIED"); // the genuine one, once
    expect(status.canReplay).toBe(true);
    lab.arm("replay");
    const req = newRequest();
    holdRequest(req, "replay");
    const inject = await relay.waitFor("lab.inject");
    expect(inject.body).toMatchObject({
      as: arjun.deviceId,
      to: maa.deviceId,
      kind: "verify.answer",
      re: req.requestId,
    });
    const replayed = (inject.body.plain as { ans: WireAnswer }).ans;
    expect(replayed).toEqual({ ...yes, requestId: req.requestId });
    const v = await verdictOf(req, replayed);
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toBe("reused");
  });

  it("shows Armed only once the relay has accepted it (a check sent before that isn't held)", async () => {
    let accept!: () => void;
    const pending = new Promise<void>((r) => (accept = r));
    relay.labCommand = async (t: string, body: Record<string, unknown>) => {
      relay.commands.push({ t, body });
      await pending;
    };
    lab.arm("forge");
    await relay.waitFor("lab.arm");
    expect(status.armed).toBeNull();
    accept();
    await new Promise((r) => setTimeout(r, 10));
    expect(status.armed).toBe("forge");
  });

  it("a refused arm is never shown as armed", async () => {
    relay.refuse = "not_allowed";
    lab.arm("forge");
    await relay.waitFor("lab.arm");
    await new Promise((r) => setTimeout(r, 10));
    expect(status).toMatchObject({ armed: null, notice: "not_allowed" });
  });

  it("replay can't be armed before the Lab has seen a genuine YES", () => {
    lab.arm("replay");
    expect(relay.commands.some((c) => c.t === "lab.arm")).toBe(false);
  });

  it("forge: a perfect-looking YES signed with a fresh key made in WebCrypto → INVALID wrong_key", async () => {
    lab.arm("forge");
    const req = newRequest();
    holdRequest(req, "forge");
    const inject = await relay.waitFor("lab.inject");
    const forged = (inject.body.plain as { ans: WireAnswer }).ans;
    expect(forged).toMatchObject({ requestId: req.requestId, nonce: req.nonce, decision: "ME" });
    expect(forged.credId).not.toBe(arjunKey.credId);
    const v = await verdictOf(req, forged);
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toBe("wrong_key");
  });

  it("forge with Arjun's real credential ID copied → still INVALID, bad_signature", async () => {
    const earlier = newRequest();
    seeAnswer(earlier, await genuine(earlier, "NOT_ME")); // the Lab learns his credential ID from the traffic
    lab.arm("forge", { copyCredId: true });
    const req = newRequest();
    holdRequest(req, "forge");
    const inject = await relay.waitFor("lab.inject");
    const forged = (inject.body.plain as { ans: WireAnswer }).ans;
    expect(forged.credId).toBe(arjunKey.credId);
    const v = await verdictOf(req, forged);
    expect(v.verdict).toBe("INVALID");
    expect(v.invalidReason).toBe("bad_signature");
    expect((await db.labAttacks.toArray()).at(-1)).toMatchObject({ attack: "forge", copiedCredId: true });
  });

  it("a sealed message can't be rebuilt: it is released unchanged", async () => {
    lab.arm("forge");
    const req = newRequest();
    relay.play("lab.held", {
      heldId: req.requestId,
      attack: "forge",
      frame: {
        v: 1,
        t: "deliver",
        id: req.requestId,
        sts: 1,
        body: { from: maa.deviceId, kind: "verify.request", re: req.requestId, ttlMs: 1000 },
      },
    });
    expect((await relay.waitFor("lab.release")).body).toEqual({ heldId: req.requestId });
    expect(relay.commands.some((c) => c.t === "lab.inject")).toBe(false);
  });
});

describe("14.4 · results, the log and the false-green counter", () => {
  it("records each attack, fills in what the phone showed, and counts false greens (which must stay 0)", async () => {
    await lab.join!("pw");
    let counters = { attacks: 0, falseGreens: 0 };
    lab.onCounters((c) => (counters = c));
    lab.arm("forge");
    const req = newRequest();
    holdRequest(req, "forge");
    await relay.waitFor("lab.inject");
    await new Promise((r) => setTimeout(r, 20));
    expect(counters).toEqual({ attacks: 1, falseGreens: 0 });
    relay.play("lab.result", {
      attack: "forge",
      requestId: req.requestId,
      verdict: "INVALID",
      invalidReason: "wrong_key",
      failedChecks: [2, 6],
      falseGreen: false,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(status.lastAttack).toMatchObject({
      attack: "forge",
      verdictSeen: "INVALID",
      invalidReason: "wrong_key",
      failedChecks: [2, 6],
    });
    expect(await lab.attackLog()).toHaveLength(1);
    relay.play("lab.result", {
      attack: "forge",
      requestId: req.requestId,
      verdict: "VERIFIED",
      failedChecks: [],
      falseGreen: true,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(counters.falseGreens).toBe(1);
  });

  it("the relay's notices reach the page (the Lab didn't respond in time; the Lab was switched off)", async () => {
    relay.play("lab.state", { active: true, optedIn: [], since: 1, notice: "held_timeout" });
    expect(status.notice).toBe("held_timeout");
    await lab.join!("pw");
    relay.play("lab.state", { active: false, optedIn: [], since: 1 });
    expect(status.joined).toBe(false);
  });
});
