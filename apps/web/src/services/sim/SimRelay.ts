// SimRelay (frontend spec B3 item 1; backend spec 22.2): the relay between phones, simulated with a
// BroadcastChannel, with the same contract as RealRelay so simulation exercises every screen state.
//   - 250–600 ms random latency per message
//   - presence heartbeat every 2 s; a device is reachable if seen in the last 6 s
//   - connection can be forced to reconnecting / offline from the Simulation panel
//   - while reconnecting, outgoing messages wait and incoming ones are held until connected;
//     while offline, sending fails and incoming messages are lost (like a real relay session)
//   - receipts: accepted after sending, delivered when the recipient acks, seen when it opens F1,
//     queued when the recipient isn't on the channel, rejected when it has removed the sender
//   - when the Security Lab runs in attacker mode, messages go "up" to the Lab, which forwards them
//     (and may tamper with them), exactly like an attacker who controls the relay.
import { ulid } from "@pehchaan/protocol";
import type {
  AutoAnswerMode,
  CancelNotice,
  ConnectionState,
  Contact,
  FamilyAlert,
  GuardPrompt,
  IncomingAnswer,
  IncomingRequest,
  PeerInfo,
  PresenceState,
  Receipt,
  RecipientCard,
  RelayInfo,
  RelayService,
  Unsubscribe,
  VerifyRequest,
  WireAnswer,
} from "../types";
import { RelayError } from "../errors";
import { latency, openBus, sleep, type Bus, type MsgKind, type Wire, type WireMsg } from "./bus";

const HEARTBEAT_MS = 2000;
const REACHABLE_MS = 6000;
// The Lab's attacker mode is sticky: it holds until the Lab says otherwise (or closes). The Lab re-announces
// itself whenever a phone appears, and heartbeats every second; a long stale window keeps routing correct even
// when the Lab's tab is in the background (timers throttled).
const LAB_STALE_MS = 150_000;
const LAB_ROUTING_KEY = "pehchaan:lab-routing";

type Listener<T> = (v: T) => void;

export interface SimRelayDeps {
  getAutoAnswer: () => Promise<AutoAnswerMode>;
  autoRespond: (req: VerifyRequest, mode: AutoAnswerMode, deliver: (ans: WireAnswer) => void) => Promise<void>;
  /** This device's public keys (they travel with requests so answers can come back). */
  myKeys: () => { devicePub: string; encPub: string };
  /** Devices I removed from my family (contact.revoke), whose messages I refuse. */
  isRevoked: (deviceId: string) => Promise<boolean>;
  setRevoked: (deviceId: string, revoked: boolean) => Promise<void>;
  revokedList: () => Promise<string[]>;
  /** "Reset my code": a new grant for my card. */
  rotateGrant: () => Promise<string>;
}

export class SimRelay implements RelayService {
  private me: string | null = null;
  private bus: Bus | null = null;
  private state: ConnectionState = "offline";
  private forced: ConnectionState | null = null;
  private booting = false;
  private info_: { name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean } = { name: "", kind: "phone" };
  private peers = new Map<string, PeerInfo>();
  private lastReachable = "";
  private seen = new Set<string>();
  private labAt = 0;
  private labMode = false;
  private inbox: WireMsg[] = [];
  private waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  private lastMsg: number | null = null;
  private timers: number[] = [];
  /** requestId → recipient (for cancel) and → asker (for seen). */
  private sentTo = new Map<string, string>();
  private askedBy = new Map<string, string>();

  private ls = {
    state: new Set<Listener<ConnectionState>>(),
    presence: new Set<Listener<string[]>>(),
    peers: new Set<Listener<PeerInfo[]>>(),
    request: new Set<Listener<IncomingRequest>>(),
    answer: new Set<Listener<IncomingAnswer>>(),
    alert: new Set<Listener<FamilyAlert>>(),
    guard: new Set<Listener<GuardPrompt>>(),
    receipt: new Set<Listener<Receipt>>(),
    cancel: new Set<Listener<CancelNotice>>(),
  };

  constructor(private deps: SimRelayDeps) {}

