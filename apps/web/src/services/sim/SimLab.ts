// SimLab (frontend spec B3 item 7, B12 J1): plays an attacker who controls the relay.
//
// It listens to the same BroadcastChannel and shows every message. In attacker mode it announces itself, phones
// route their requests and answers "up" to it, and it forwards each one on, or, when an attack is armed,
// rewrites the next matching message:
//   change  flips the decision of the next answer (NOT ME → ME) on the way           → INVALID changed
//   replay  holds the next request back and returns the person's earlier genuine "Yes" → INVALID reused
//   forge   holds the next request and answers "Yes" with the attacker's own key       → INVALID wrong_key
//           (or with the person's real credential ID copied: still INVALID, bad_signature)
// After Maa's phone verifies, it reports the verdict it showed; the Lab records the outcome in an all-time attack
// log (IndexedDB) and counts false greens, which must stay 0. Maa's phone runs the normal verifier: nothing here
// can influence what it decides.
import { createSoftCredential, softAnswer } from "@pehchaan/crypto/soft-authenticator";
import { ulid } from "@pehchaan/protocol";
import { appConfig } from "@/app/config";
import type {
  AttackKind,
  LabAttackRecord,
  LabService,
  LabStatus,
  PeerInfo,
  RelayEvent,
  Unsubscribe,
  VerifyRequest,
  WireAnswer,
} from "../types";
import type { PehchaanDB } from "@/store/db";
import { summarize } from "../labSummary";
import { openBus, type Bus, type MsgKind, type Wire, type WireMsg } from "./bus";

type Listener<T> = (v: T) => void;
type EventKind = RelayEvent["kind"];

const EVENT_KIND: Partial<Record<MsgKind, EventKind>> = {
  request: "request",
  answer: "answer",
  alert: "alert",
  guard: "guard",
};

export class SimLab implements LabService {
  private bus: Bus | null = null;
  private attackerMode = false;
  private armed: AttackKind | null = null;
  private copyCredId = false;
  private roles: { askerDeviceId?: string; targetDeviceId?: string } = {};
  private peers = new Map<string, PeerInfo>();
  /** The last genuine "Yes" each device sent, and each device's credential ID, as seen in traffic. */
  private lastYes: Record<string, WireAnswer> = {};
  private credIds: Record<string, string> = {};
  private since = Date.now();
  private attacks: LabAttackRecord[] = [];
  private lastAttack: LabAttackRecord | null = null;
  private events = new Map<string, RelayEvent>();
  private timers: number[] = [];

  private ls = {
    traffic: new Set<Listener<RelayEvent>>(),
    counters: new Set<Listener<{ attacks: number; falseGreens: number }>>(),
    status: new Set<Listener<LabStatus>>(),
    peers: new Set<Listener<PeerInfo[]>>(),
  };

