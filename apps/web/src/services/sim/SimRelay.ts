// SimRelay (spec B3 item 1): the relay between phones, simulated with a BroadcastChannel.
//   - 250–600 ms random latency per message
//   - presence heartbeat every 2 s; a device is reachable if seen in the last 6 s
//   - connection can be forced to reconnecting / offline from the Simulation panel
//   - while reconnecting, outgoing messages wait and incoming ones are held until connected;
//     while offline, sending fails and incoming messages are lost (like a real relay session)
//   - when the Security Lab runs in attacker mode, messages go "up" to the Lab, which forwards
//     them (and may tamper with them), exactly like an attacker who controls the relay.
import type {
  AutoAnswerMode,
  ConnectionState,
  FamilyAlert,
  GuardPrompt,
  PeerInfo,
  RelayService,
  SignedAnswer,
  Unsubscribe,
  VerifyRequest,
} from "../types";
import { RelayError } from "../errors";
import { randomId } from "../crypto";
import { latency, openBus, sleep, type Bus, type MsgKind, type Wire, type WireMsg } from "./bus";

const HEARTBEAT_MS = 2000;
const REACHABLE_MS = 6000;
// The Lab's attacker mode is sticky: it holds until the Lab says otherwise (or closes). The
// Lab re-announces itself whenever a phone appears, and heartbeats every second; a long stale
// window keeps routing correct even when the Lab's tab is in the background (timers throttled).
const LAB_STALE_MS = 150_000;
const LAB_ROUTING_KEY = "pehchaan:lab-routing";

type Listener<T> = (v: T) => void;

export interface SimRelayDeps {
  getAutoAnswer: () => Promise<AutoAnswerMode>;
  autoRespond: (req: VerifyRequest, mode: AutoAnswerMode, deliver: (ans: SignedAnswer) => void) => Promise<void>;
}

export class SimRelay implements RelayService {
  private me: string | null = null;
  private bus: Bus | null = null;
  private state: ConnectionState = "offline";
  private forced: ConnectionState | null = null;
  private booting = false;
  private info: { name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean } = { name: "", kind: "phone" };
  private peers = new Map<string, PeerInfo>();
  private lastReachable = "";
  private seen = new Set<string>();
  private labAt = 0;
  private labMode = false;
  private inbox: WireMsg[] = [];
  private waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  private lastMsg: number | null = null;
  private timers: number[] = [];

  private ls = {
    state: new Set<Listener<ConnectionState>>(),
    presence: new Set<Listener<string[]>>(),
    peers: new Set<Listener<PeerInfo[]>>(),
    request: new Set<Listener<VerifyRequest>>(),
    answer: new Set<Listener<SignedAnswer>>(),
    alert: new Set<Listener<FamilyAlert>>(),
    guard: new Set<Listener<GuardPrompt>>(),
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
    this.info = info;
    this.beat();
  }

  private beat() {
    if (!this.bus || !this.me || this.state !== "connected") return;
    this.bus.post({
      t: "presence",
      from: this.me,
      name: this.info.name,
      kind: this.info.kind,
      canBeVerified: this.info.canBeVerified,
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

  // ─── Messages ────────────────────────────────────────────────────────────

  private labControlled() {
    return this.labMode && Date.now() - this.labAt < LAB_STALE_MS;
  }

  // A reloaded tab remembers (for this tab session) whether the Lab controls the relay, so its
  // very first message is routed correctly — no race against the Lab's next announcement.
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

  private async waitConnected(): Promise<void> {
    if (this.state === "connected") return;
    if (this.state === "offline") throw new RelayError("offline");
    await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async send(kind: MsgKind, to: string, payload: unknown): Promise<void> {
    if (!this.me || !this.bus) throw new RelayError("offline");
    await this.waitConnected();
    await sleep(latency());
    if (this.state !== "connected") throw new RelayError(this.state === "offline" ? "offline" : "unreachable");
    const msg: WireMsg = {
      t: "msg",
      id: randomId("msg", 9),
      kind,
      from: this.me,
      to,
      payload,
      hop: this.labControlled() ? "up" : "deliver",
      at: Date.now(),
    };
    this.bus.post(msg);
    this.lastMsg = msg.at;
    // BroadcastChannel never echoes to its sender, so deliver messages to ourselves directly.
    if (to === this.me && msg.hop === "deliver") this.receive(msg);
  }

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
    switch (m.kind) {
      case "request":
        this.ls.request.forEach((cb) => cb(m.payload as VerifyRequest));
        break;
      case "answer":
        this.ls.answer.forEach((cb) => cb(m.payload as SignedAnswer));
        break;
      case "alert":
        this.ls.alert.forEach((cb) => cb(m.payload as FamilyAlert));
        break;
      case "guard":
        this.ls.guard.forEach((cb) => cb(m.payload as GuardPrompt));
        break;
    }
  }

  async sendRequest(req: VerifyRequest): Promise<void> {
    const mode = await this.deps.getAutoAnswer();
    if (mode !== "off") {
      // One-device testing: a simulated family member answers instead of another tab.
      await this.waitConnected();
      await sleep(latency());
      if (this.state !== "connected") throw new RelayError("offline");
      this.lastMsg = Date.now();
      void this.deps.autoRespond(req, mode, (ans) =>
        this.receive({
          t: "msg",
          id: randomId("msg", 9),
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
    await this.send("request", req.toDeviceId, req);
  }

  onRequest(cb: (req: VerifyRequest) => void): Unsubscribe {
    this.ls.request.add(cb);
    return () => this.ls.request.delete(cb);
  }

  sendAnswer(ans: SignedAnswer, toDeviceId: string): Promise<void> {
    return this.send("answer", toDeviceId, ans);
  }

  onAnswer(cb: (ans: SignedAnswer) => void): Unsubscribe {
    this.ls.answer.add(cb);
    return () => this.ls.answer.delete(cb);
  }

  async sendAlert(alert: FamilyAlert, toDeviceIds: string[]): Promise<void> {
    await Promise.all(toDeviceIds.map((to) => this.send("alert", to, alert)));
  }

  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe {
    this.ls.alert.add(cb);
    return () => this.ls.alert.delete(cb);
  }

  sendGuardPrompt(p: GuardPrompt, toDeviceId: string): Promise<void> {
    return this.send("guard", toDeviceId, p);
  }

  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe {
    this.ls.guard.add(cb);
    return () => this.ls.guard.delete(cb);
  }

  reportVerdict(r: Parameters<RelayService["reportVerdict"]>[0]): void {
    if (!this.bus || !this.me) return;
    this.bus.post({ t: "report", from: this.me, at: Date.now(), ...r });
  }
}
