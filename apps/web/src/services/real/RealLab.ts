// RealLab (backend spec 14, FC-21): the Security Lab page against the real relay.
//
// The Lab page is its own device (its own device key on the laptop). It joins with the Lab password (a 4-hour
// session), then sees every message between phones that opted in to the Lab, and can have the relay hold, change
// or inject messages:
//   change  the relay holds the next answer; this page flips its decision and leaves the signature alone
//           → the asker's phone shows INVALID changed
//   replay  the relay holds the next request and never delivers it; this page injects the person's earlier
//           genuine "Yes" as the answer → INVALID reused
//   forge   the relay holds the next request; this page builds a perfect-looking "Yes" signed with a fresh key
//           made here in WebCrypto (or with the person's real credential ID copied) → INVALID wrong_key
//           (bad_signature)
// The asker's phone runs the normal verifier on whatever arrives. The relay then tells this page what that phone
// showed (lab.result); nothing here can influence the verdict. A "false green" (VERIFIED for a tampered check)
// must always stay 0.
import { createSoftCredential, softAnswer } from "@pehchaan/crypto/soft-authenticator";
import { ulid, type ClientBody, type RelayBody, type RelayFrame } from "@pehchaan/protocol";
import { appConfig } from "@/app/config";
import type { PehchaanDB } from "@/store/db";
import { RelayError } from "../errors";
import type {
  AttackKind,
  LabAttackRecord,
  LabService,
  LabStatus,
  PeerInfo,
  RelayEvent,
  Unsubscribe,
  WireAnswer,
} from "../types";
import { summarize } from "../labSummary";
import type { LabCommand, RealRelay } from "./relay/RealRelay";

type Listener<T> = (v: T) => void;
type LabRelayFrame = Extract<RelayFrame, { t: `lab.${string}` }>;
type WireRequest = {
  requestId: string;
  nonce: string;
  fromDeviceId: string;
  toDeviceId: string;
  claimedLabel: string;
  reason?: string;
  amountInr?: number;
  createdAt: number;
  expiresAt: number;
};

/** A genuine "Yes" seen in the traffic, kept to replay, with the sender key that came with it. */
interface SeenYes {
  ans: WireAnswer;
  spk: string;
}

export class RealLab implements LabService {
  readonly needsPassword = true;
  private joined = false;
  private active = true;
  private attackerMode = false;
  private armed: AttackKind | null = null;
  private armedRoles: { asker: string; answerer: string } | null = null;
  private copyCredId = false;
  private roles: { askerDeviceId?: string; targetDeviceId?: string } = {};
  private optedIn: string[] = [];
  private notice: string | undefined;
  private since = Date.now();
  private lastYes: Record<string, SeenYes> = {};
  private credIds: Record<string, string> = {};
  private names: Record<string, string> = {};
  private verifiable = new Set<string>();
  private attacks: LabAttackRecord[] = [];
  private lastAttack: LabAttackRecord | null = null;
  private events = new Map<string, RelayEvent>();
  private offs: Unsubscribe[] = [];

  private ls = {
    traffic: new Set<Listener<RelayEvent>>(),
    counters: new Set<Listener<{ attacks: number; falseGreens: number }>>(),
    status: new Set<Listener<LabStatus>>(),
    peers: new Set<Listener<PeerInfo[]>>(),
  };