  constructor(private db: PehchaanDB) {}

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.bus) return;
    this.bus = openBus((w) => this.onWire(w));
    void this.load();
    this.timers.push(
      window.setInterval(() => this.heartbeat(), 1000),
      window.setInterval(() => this.sweepPeers(), 1000),
    );
    this.heartbeat();
    window.addEventListener("pagehide", this.onPageHide);
  }

  stop(): void {
    this.onPageHide();
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
    window.removeEventListener("pagehide", this.onPageHide);
    this.bus?.close();
    this.bus = null;
  }

  private onPageHide = () => {
    this.bus?.post({ t: "lab", attackerMode: false, closing: true, at: Date.now() });
  };

  private async load() {
    const [since, lastYes, attacks] = await Promise.all([
      this.db.meta.get("lab:since"),
      this.db.meta.get("lab:lastYes"),
      this.db.labAttacks.orderBy("at").toArray(),
    ]);
    if (typeof since?.value === "number") this.since = since.value;
    else await this.db.meta.put({ key: "lab:since", value: this.since });
    this.lastYes = (lastYes?.value as Record<string, WireAnswer>) ?? {};
    for (const [d, a] of Object.entries(this.lastYes)) this.credIds[d] ??= a.credId;
    this.attacks = attacks;
    this.lastAttack = attacks.at(-1) ?? null;
    this.emitCounters();
    this.emitStatus();
  }

  private heartbeat() {
    this.bus?.post({ t: "lab", attackerMode: this.attackerMode, at: Date.now() });
  }

  // ─── Controls ────────────────────────────────────────────────────────────

  setAttackerMode(on: boolean): void {
    this.attackerMode = on;
    if (!on) this.armed = null;
    this.heartbeat();
    this.emitStatus();
  }

  arm(attack: AttackKind, opts: { copyCredId?: boolean } = {}): void {
    if (!this.attackerMode) this.setAttackerMode(true);
    if (attack === "replay" && !this.replayCandidate()) return;
    this.armed = attack;
    this.copyCredId = attack === "forge" && opts.copyCredId === true;
    this.emitStatus();
  }

  disarm(): void {
    this.armed = null;
    this.emitStatus();
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
    cb([...this.peers.values()]);
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
      canReplay: Boolean(this.replayCandidate()),
      lastAttack: this.lastAttack,
      since: this.since,
    };
  }

  private emitCounters() {
    const c = this.counters();
    this.ls.counters.forEach((cb) => cb(c));
  }

  private emitStatus() {
    const s = this.status();
    this.ls.status.forEach((cb) => cb(s));
  }

  private emitEvent(e: RelayEvent) {
    this.events.set(e.id, e);
    if (this.events.size > 400) {
      const first = this.events.keys().next().value;
      if (first) this.events.delete(first);
    }
    this.ls.traffic.forEach((cb) => cb(e));
  }

  /** The genuine "Yes" a replay would send: the target's own, else the most recent seen. */
  private replayCandidate(): { from: string; ans: WireAnswer } | null {
    const target = this.roles.targetDeviceId;
    if (target && this.lastYes[target]) return { from: target, ans: this.lastYes[target] };
    const all = Object.entries(this.lastYes).sort((a, b) => b[1].answeredAt - a[1].answeredAt);
    return all[0] ? { from: all[0][0], ans: all[0][1] } : null;
  }

  // ─── Traffic ─────────────────────────────────────────────────────────────

  private sweepPeers() {
    const now = Date.now();
    for (const [id, p] of this.peers) if (now - p.lastSeen > 6000) this.peers.delete(id);
    const list = [...this.peers.values()];
    this.ls.peers.forEach((cb) => cb(list));
  }

  private onWire(w: Wire) {
    switch (w.t) {
      case "presence":
        // Reply to presence (event-driven, so it works even when this tab's timers are throttled in the
        // background): a new or reloaded phone learns who controls the relay within about 0.5 s.
        if (this.attackerMode || !this.peers.has(w.from)) this.heartbeat();
        this.peers.set(w.from, {
          deviceId: w.from,
          name: w.name,
          kind: w.kind,
          canBeVerified: w.canBeVerified,
          lastSeen: Date.now(),
        });
        return;
      case "bye":
        this.peers.delete(w.from);
        this.sweepPeers();
        return;
      case "msg":
        this.onMsg(w);
        return;
      case "report":
        void this.onReport(w);
        return;
      default:
        return;
    }
  }

  private toEvent(m: WireMsg, extra: Partial<RelayEvent> = {}): RelayEvent {
    const kind = EVENT_KIND[m.kind]!;
    const payload = m.payload as { requestId?: string };
    return {
      id: m.id,
      at: Date.now(),
      kind,
      from: m.from,
      to: m.to,
      summary: summarize(kind, m.payload),
      payload: m.payload,
      requestId: payload?.requestId,
      ...(m.tampered ? { tampered: m.tampered } : {}),
      ...extra,
    };
  }

  private captureYes(m: WireMsg) {
    if (m.kind !== "answer" || m.tampered || m.injected) return;
    const a = m.payload as WireAnswer;
    this.credIds[m.from] = a.credId;
    if (a.decision !== "ME") return;
    this.lastYes[m.from] = a;
    void this.db.meta.put({ key: "lab:lastYes", value: this.lastYes });
    this.emitStatus();
  }

  private onMsg(m: WireMsg) {
    if (!EVENT_KIND[m.kind]) return; // receipts and notices aren't shown in the traffic log
    if (m.hop === "deliver") {
      // Direct traffic we only observe…
      this.captureYes(m);
      this.emitEvent(this.toEvent(m));
      // …except that an armed replay/forge still answers a check that slipped past the relay (a phone that
      // hadn't yet heard the Lab took over): the attacker races the real answer.
      if (m.kind === "request" && this.attackerMode && (this.armed === "replay" || this.armed === "forge")) {
        const attack = this.armed;
        this.armed = null;
        const req = m.payload as VerifyRequest;
        void this.recordAttack(attack, req);
        window.setTimeout(() => void this.inject(attack, req), 700);
        this.emitStatus();
      }
      return;
    }
    // hop === "up": we are the relay now.
    if (!this.attackerMode) {
      this.forward(m);
      return;
    }
    // An armed attack fires on the next check, whoever sends it (roles only label the pipeline).
    if (m.kind === "request" && (this.armed === "replay" || this.armed === "forge")) {
      const attack = this.armed;
      this.armed = null;
      const req = m.payload as VerifyRequest;
      this.emitEvent(this.toEvent(m, { to: "relay", summary: `${summarize("request", req)} · held by attacker` }));
      void this.recordAttack(attack, req);
      window.setTimeout(() => void this.inject(attack, req), 1300);
      this.emitStatus();
      return;
    }

    if (m.kind === "answer" && this.armed === "change") {
      this.armed = null;
      const ans = m.payload as WireAnswer;
      const flipped: WireAnswer = { ...ans, decision: ans.decision === "NOT_ME" ? "ME" : "NOT_ME" };
      void this.recordAttack("change", { requestId: ans.requestId, toDeviceId: m.from, fromDeviceId: m.to });
      this.forward(
        { ...m, payload: flipped, tampered: "change" },
        { summary: `answer · ${ans.decision === "NOT_ME" ? "NOT ME → ME" : "ME → NOT ME"} · changed by attacker` },
      );
      this.emitStatus();
      return;
    }

    this.captureYes(m);
    this.forward(m);
  }

  private forward(m: WireMsg, extra: Partial<RelayEvent> = {}) {
    const out: WireMsg = { ...m, hop: "deliver" };
    this.bus?.post(out);
    this.emitEvent(this.toEvent(out, extra));
  }

  private async inject(attack: AttackKind, req: VerifyRequest) {
    let ans: WireAnswer;
    let summary: string;
    if (attack === "replay") {
      const old = this.lastYes[req.toDeviceId] ?? this.replayCandidate()?.ans;
      if (!old) return;
      // The genuine old answer, re-labelled as the answer to the new request.
      ans = { ...old, requestId: req.requestId };
      summary = `answer · ME (replayed from ${new Date(old.answeredAt).toLocaleTimeString("en-IN")}) · nonce ${ans.nonce.slice(0, 4)}…`;
    } else {
      // A perfect-looking "Yes": right rpId hash, UP+UV, the right challenge for ME, the right origin, signed
      // with the attacker's own fresh key (and optionally the victim's real credential ID).
      const attacker = await createSoftCredential();
      const credId = this.copyCredId && this.credIds[req.toDeviceId] ? this.credIds[req.toDeviceId]! : attacker.credId;
      ans = await softAnswer({
        req,
        decision: "ME",
        credId,
        privateKey: attacker.privateKey,
        rpId: appConfig.rpId,
        origin: location.origin,
      });
      summary = `answer · ME · forged with attacker key ${attacker.credId.slice(0, 10)}…${credId !== attacker.credId ? " (copied credential ID)" : ""}`;
    }
    const m: WireMsg = {
      t: "msg",
      id: ulid(),
      kind: "answer",
      from: req.toDeviceId,
      to: req.fromDeviceId,
      payload: ans,
      hop: "deliver",
      at: Date.now(),
      tampered: attack,
      injected: true,
    };
    this.bus?.post(m);
    this.emitEvent(this.toEvent(m, { from: "relay", summary }));
  }

  private async recordAttack(
    attack: AttackKind,
    req: Pick<VerifyRequest, "requestId" | "toDeviceId" | "fromDeviceId">,
  ) {
    const rec: LabAttackRecord = {
      id: ulid(),
      at: Date.now(),
      attack,
      requestId: req.requestId,
      targetDeviceId: req.toDeviceId,
      askerDeviceId: req.fromDeviceId,
      falseGreen: false,
      ...(attack === "forge" && this.copyCredId ? { copiedCredId: true } : {}),
    };
    this.attacks.push(rec);
    this.lastAttack = rec;
    await this.db.labAttacks.put(rec);
    this.emitCounters();
    this.emitStatus();
  }

  private async onReport(r: Extract<Wire, { t: "report" }>) {
    // Mark the verdict on the traffic rows of this request.
    for (const e of this.events.values()) {
      if (e.requestId === r.requestId && e.kind === "answer") {
        const updated = { ...e, verdictSeen: r.verdict };
        this.events.set(e.id, updated);
        this.ls.traffic.forEach((cb) => cb(updated));
      }
    }
    const rec = this.attacks.find((a) => a.requestId === r.requestId);
    if (!rec) return;
    rec.verdictSeen = r.verdict;
    rec.invalidReason = r.invalidReason;
    rec.failedChecks = r.failedChecks;
    rec.falseGreen = r.verdict === "VERIFIED";
    this.lastAttack = { ...rec };
    await this.db.labAttacks.put(rec);
    this.emitCounters();
    this.emitStatus();
  }
}