  // ─── Connection ──────────────────────────────────────────────────────────

  connect(deviceId: string): void {
    if (this.me === deviceId && this.bus) return;
    this.teardown();
    this.me = deviceId;
    this.restoreLabRouting();
    this.bus = openBus((w) => this.onWire(w));
    this.booting = true;
    this.recompute();
    this.timers.push(
      window.setTimeout(() => {
        this.booting = false;
        this.recompute();
      }, 450),
      window.setInterval(() => this.beat(), HEARTBEAT_MS),
      window.setInterval(() => this.sweep(), 1000),
    );
    window.addEventListener("online", this.recompute);
    window.addEventListener("offline", this.recompute);
    window.addEventListener("pagehide", this.onPageHide);
  }

  reconnect(): void {
    if (!this.me) return;
    const id = this.me;
    this.me = null;
    this.connect(id);
  }

  private teardown() {
    this.timers.forEach((t) => {
      window.clearTimeout(t);
      window.clearInterval(t);
    });
    this.timers = [];
    window.removeEventListener("online", this.recompute);
    window.removeEventListener("offline", this.recompute);
    window.removeEventListener("pagehide", this.onPageHide);
    if (this.bus && this.me) this.bus.post({ t: "bye", from: this.me });
    this.bus?.close();
    this.bus = null;
  }

  private onPageHide = () => {
    if (this.bus && this.me) this.bus.post({ t: "bye", from: this.me });
  };

  private recompute = () => {
    let next: ConnectionState;
    if (this.forced) next = this.forced;
    else if (!this.bus || !this.bus.supported) next = "offline";
    else if (typeof navigator !== "undefined" && navigator.onLine === false) next = "offline";
    else if (this.booting) next = "reconnecting";
    else next = "connected";
    this.setState(next);
  };

  private setState(next: ConnectionState) {
    if (next === this.state) return;
    this.state = next;
    this.ls.state.forEach((cb) => cb(next));
    if (next === "connected") {
      this.beat();
      const waiters = this.waiters.splice(0);
      waiters.forEach((w) => w.resolve());
      const held = this.inbox.splice(0);
      held.forEach((m) => this.dispatch(m));
    } else if (next === "offline") {
      const waiters = this.waiters.splice(0);
      waiters.forEach((w) => w.reject(new RelayError("offline")));
      this.inbox = [];
      this.peers.clear();
      this.sweep();
    }
  }

  /** Simulation panel: force a state, or null to follow the real network again. */
  force(state: ConnectionState | null) {
    this.forced = state;
    this.recompute();
  }

  forcedState() {
    return this.forced;
  }

  getState(): ConnectionState {
    return this.state;
  }

  onState(cb: (s: ConnectionState) => void): Unsubscribe {
    this.ls.state.add(cb);
    cb(this.state);
    return () => this.ls.state.delete(cb);
  }

  address(): string {
    return "BroadcastChannel “pehchaan-sim” (simulated relay)";
  }

  lastMessageAt(): number | null {
    return this.lastMsg;
  }

  info(): RelayInfo {
    return { env: "simulation", e2e: false };
  }

  onInfo(cb: (i: RelayInfo) => void): Unsubscribe {
    cb(this.info());
    return () => {};
  }

  onUpdateRequired(): Unsubscribe {
    return () => {};
  }

  clockOffsetMs(): number {
    return 0;
  }

  async ping(): Promise<number> {
    if (this.state === "offline") throw new RelayError("offline");
    const t0 = performance.now();
    await sleep(latency());
    await sleep(latency());
    if (this.getState() === "offline") throw new RelayError("offline");
    return Math.round(performance.now() - t0);
  }

  // ─── Presence ────────────────────────────────────────────────────────────

  announce(info: { name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean }): void {
    this.info_ = info;
    this.beat();
  }

  private beat() {
    if (!this.bus || !this.me || this.state !== "connected") return;
    this.bus.post({
      t: "presence",
      from: this.me,
      name: this.info_.name,
      kind: this.info_.kind,
      canBeVerified: this.info_.canBeVerified,
      at: Date.now(),
    });
  }