  constructor(
    private relay: RealRelay,
    private db: PehchaanDB,
  ) {}

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.offs.length) return;
    this.offs.push(this.relay.onLabFrame((f) => void this.onFrame(f).catch(() => {})));
    void this.load();
    // The Lab page isn't inside the family app, which connects on its own: connect this device now.
    void this.db.identity.get("me").then((me) => me && this.relay.connect(me.deviceId));
  }

  stop(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  private async load() {
    const [since, lastYes, joinedUntil, attacks] = await Promise.all([
      this.db.meta.get("lab:since"),
      this.db.meta.get("lab:lastYes"),
      this.db.meta.get("lab:joinedUntil"),
      this.db.labAttacks.orderBy("at").toArray(),
    ]);
    if (typeof since?.value === "number") this.since = since.value;
    else await this.db.meta.put({ key: "lab:since", value: this.since });
    // A session survives a reload for its 4 hours; the relay refuses (lab_denied) once it has ended.
    this.joined = typeof joinedUntil?.value === "number" && joinedUntil.value > Date.now();
    this.lastYes = (lastYes?.value as Record<string, SeenYes>) ?? {};
    for (const [d, y] of Object.entries(this.lastYes)) {
      this.credIds[d] ??= y.ans.credId;
      this.verifiable.add(d);
    }
    this.attacks = attacks;
    this.lastAttack = attacks.at(-1) ?? null;
    this.emitCounters();
    this.emitStatus();
  }

  // ─── Controls ────────────────────────────────────────────────────────────

  async join(password: string): Promise<void> {
    await this.command("lab.join", { password });
    this.joined = true;
    this.notice = undefined;
    await this.db.meta.put({ key: "lab:joinedUntil", value: Date.now() + 4 * 60 * 60_000 });
    this.emitStatus();
  }

  setAttackerMode(on: boolean): void {
    this.attackerMode = on;
    if (!on && this.armed) this.disarm();
    this.emitStatus();
  }

  arm(attack: AttackKind, opts: { copyCredId?: boolean } = {}): void {
    const asker = this.roles.askerDeviceId;
    const answerer = this.roles.targetDeviceId;
    if (!asker || !answerer) return;
    if (attack === "replay" && !this.replayCandidate(answerer)) return;
    if (!this.attackerMode) this.attackerMode = true;
    this.armedRoles = { asker, answerer };
    this.copyCredId = attack === "forge" && opts.copyCredId === true;
    this.emitStatus();
    // "Armed" only once the relay holds the attack: a check sent before then would not be intercepted.
    this.command("lab.arm", { attack, asker, answerer }).then(
      () => {
        this.armed = attack;
        this.emitStatus();
      },
      () => {
        this.armed = null;
        this.emitStatus();
      },
    );
  }

  disarm(): void {
    this.armed = null;
    this.emitStatus();
    void this.command("lab.disarm", {}).catch(() => {});
  }

  setRoles(r: { askerDeviceId?: string; targetDeviceId?: string }): void {
    this.roles = { ...this.roles, ...r };
    this.emitStatus();
  }

  reset(): void {
    this.since = Date.now();
    void this.db.meta.put({ key: "lab:since", value: this.since });
    this.emitCounters();
    this.emitStatus();
  }

  clearLog(): void {
    this.events.clear();
  }

  async attackLog(): Promise<LabAttackRecord[]> {
    return this.db.labAttacks.orderBy("at").toArray();
  }

  /** A lab.* command; a refused session means the password is needed again. */
  private async command<T extends LabCommand>(t: T, body: ClientBody<T>): Promise<void> {
    try {
      await this.relay.labCommand(t, body);
    } catch (e) {
      const reason = e instanceof RelayError ? e.reason : undefined;
      if (reason === "lab_denied" && t !== "lab.join") {
        this.joined = false;
        void this.db.meta.delete("lab:joinedUntil");
      }
      this.notice = reason;
      this.emitStatus();
      throw e;
    }
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────

  onTraffic(cb: (e: RelayEvent) => void): Unsubscribe {
    this.ls.traffic.add(cb);
    return () => this.ls.traffic.delete(cb);
  }

  onCounters(cb: (c: { attacks: number; falseGreens: number }) => void): Unsubscribe {
    this.ls.counters.add(cb);
    cb(this.counters());
    return () => this.ls.counters.delete(cb);
  }

  onStatus(cb: (s: LabStatus) => void): Unsubscribe {
    this.ls.status.add(cb);
    cb(this.status());
    return () => this.ls.status.delete(cb);
  }

  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe {
    this.ls.peers.add(cb);
    cb(this.peers());
    return () => this.ls.peers.delete(cb);
  }

  private counters() {
    const recent = this.attacks.filter((a) => a.at >= this.since);
    return { attacks: recent.length, falseGreens: recent.filter((a) => a.falseGreen).length };
  }

  private status(): LabStatus {
    return {
      attackerMode: this.attackerMode,
      armed: this.armed,
      canReplay: Boolean(this.replayCandidate(this.roles.targetDeviceId)),
      lastAttack: this.lastAttack,
      since: this.since,
      joined: this.joined && this.active,
      optedIn: this.optedIn,
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }

  /** The relay knows no names: phones are named from what they said in the traffic. */
  private peers(): PeerInfo[] {
    return this.optedIn.map((deviceId) => ({
      deviceId,
      name: this.names[deviceId] ?? deviceId.slice(0, 6),
      kind: "phone" as const,
      ...(this.verifiable.has(deviceId) ? { canBeVerified: true } : {}),
      lastSeen: Date.now(),
    }));
  }

  private emitCounters() {
    const c = this.counters();
    this.ls.counters.forEach((cb) => cb(c));
  }

  private emitStatus() {
    const s = this.status();
    this.ls.status.forEach((cb) => cb(s));
  }

  private emitPeers() {
    const p = this.peers();
    this.ls.peers.forEach((cb) => cb(p));
  }

  private emitEvent(e: RelayEvent) {
    this.events.set(e.id, e);
    if (this.events.size > 400) {
      const first = this.events.keys().next().value;
      if (first) this.events.delete(first);
    }
    this.ls.traffic.forEach((cb) => cb(e));
  }

  private replayCandidate(target?: string): SeenYes | null {
    return (target && this.lastYes[target]) || null;
  }

  // ─── From the relay ──────────────────────────────────────────────────────

  private async onFrame(f: LabRelayFrame) {
    switch (f.t) {
      case "lab.state":
        return this.onState(f.body);
      case "lab.traffic":
        return this.onTraffic_(f.body.event);
      case "lab.held":
        return this.onHeld(f.body);
      case "lab.result":
        return this.onResult(f.body);
    }
  }

  private onState(s: RelayBody<"lab.state">) {
    this.active = s.active;
    this.optedIn = s.optedIn;
    this.armed = s.armed?.attack ?? null;
    if (s.armed) this.armedRoles = { asker: s.armed.asker, answerer: s.armed.answerer };
    if (s.notice) this.notice = s.notice;
    this.emitStatus();
    this.emitPeers();
  }

  private onTraffic_(e: RelayBody<"lab.traffic">["event"]) {
    // A phone's report of the verdict it showed: mark the answer rows of that request.
    if (e.verdictSeen) {
      for (const ev of this.events.values()) {
        if (ev.requestId === e.requestId && ev.kind === "answer") this.emitEvent({ ...ev, verdictSeen: e.verdictSeen });
      }
      return;
    }
    const payload = e.payload as { req?: WireRequest; ans?: WireAnswer; fromName?: string; spk?: string } | undefined;
    let shown: unknown = payload;
    let summary = e.summary;
    if (e.kind === "request" && payload?.req) {
      const req = payload.req;
      if (payload.fromName) this.names[req.fromDeviceId] = payload.fromName;
      this.names[req.toDeviceId] ??= req.claimedLabel;
      this.verifiable.add(req.toDeviceId);
      shown = req;
      summary = summarize("request", req);
    } else if (e.kind === "answer" && payload?.ans) {
      const ans = payload.ans;
      shown = ans;
      summary = summarize("answer", ans);
      // A genuine "Yes" straight from the phone (not one this Lab changed or injected): keep it to replay.
      if (e.from !== "relay" && !e.tampered && payload.spk) {
        this.credIds[e.from] = ans.credId;
        this.verifiable.add(e.from);
        if (ans.decision === "ME") {
          this.lastYes[e.from] = { ans, spk: payload.spk };
          void this.db.meta.put({ key: "lab:lastYes", value: this.lastYes });
        }
      }
    }
    if (e.to === "relay") summary += " · held by attacker";
    else if (e.tampered === "change") summary += " · changed by attacker";
    else if (e.from === "relay") summary += " · injected by attacker";
    this.emitEvent({
      id: e.id,
      at: e.at,
      kind: e.kind,
      from: e.from,
      to: e.to,
      summary,
      payload: shown,
      ...(e.tampered ? { tampered: e.tampered } : {}),
      ...(e.requestId ? { requestId: e.requestId } : {}),
    });
    this.emitStatus();
    this.emitPeers();
  }

  /** The relay is holding a message for this page's armed attack. */
  private async onHeld(h: RelayBody<"lab.held">) {
    // No timer before acting: a Lab page in a background tab has its timers throttled (to once a minute after a
    // while), and the relay releases a held message unchanged after 10 s. Network events and WebCrypto aren't.
    const plain = h.frame.body.plain as { req?: WireRequest; ans?: WireAnswer; spk?: string } | undefined;
    const roles = this.armedRoles;
    this.armed = null;
    this.emitStatus();
    // A sealed message can't be read or rebuilt: let it go on unchanged (it isn't an attack then).
    if (!plain) return void this.command("lab.release", { heldId: h.heldId }).catch(() => {});

    if (h.attack === "change" && plain.ans) {
      const ans = plain.ans;
      const flipped: WireAnswer = { ...ans, decision: ans.decision === "NOT_ME" ? "ME" : "NOT_ME" };
      await this.command("lab.release", { heldId: h.heldId, replacement: { ...plain, ans: flipped } });
      await this.record("change", ans.requestId, h.frame.body.from, roles?.asker ?? "");
      return;
    }
    const req = plain.req;
    if (!req) return void this.command("lab.release", { heldId: h.heldId }).catch(() => {});
    let answer: { spk: string; ans: WireAnswer } | null = null;
    let copied = false;
    if (h.attack === "replay") {
      const old = this.replayCandidate(req.toDeviceId);
      // The genuine old answer, re-labelled as the answer to this new request.
      if (old) answer = { spk: old.spk, ans: { ...old.ans, requestId: req.requestId } };
    } else if (h.attack === "forge") {
      // A perfect-looking "Yes": the right rpId hash, UP+UV, the right challenge for ME, the right origin,
      // signed with the attacker's own fresh key (optionally claiming the person's real credential ID).
      const attacker = await createSoftCredential();
      copied = this.copyCredId && Boolean(this.credIds[req.toDeviceId]);
      const credId = copied ? this.credIds[req.toDeviceId]! : attacker.credId;
      const ans = await softAnswer({
        req,
        decision: "ME",
        credId,
        privateKey: attacker.privateKey,
        rpId: appConfig.rpId,
        origin: appConfig.origin,
      });
      answer = { spk: attacker.publicKey, ans };
    }
    if (!answer) return void this.command("lab.release", { heldId: h.heldId }).catch(() => {});
    await this.command("lab.inject", {
      as: req.toDeviceId,
      to: req.fromDeviceId,
      kind: "verify.answer",
      re: req.requestId,
      plain: answer,
    });
    await this.record(h.attack, req.requestId, req.toDeviceId, req.fromDeviceId, copied);
  }

  private async record(attack: AttackKind, requestId: string, target: string, asker: string, copied = false) {
    const rec: LabAttackRecord = {
      id: ulid(),
      at: Date.now(),
      attack,
      requestId,
      targetDeviceId: target,
      askerDeviceId: asker,
      falseGreen: false,
      ...(copied ? { copiedCredId: true } : {}),
    };
    this.attacks.push(rec);
    this.lastAttack = rec;
    await this.db.labAttacks.put(rec);
    this.emitCounters();
    this.emitStatus();
  }

  /** What the asker's phone showed for an attacked check. */
  private async onResult(r: RelayBody<"lab.result">) {
    const rec = this.attacks.find((a) => a.requestId === r.requestId);
    if (!rec) return;
    rec.verdictSeen = r.verdict;
    if (r.invalidReason) rec.invalidReason = r.invalidReason;
    rec.failedChecks = r.failedChecks;
    rec.falseGreen = r.falseGreen;
    this.lastAttack = { ...rec };
    await this.db.labAttacks.put(rec);
    this.emitCounters();
    this.emitStatus();
  }
}
