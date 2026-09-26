// The WebSocket to the relay (backend spec 7.1, 7.3, 8.9): login, heartbeat, reconnection and the three
// connection states the UI shows.
//   connected     logged in (auth.ok received)
//   reconnecting  a retry is scheduled or in progress, for less than 30 s
//   offline       navigator.onLine is false, or reconnecting has taken 30 s or more
// Backoff: 0.5, 1, 2, 4, 8 s, then every 8 s, each ±30%, so thousands of phones don't reconnect at the same
// instant after a deploy. Reconnect at once when the phone comes online, the app becomes visible, or a
// notification is tapped; `reconnect { afterMs }` from a draining relay waits that long first.
import { authMessage, signAuth } from "@pehchaan/crypto/device-auth";
import { CLOSE, SUBPROTOCOL, TIMING, parseRelayFrame, ulid, type RelayBody, type RelayFrame } from "@pehchaan/protocol";
import type { IdentityRow } from "@/store/db";
import type { ConnectionState } from "../../types";

export interface SocketOptions {
  url: string;
  relayHost: string;
  identity: () => Promise<IdentityRow>;
  appVersion: string;
  platform: string;
  onFrame: (f: RelayFrame) => void;
  onLogin: (hello: RelayBody<"hello">, ok: RelayBody<"auth.ok">) => void;
  onState: (s: ConnectionState) => void;
  onUpdateRequired: () => void;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
}

/** Delay before reconnect attempt `n` (0-based), with ±30% jitter (8.9). */
export function backoffMs(n: number, random: () => number = Math.random): number {
  const steps = TIMING.RECONNECT_BACKOFF_MS;
  const base = steps[Math.min(n, steps.length - 1)]!;
  const jitter = 1 + (random() * 2 - 1) * TIMING.RECONNECT_JITTER;
  return Math.round(base * jitter);
}

export class RelaySocket {
  private ws: WebSocket | null = null;
  private authed = false;
  private attempts = 0;
  private stateNow: ConnectionState = "reconnecting";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt: number | null = Date.now();
  private stopped = true;
  /** Close codes after which retrying would be wrong: retired/blocked, replaced, too old. */
  private halted: number | null = null;
  private offset = 0;
  private pings = new Map<string, (serverTime: number) => void>();
  hello: RelayBody<"hello"> | null = null;

  constructor(private o: SocketOptions) {}

  get state(): ConnectionState {
    return this.stateNow;
  }

  get isAuthed(): boolean {
    return this.authed && this.ws?.readyState === 1;
  }

  /** serverTime − localNow, from auth.ok and every pong: for display only (8.7). */
  get clockOffsetMs(): number {
    return this.offset;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.halted = null;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.clearTimers();
    this.clearOfflineTimer();
    this.ws?.close(1000);
    this.ws = null;
  }

  /** Reconnect now (a notification tap, Diagnostics "Reconnect now"). */
  reconnectNow(): void {
    if (this.stopped) return;
    this.halted = null;
    this.attempts = 0;
    this.drop();
    this.open();
  }

  send(frame: object): boolean {
    if (!this.isAuthed) return false;
    this.ws!.send(JSON.stringify(frame));
    return true;
  }