  private sweep() {
    const now = Date.now();
    for (const [id, p] of this.peers) if (now - p.lastSeen > REACHABLE_MS) this.peers.delete(id);
    const peers = [...this.peers.values()];
    const reachable = peers
      .filter((p) => p.kind === "phone")
      .map((p) => p.deviceId)
      .sort();
    const key = reachable.join(",");
    if (key !== this.lastReachable) {
      this.lastReachable = key;
      this.ls.presence.forEach((cb) => cb(reachable));
    }
    this.ls.peers.forEach((cb) => cb(peers));
  }

  onPresence(cb: (ids: string[]) => void): Unsubscribe {
    this.ls.presence.add(cb);
    cb(this.lastReachable ? this.lastReachable.split(",") : []);
    return () => this.ls.presence.delete(cb);
  }

  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe {
    this.ls.peers.add(cb);
    cb([...this.peers.values()]);
    return () => this.ls.peers.delete(cb);
  }

  async queryPresence(deviceIds: string[]): Promise<Record<string, PresenceState>> {
    if (this.state === "offline") throw new RelayError("offline");
    await sleep(latency());
    // With auto-answer on, a simulated family member answers for everyone, so everyone is reachable.
    const auto = (await this.deps.getAutoAnswer()) !== "off";
    return Object.fromEntries(
      deviceIds.map((id) => [id, auto || this.peers.get(id)?.kind === "phone" ? "online" : "offline"] as const),
    );
  }

  // ─── Lab routing ─────────────────────────────────────────────────────────

  private labControlled() {
    return this.labMode && Date.now() - this.labAt < LAB_STALE_MS;
  }

  // A reloaded tab remembers (for this tab session) whether the Lab controls the relay, so its very first
  // message is routed correctly: no race against the Lab's next announcement.
  private persistLabRouting() {
    try {
      sessionStorage.setItem(LAB_ROUTING_KEY, JSON.stringify({ mode: this.labMode, at: this.labAt }));
    } catch {
      /* storage unavailable: fall back to the Lab's announcements */
    }
  }

