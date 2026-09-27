// One simulated phone (spec 21.4). It talks to the relay the way the app does (apps/web RealRelay and socket):
//   - logs in with its device key, then re-registers its grant after every login (8.9);
//   - keeps every message until the relay confirms it, and re-sends it with the SAME id after each login, so the
//     relay's idempotency returns the original outcome and nothing is routed twice (the outbox, 8.4);
//   - acks every delivery at once and drops duplicates by message id (8.4);
//   - reconnects with the app's backoff, and honours `reconnect { afterMs }` from a draining relay (18.9).
import WebSocket from "ws";
import { SUBPROTOCOL, parseRelayFrame, ulid, type RelayFrame } from "@pehchaan/protocol";
import { CANARY_VERSION, type Endpoint } from "@pehchaan/canary/client";
import type { CanaryDevice } from "@pehchaan/canary/device";
import { backoffMs } from "./backoff";

export type Deliver = Extract<RelayFrame, { t: "deliver" }>;
export type Receipt = Extract<RelayFrame, { t: "receipt" }>["body"];

/** The relay's own retryable refusals (apps/relay core/refusal.ts): try again later with the same id. */
const RETRYABLE = new Set(["rate_limited", "unavailable"]);
/** A final receipt settles a message; `delivered` and `read` are progress notices. */
const FINAL = new Set(["accepted", "rejected", "failed"]);

interface Pending {
  t: string;
  body: unknown;
  resolve: (r: Receipt) => void;
  reject: (e: Error) => void;
}

export class Session {
  /** Logged in and the grant registered: sends go out at once. */
  ready = false;
  logins = 0;
  /** The relay container this socket is on (from `hello`), e.g. "relay-a-3f9c1e". */
  gateway = "";
  onDeliver: (f: Deliver) => void = () => {};
  onReceipt: (r: Receipt) => void = () => {};

  private ws: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private grantFrameId: string | null = null;
  private outbox = new Map<string, Pending>();
  private seen = new Set<string>();
  private readyWaiters: Array<() => void> = [];

  constructor(
    readonly device: CanaryDevice,
    private ep: Endpoint,
  ) {}

  /** Connects and resolves at the first login (it keeps reconnecting until then, like the app). */
  start(): Promise<void> {
    this.open();
    return this.whenReady();
  }

  whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  /** Sends through the outbox; resolves with the final receipt (accepted, rejected or failed). */
  send(t: string, body: unknown, id: string = ulid()): Promise<Receipt> {
    return new Promise((resolve, reject) => {
      this.outbox.set(id, { t, body, resolve, reject });
      if (this.ready && this.ws) this.write(this.ws, t, body, id);
    });
  }

  /** Airplane mode for `ms` (CHAOS-05): the socket drops without a close handshake, and nothing reconnects until
   *  `ms` has passed. Unconfirmed messages stay in the outbox and go out again after the next login. */
  goOffline(ms: number): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    ws?.terminate();
    this.scheduleRetry(ms);
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
    for (const [id, p] of this.outbox) p.reject(new Error(`stopped before ${id} was confirmed`));
    this.outbox.clear();
  }

  private open(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.ep.url, SUBPROTOCOL, {
      origin: this.ep.origin,
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      ...(this.ep.ca ? { ca: this.ep.ca } : {}),
    });
    this.ws = ws;
    ws.on("message", (data) => void this.onMessage(ws, String(data)));
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => {
      /* "close" follows */
    });
  }

  private onClose(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.ready = false;
    this.scheduleRetry();
  }

  private scheduleRetry(afterMs?: number): void {
    if (this.stopped || this.retryTimer) return;
    const delay = afterMs ?? backoffMs(this.attempts++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /** Leaves the current socket without waiting for its close event (a draining relay asked us to). */
  private drop(): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    ws?.close(1000);
  }

  private write(ws: WebSocket, t: string, body: unknown, id: string): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, t, id, ts: Date.now(), body }));
  }

  private async onMessage(ws: WebSocket, text: string): Promise<void> {
    const f = parseRelayFrame(text);
    if (!f || ws !== this.ws) return;
    switch (f.t) {
      case "hello": {
        this.gateway = f.body.gatewayId;
        const auth = await this.device.authBody(f.body.serverNonce, this.ep.relayHost, CANARY_VERSION);
        if (ws === this.ws) this.write(ws, "auth", auth, ulid());
        return;
      }
      case "auth.ok": {
        // 8.9: the grant first, then the outbox (so nothing queued overtakes it).
        this.grantFrameId = ulid();
        const d = this.device;
        this.write(ws, "grant.set", { grantId: d.grantId, hash: d.grantHash, rotate: false }, this.grantFrameId);
        return;
      }
      case "receipt": {
        if (f.body.of === this.grantFrameId) {
          if (f.body.state === "accepted") return this.becomeReady(ws);
          this.drop();
          this.scheduleRetry();
          return;
        }
        const p = this.outbox.get(f.body.of);
        if (p && FINAL.has(f.body.state)) {
          this.outbox.delete(f.body.of);
          p.resolve(f.body);
        }
        this.onReceipt(f.body);
        return;
      }
      case "error": {
        const of = f.body.of;
        if (of === this.grantFrameId || f.body.code === "unauthenticated") {
          this.drop();
          this.scheduleRetry();
          return;
        }
        const p = of ? this.outbox.get(of) : undefined;
        if (!p || !of) return;
        if (RETRYABLE.has(f.body.code)) {
          setTimeout(() => this.ready && this.ws && this.write(this.ws, p.t, p.body, of), f.body.retryAfterMs ?? 2000);
        } else {
          this.outbox.delete(of);
          p.reject(new Error(`refused: ${f.body.code}`));
        }
        return;
      }
      case "reconnect":
        // A draining relay (18.9): leave, wait the given time (at most 5 s), and come back through the proxy.
        this.drop();
        this.scheduleRetry(Math.min(f.body.afterMs, 5000));
        return;
      case "deliver":
        this.write(ws, "ack", { of: f.id }, ulid());
        if (this.seen.has(f.id)) return;
        this.seen.add(f.id);
        this.onDeliver(f);
        return;
      default:
        return;
    }
  }

  private becomeReady(ws: WebSocket): void {
    this.ready = true;
    this.attempts = 0;
    this.logins++;
    for (const [id, p] of this.outbox) this.write(ws, p.t, p.body, id);
    for (const r of this.readyWaiters.splice(0)) r();
  }
}