  /** Round-trip time of an app-level ping, in ms. */
  ping(): Promise<number> {
    const id = ulid();
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      // Listen for the pong before sending, however fast it comes back.
      const timer = setTimeout(() => {
        this.pings.delete(id);
        reject(new Error("timeout"));
      }, TIMING.APP_PONG_TIMEOUT_MS);
      this.pings.set(id, () => {
        clearTimeout(timer);
        resolve(Math.round(performance.now() - t0));
      });
      if (!this.send({ v: 1, t: "ping", id, ts: Date.now(), body: {} })) {
        clearTimeout(timer);
        this.pings.delete(id);
        reject(new Error("offline"));
      }
    });
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private onOnline = () => this.reconnectNow();
  private onOffline = () => this.setState("offline");
  private onVisible = () => {
    if (document.visibilityState === "visible" && !this.isAuthed) this.reconnectNow();
  };

  private setState(s: ConnectionState) {
    if (s === this.stateNow) return;
    this.stateNow = s;
    this.o.onState(s);
  }

  private computeDisconnectedState() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return this.setState("offline");
    const since = this.disconnectedAt ?? Date.now();
    this.setState(Date.now() - since >= TIMING.OFFLINE_AFTER_MS ? "offline" : "reconnecting");
  }

  /** Clears the connection's timers. The 30 s offline timer is NOT one of them: it spans the whole disconnection,
   *  across failed attempts, and ends only at a login (or stop). */
  private clearTimers() {
    for (const t of [this.retryTimer, this.pongTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = this.pongTimer = this.pingTimer = null;
  }

  private clearOfflineTimer() {
    if (this.offlineTimer) clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
  }

  /** "offline" exactly 30 s after the disconnection began, however many attempts happen meanwhile (8.9). */
  private armOfflineTimer() {
    if (this.offlineTimer || this.disconnectedAt === null) return;
    const left = TIMING.OFFLINE_AFTER_MS - (Date.now() - this.disconnectedAt);
    this.offlineTimer = setTimeout(
      () => {
        this.offlineTimer = null;
        this.computeDisconnectedState();
      },
      Math.max(0, left),
    );
  }

  private drop() {
    this.authed = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) {
      ws.onclose = null;
      ws.close(1000);
    }
  }

  private open() {
    if (this.stopped || this.halted !== null) return;
    this.disconnectedAt ??= Date.now();
    this.computeDisconnectedState();
    // After 30 s of trying, the state turns offline even if the retries continue.
    this.armOfflineTimer();
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.o.url, SUBPROTOCOL);
    } catch {
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onmessage = (e) => void this.onMessage(ws, String(e.data));
    ws.onclose = (e) => this.onClose(ws, e.code);
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(afterMs?: number) {
    if (this.stopped || this.halted !== null) return;
    const delay = afterMs ?? backoffMs(this.attempts++, this.o.random);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private onClose(ws: WebSocket, code: number) {
    if (ws !== this.ws) return;
    this.authed = false;
    this.clearTimers();
    this.ws = null;
    this.disconnectedAt ??= Date.now();
    if (code === CLOSE.APP_TOO_OLD) {
      this.halted = code;
      this.o.onUpdateRequired();
    } else if (code === CLOSE.RETIRED_OR_BLOCKED || code === CLOSE.REPLACED) {
      // Retired or blocked: nothing will change by retrying. Replaced: another tab of this app took over;
      // this one reconnects when it becomes visible again.
      this.halted = code;
    }
    this.computeDisconnectedState();
    this.scheduleRetry();
  }

  private async onMessage(ws: WebSocket, text: string) {
    const f = parseRelayFrame(text);
    if (!f) return; // unknown or malformed notices are ignored (7.6)
    if (f.t === "hello") {
      this.hello = f.body;
      const me = await this.o.identity();
      const sig = await signAuth(me.signKey.privateKey, authMessage(this.o.relayHost, f.body.serverNonce, me.deviceId));
      if (ws !== this.ws) return;
      ws.send(
        JSON.stringify({
          v: 1,
          t: "auth",
          id: ulid(),
          ts: Date.now(),
          body: {
            deviceId: me.deviceId,
            devicePub: me.devicePub,
            sig,
            client: { ver: this.o.appVersion, platform: this.o.platform },
          },
        }),
      );
      return;
    }
    if (f.t === "auth.ok") {
      this.authed = true;
      this.attempts = 0;
      this.disconnectedAt = null;
      this.clearOfflineTimer();
      this.offset = f.body.serverTime - Date.now();
      this.startHeartbeat();
      this.setState("connected");
      this.o.onLogin(this.hello!, f.body);
      return;
    }
    if (f.t === "pong") {
      this.offset = f.body.serverTime - Date.now();
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
      // The relay answers pings in order; any pong completes the pending pings.
      for (const [id, cb] of this.pings) {
        cb(f.body.serverTime);
        this.pings.delete(id);
      }
      return;
    }
    if (f.t === "reconnect") {
      // A draining relay (18.9): leave, wait the given time, then come back (Caddy picks a healthy relay).
      this.drop();
      this.disconnectedAt = Date.now();
      this.computeDisconnectedState();
      this.scheduleRetry(Math.min(f.body.afterMs, 5000));
      return;
    }
    this.o.onFrame(f);
  }

  /** Browsers can't send ping frames: the app sends {t:"ping"} every 25 s while visible, and treats a missing
   *  pong after 10 s as a dead connection (7.1). */
  private startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!this.send({ v: 1, t: "ping", id: ulid(), ts: Date.now(), body: {} })) return;
      if (this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        // Dead: reconnect.
        this.drop();
        this.disconnectedAt = Date.now();
        this.computeDisconnectedState();
        this.scheduleRetry();
      }, TIMING.APP_PONG_TIMEOUT_MS);
    }, TIMING.APP_PING_MS);
  }
}