  private restoreLabRouting() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(LAB_ROUTING_KEY) ?? "null") as {
        mode: boolean;
        at: number;
      } | null;
      if (saved && Date.now() - saved.at < LAB_STALE_MS) {
        this.labMode = saved.mode;
        this.labAt = saved.at;
      }
    } catch {
      /* ignore */
    }
  }

  /** Simulation only: whether the Security Lab currently controls the relay (Diagnostics, tests). */
  labRouting(): { controlled: boolean; lastHeardMs: number | null } {
    return { controlled: this.labControlled(), lastHeardMs: this.labAt ? Date.now() - this.labAt : null };
  }

  // ─── Sending ─────────────────────────────────────────────────────────────

  private async waitConnected(): Promise<void> {
    if (this.state === "connected") return;
    if (this.state === "offline") throw new RelayError("offline");
    await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async post(kind: MsgKind, to: string, payload: unknown, id: string = ulid()): Promise<WireMsg> {
    if (!this.me || !this.bus) throw new RelayError("offline");
    await this.waitConnected();
    await sleep(latency());
    if (this.state !== "connected") throw new RelayError(this.state === "offline" ? "offline" : "unreachable");
    // Only requests and answers are routed through the Lab (the attacks it can play).
    const viaLab = this.labControlled() && (kind === "request" || kind === "answer");
    const msg: WireMsg = {
      t: "msg",
      id,
      kind,
      from: this.me,
      to,
      payload,
      hop: viaLab ? "up" : "deliver",
      at: Date.now(),
      sender: this.deps.myKeys(),
    };
    this.bus.post(msg);
    this.lastMsg = msg.at;
    // BroadcastChannel never echoes to its sender, so deliver messages to ourselves directly.
    if (to === this.me && msg.hop === "deliver") this.receive(msg);
    return msg;
  }

  private emitReceipt(r: Receipt) {
    this.ls.receipt.forEach((cb) => cb(r));
  }

  /** accepted now; queued if the recipient isn't on the channel (the real relay's inbox would keep it). */
  private acceptedFor(msg: WireMsg, re?: string) {
    this.emitReceipt({ of: msg.id, ...(re ? { re } : {}), to: msg.to, state: "accepted" });
    if (!this.peers.has(msg.to) && msg.to !== this.me) {
      this.emitReceipt({ of: msg.id, ...(re ? { re } : {}), to: msg.to, state: "queued" });
    }
  }

  async sendRequest(req: VerifyRequest, to: RecipientCard): Promise<void> {
    const mode = await this.deps.getAutoAnswer();
    if (mode !== "off") {
      // One-device testing: a simulated family member answers instead of another tab.
      await this.waitConnected();
      await sleep(latency());
      if (this.state !== "connected") throw new RelayError("offline");
      this.lastMsg = Date.now();
      this.emitReceipt({ of: req.requestId, re: req.requestId, to: to.deviceId, state: "accepted" });
      void this.deps.autoRespond(req, mode, (ans) =>
        this.receive({
          t: "msg",
          id: ulid(),
          kind: "answer",
          from: req.toDeviceId,
          to: req.fromDeviceId,
          payload: ans,
          hop: "deliver",
          at: Date.now(),
        }),
      );
      return;
    }
    const msg = await this.post("request", to.deviceId, req, req.requestId);
    this.sentTo.set(req.requestId, to.deviceId);
    this.acceptedFor(msg, req.requestId);
  }

  async sendAnswer(ans: WireAnswer, to: { deviceId: string }): Promise<void> {
    await this.post("answer", to.deviceId, ans);
  }

  async sendAlert(alert: FamilyAlert, to: RecipientCard[]): Promise<Array<{ deviceId: string; msgId: string }>> {
    const out: Array<{ deviceId: string; msgId: string }> = [];
    await Promise.all(
      to.map(async (r) => {
        const msg = await this.post("alert", r.deviceId, alert);
        out.push({ deviceId: r.deviceId, msgId: msg.id });
        this.acceptedFor(msg);
      }),
    );
    return out;
  }

  async sendGuardPrompt(p: GuardPrompt, to: RecipientCard): Promise<void> {
    const msg = await this.post("guard", to.deviceId, p);
    this.acceptedFor(msg);
  }

  async cancelRequest(requestId: string): Promise<void> {
    const to = this.sentTo.get(requestId);
    if (to) await this.post("cancel", to, { requestId, reason: "asker_cancelled" }).catch(() => {});
  }

  markSeen(requestId: string): void {
    const asker = this.askedBy.get(requestId);
    if (asker) void this.post("seen", asker, { re: requestId }).catch(() => {});
  }

  pushSubscribe(): void {
    /* the simulated relay has no Web Push */
  }

  async contacts(): Promise<Contact[]> {
    return [];
  }

  async revokeContact(deviceId: string): Promise<void> {
    await this.deps.setRevoked(deviceId, true);
  }

  async unrevokeContact(deviceId: string): Promise<void> {
    await this.deps.setRevoked(deviceId, false);
  }

  rotateGrant(): Promise<string> {
    return this.deps.rotateGrant();
  }

  async retire(): Promise<void> {
    /* nothing is stored on a simulated relay */
  }

  async sendTestAlert(): Promise<void> {
    /* Web Push isn't simulated; Diagnostics explains this */
  }

  async labOptIn(): Promise<void> {
    /* the simulated Lab sees every tab's traffic in attacker mode */
  }

  async labOptOut(): Promise<void> {}

  // ─── Receiving ───────────────────────────────────────────────────────────

  private onWire(w: Wire) {
    if (!this.me) return;
    switch (w.t) {
      case "presence":
        if (w.from === this.me) return;
        if (this.state === "offline") return;
        this.peers.set(w.from, {
          deviceId: w.from,
          name: w.name,
          kind: w.kind,
          canBeVerified: w.canBeVerified,
          lastSeen: Date.now(),
        });
        this.sweep();
        return;
      case "bye":
        if (this.peers.delete(w.from)) this.sweep();
        return;
      case "lab":
        this.labAt = Date.now();
        this.labMode = w.attackerMode && !w.closing;
        this.persistLabRouting();
        return;
      case "msg":
        if (w.hop === "deliver" && w.to === this.me) this.receive(w);
        return;
      default:
        return;
    }
  }

  private receive(m: WireMsg) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    if (this.state === "offline") return; // lost, like a real session that dropped
    if (this.state === "reconnecting") {
      this.inbox.push(m);
      return;
    }
    this.dispatch(m);
  }

  private dispatch(m: WireMsg) {
    this.lastMsg = Date.now();
    void this.handle(m);
  }

  private async handle(m: WireMsg) {
    const now = Date.now();
    switch (m.kind) {
      case "request":
      case "alert":
      case "guard": {
        // Someone I removed from my family can't reach me (6.4): refuse, as the relay would.
        if (await this.deps.isRevoked(m.from)) {
          void this.post("reject", m.from, { of: m.id, reason: "not_allowed" }).catch(() => {});
          return;
        }
        void this.post("ack", m.from, { of: m.id }).catch(() => {});
        if (m.kind === "request") {
          const req = m.payload as VerifyRequest;
          this.askedBy.set(req.requestId, m.from);
          const incoming: IncomingRequest = {
            req,
            envFrom: m.from,
            ttlMs: Math.max(0, req.expiresAt - now), // one browser, one clock: this is the relay's time left
            receivedAt: now,
            senderDevicePub: m.sender?.devicePub ?? "",
            senderEncPub: m.sender?.encPub ?? "",
          };
          this.ls.request.forEach((cb) => cb(incoming));
        } else if (m.kind === "alert") {
          // Timed by this tab's clock, as the real client does (8.7).
          const alert = m.payload as FamilyAlert;
          this.ls.alert.forEach((cb) => cb({ ...alert, createdAt: Date.now(), victimDeviceId: m.from }));
        } else {
          this.ls.guard.forEach((cb) => cb(m.payload as GuardPrompt));
        }
        return;
      }
      case "answer": {
        const ans = m.payload as WireAnswer;
        this.ls.answer.forEach((cb) => cb({ ans, sealOk: true, envFrom: m.from, re: ans.requestId, receivedAt: now }));
        return;
      }
      case "ack":
        this.emitReceipt({ of: (m.payload as { of: string }).of, to: m.from, state: "delivered" });
        return;
      case "seen": {
        const re = (m.payload as { re: string }).re;
        this.emitReceipt({ of: re, re, to: m.from, state: "seen" });
        return;
      }
      case "reject":
        this.emitReceipt({
          of: (m.payload as { of: string }).of,
          to: m.from,
          state: "rejected",
          reason: (m.payload as { reason: string }).reason,
        });
        return;
      case "cancel": {
        const c = m.payload as { requestId: string; reason: CancelNotice["reason"] };
        this.ls.cancel.forEach((cb) => cb({ requestId: c.requestId, reason: c.reason, from: m.from }));
        return;
      }
    }
  }

  onRequest(cb: (r: IncomingRequest) => void): Unsubscribe {
    this.ls.request.add(cb);
    return () => this.ls.request.delete(cb);
  }

  onAnswer(cb: (a: IncomingAnswer) => void): Unsubscribe {
    this.ls.answer.add(cb);
    return () => this.ls.answer.delete(cb);
  }

  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe {
    this.ls.alert.add(cb);
    return () => this.ls.alert.delete(cb);
  }

  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe {
    this.ls.guard.add(cb);
    return () => this.ls.guard.delete(cb);
  }

  onReceipt(cb: (r: Receipt) => void): Unsubscribe {
    this.ls.receipt.add(cb);
    return () => this.ls.receipt.delete(cb);
  }

  onCancel(cb: (c: CancelNotice) => void): Unsubscribe {
    this.ls.cancel.add(cb);
    return () => this.ls.cancel.delete(cb);
  }

  reportVerdict(r: Parameters<RelayService["reportVerdict"]>[0]): void {
    if (!this.bus || !this.me) return;
    this.bus.post({ t: "report", from: this.me, at: Date.now(), ...r });
  }
}
