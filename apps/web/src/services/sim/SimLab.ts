// SimLab (spec B3 item 7, B12 J1): plays an attacker who controls the relay.
//
// It listens to the same BroadcastChannel and shows every message. In attacker mode it
// announces itself, phones route their messages "up" to it, and it forwards each one on —
// or, when an attack is armed, rewrites the next matching message:
//   change  flips the decision of the next answer (NOT ME → ME) on the way
//   replay  holds the next request back and returns the person's earlier genuine "Yes"
//   forge   holds the next request and answers "Yes" with the attacker's own key
// After Maa's phone verifies, it reports the verdict it showed; the Lab records the outcome
// in an all-time attack log (IndexedDB) and counts false greens (which must stay 0).
import type {
  AttackKind,
  LabAttackRecord,
  LabService,
  LabStatus,
  PeerInfo,
  RelayEvent,
  SignedAnswer,
  Unsubscribe,
  VerifyRequest,
  FamilyAlert,
  GuardPrompt,
} from "../types";
import type { PehchaanDB } from "@/store/db";
import { randomId } from "../crypto";
import { openBus, type Bus, type Wire, type WireMsg } from "./bus";
import { makeSignedAnswer } from "./simSign";

type Listener<T> = (v: T) => void;

const inr = (n?: number) =>
  n ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n) : "";

const REASON_EN: Record<string, string> = {
  money: "Money",
  otp: "OTP or code",
  bank_details: "Bank or card details",
  install_app: "Install an app",
  nothing_yet: "Nothing yet",
};

export function summarize(kind: RelayEvent["kind"], payload: unknown): string {
  if (kind === "request") {
    const r = payload as VerifyRequest;
    const what = r.reason ? `${REASON_EN[r.reason] ?? r.reason}${r.amountInr ? " " + inr(r.amountInr) : ""}` : "No reason";
    return `request · ${what} · nonce ${r.nonce.slice(0, 4)}…`;
  }
  if (kind === "answer") {
    const a = payload as SignedAnswer;
    return `answer · ${a.decision === "ME" ? "ME" : "NOT ME"} · key ${a.keyId.slice(0, 10)}… · nonce ${a.nonce.slice(0, 4)}…`;
  }
  if (kind === "alert") {
    const a = payload as FamilyAlert;
    return `alert · ${a.type === "impersonation" ? "impersonation" : "check on"} · about ${a.aboutLabel}`;
  }
  if (kind === "guard") {
    const g = payload as GuardPrompt;
    return `call guard · claims ${g.claimedLabel}${g.amountInr ? " · " + inr(g.amountInr) : ""}`;
  }
  return kind;
}

export class SimLab implements LabService {
  private bus: Bus | null = null;
  private attackerMode = false;
  private armed: AttackKind | null = null;
  private roles: { askerDeviceId?: string; targetDeviceId?: string } = {};
  private peers = new Map<string, PeerInfo>();
  private lastYes: Record<string, SignedAnswer> = {};
  private since = Date.now();
  private attacks: LabAttackRecord[] = [];
  private lastAttack: LabAttackRecord | null = null;
  private events = new Map<string, RelayEvent>();
  private labKeyId = randomId("key_attacker", 16);
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
    this.lastYes = (lastYes?.value as Record<string, SignedAnswer>) ?? {};
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

  arm(attack: AttackKind): void {
    if (!this.attackerMode) this.setAttackerMode(true);
    if (attack === "replay" && !this.replayCandidate()) return;
    this.armed = attack;
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
  private replayCandidate(): SignedAnswer | null {
    const target = this.roles.targetDeviceId;
    if (target && this.lastYes[target]) return this.lastYes[target];
    const all = Object.values(this.lastYes);
    return all.sort((a, b) => b.answeredAt - a.answeredAt)[0] ?? null;
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
        // Reply to presence (event-driven, so it works even when this tab's timers are throttled
        // in the background): a new or reloaded phone learns who controls the relay within ~0.5 s.
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
    const payload = m.payload as { requestId?: string };
    return {
      id: m.id,
      at: Date.now(),
      kind: m.kind,
      from: m.from,
      to: m.to,
      summary: summarize(m.kind, m.payload),
      payload: m.payload,
      requestId: payload?.requestId,
      ...(m.tampered ? { tampered: m.tampered } : {}),
      ...extra,
    };
  }

  private captureYes(m: WireMsg) {
    if (m.kind !== "answer" || m.tampered || m.injected) return;
    const a = m.payload as SignedAnswer;
    if (a.decision !== "ME") return;
    this.lastYes[a.fromDeviceId] = a;
    void this.db.meta.put({ key: "lab:lastYes", value: this.lastYes });
    this.emitStatus();
  }

  private onMsg(m: WireMsg) {
    if (m.hop === "deliver") {
      // Direct traffic we only observe…
      this.captureYes(m);
      this.emitEvent(this.toEvent(m));
      // …except that an armed replay/forge still answers a check that slipped past the relay
      // (a phone that hadn't yet heard the Lab took over): the attacker races the real answer.
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
      const ans = m.payload as SignedAnswer;
      const flipped: SignedAnswer = { ...ans, decision: ans.decision === "NOT_ME" ? "ME" : "NOT_ME" };
      void this.recordAttack("change", { requestId: ans.requestId, toDeviceId: ans.fromDeviceId, fromDeviceId: m.to });
      this.forward({ ...m, payload: flipped, tampered: "change" }, {
        summary: `answer · ${ans.decision === "NOT_ME" ? "NOT ME → ME" : "ME → NOT ME"} · changed by attacker`,
      });
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
    let ans: SignedAnswer;
    if (attack === "replay") {
      const old = this.lastYes[req.toDeviceId] ?? this.replayCandidate();
      if (!old) return;
      // The genuine old answer, re-labelled as the answer to the new request.
      ans = { ...old, requestId: req.requestId };
    } else {
      ans = await makeSignedAnswer({
        keyId: this.labKeyId,
        req,
        decision: "ME",
        fromDeviceId: req.toDeviceId,
      });
    }
    const m: WireMsg = {
      t: "msg",
      id: randomId("msg", 9),
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
    this.emitEvent(
      this.toEvent(m, {
        from: "relay",
        summary:
          attack === "replay"
            ? `answer · ME (replayed from ${new Date(ans.answeredAt).toLocaleTimeString("en-IN")}) · nonce ${ans.nonce.slice(0, 4)}…`
            : `answer · ME · forged with attacker key ${this.labKeyId.slice(0, 14)}…`,
      }),
    );
  }

  private async recordAttack(
    attack: AttackKind,
    req: Pick<VerifyRequest, "requestId" | "toDeviceId" | "fromDeviceId">,
  ) {
    const rec: LabAttackRecord = {
      id: randomId("atk", 9),
      at: Date.now(),
      attack,
      requestId: req.requestId,
      targetDeviceId: req.toDeviceId,
      askerDeviceId: req.fromDeviceId,
      falseGreen: false,
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
