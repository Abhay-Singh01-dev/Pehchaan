// One WebSocket (spec 7.1–7.3): the hello/auth handshake, heartbeats, frame limits, and in-order handling of
// everything the device sends.
import { randomBytes } from "node:crypto";
import {
  CLOSE,
  LIMITS,
  TIMING,
  parseClientFrame,
  relayFrame,
  ulid,
  type RelayBody,
  type RelayType,
} from "@pehchaan/protocol";
import type { WebSocket } from "ws";
import type { Hub } from "../hub";
import { localGcra } from "../core/ratelimit";
import { Refusal, toRefusal } from "../core/refusal";
import type { ErrorCode } from "@pehchaan/protocol";
import type { LocalSocket } from "../core/router";
import { dispatch } from "./dispatch";
import type { SessionSocket } from "./sessions";

export class Connection implements SessionSocket, LocalSocket {
  readonly openedAt = Date.now();
  deviceId: string | null = null;
  platform = "unknown";
  /** 32 random bytes, used for exactly one login attempt (7.3). */
  serverNonce: string | null = randomBytes(32).toString("base64url");
  /** Set by the Lab module when this socket is a Lab page. */
  labSessionId: string | null = null;
  private closed = false;
  private authTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private missedPongs = 0;
  private badFrames: number[] = [];
  private frameLimit = localGcra({ limit: 20, windowMs: 1000, burst: 40 });
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly hub: Hub,
    readonly ws: WebSocket,
    readonly ip: string,
    readonly connId: number,
    private readonly hooks: { onAuthenticated: (c: Connection) => void; onGone: (c: Connection) => void },
  ) {}

  /** Sends hello, then waits for auth (10 s deadline) while pinging every 25 s. */
  start(): void {
    const c = this.hub.config;
    this.ws.on("message", (data, isBinary) => this.onMessage(data as Buffer, isBinary));
    this.ws.on("pong", () => (this.missedPongs = 0));
    this.ws.on("close", () => this.onClose());
    this.ws.on("error", () => this.onClose());
    this.send("hello", {
      serverNonce: this.serverNonce!,
      serverTime: Date.now(),
      gatewayId: this.hub.gatewayId,
      minClient: c.MIN_CLIENT_VERSION,
      vapidKeyId: c.VAPID_KEY_ID,
      env: c.ENV_NAME,
      e2eRequired: c.E2E_REQUIRED,
    });
    this.authTimer = setTimeout(() => {
      if (!this.deviceId) {
        this.hub.metrics.wsAuth.inc({ result: "timeout" });
        this.close(CLOSE.LOGIN_TIMEOUT, "login timeout");
      }
    }, c.AUTH_DEADLINE_MS);
    this.pingTimer = setInterval(() => {
      // Two missed pongs → the socket is dead (7.1). This also keeps proxy idle timers from firing.
      if (this.missedPongs >= TIMING.RELAY_MISSED_PONGS) {
        this.ws.terminate();
        return;
      }
      this.missedPongs++;
      try {
        this.ws.ping();
      } catch {
        /* closing */
      }
    }, c.RELAY_PING_MS);
  }

  authenticated(deviceId: string, platform: string): void {
    this.deviceId = deviceId;
    this.platform = platform;
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
    this.hooks.onAuthenticated(this);
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === this.ws.OPEN;
  }

  /** LocalSocket: writes a serialised frame, closing slow readers (16.2). */
  sendText(text: string): void {
    if (!this.isOpen) return;
    // A reader with 1 MiB already waiting is too slow, or doing it on purpose.
    if (this.ws.bufferedAmount > LIMITS.BUFFERED_MAX_BYTES) {
      this.close(CLOSE.POLICY, "slow reader");
      return;
    }
    this.ws.send(text);
  }

  send<T extends RelayType>(t: T, body: RelayBody<T>, id: string = ulid()): void {
    this.sendText(JSON.stringify(relayFrame(t, id, body)));
  }

  /** error { code, of?, retryAfterMs? } (7.5). */
  sendError(r: { code: ErrorCode; retryAfterMs?: number }, of?: string): void {
    this.send("error", {
      code: r.code,
      ...(of ? { of } : {}),
      ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
    });
  }

  close(code: number, reason = ""): void {
    if (this.closed) return;
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
    this.onClose();
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (this.closed) return;
    if (isBinary) return this.close(CLOSE.BINARY_FRAME, "text frames only");
    if (data.length > LIMITS.FRAME_MAX_BYTES) {
      // 16–64 KiB: refused with too_large (larger frames never get here: the socket limit closes them, 1009).
      this.hub.metrics.messages.inc({ t: "?", kind: "", result: "too_large" });
      this.sendError({ code: "too_large" });
      return;
    }
    const wait = this.frameLimit();
    if (wait > 0) {
      this.hub.metrics.rateLimited.inc({ scope: "frame_socket" });
      this.sendError({ code: "rate_limited", retryAfterMs: wait });
      return;
    }
    const text = data.toString("utf8");
    // Frames from one socket are handled strictly in order (auth before anything else, for instance).
    this.queue = this.queue.then(() => this.handle(text)).catch(() => {});
  }

  private async handle(text: string): Promise<void> {
    if (this.closed) return;
    const parsed = parseClientFrame(text);
    if (!parsed.ok) {
      this.hub.metrics.messages.inc({ t: "?", kind: "", result: "bad_request" });
      this.sendError({ code: "bad_request" }, parsed.id);
      this.noteBadFrame();
      return;
    }
    const f = parsed.frame;
    try {
      await dispatch(this.hub, this, f);
      this.hub.metrics.messages.inc({ t: f.t, kind: f.t === "send" ? f.body.kind : "", result: "ok" });
    } catch (e) {
      const r = toRefusal(e);
      // An infrastructure failure (Valkey or Postgres), not a refusal: fail closed and say so, without content.
      if (!(e instanceof Refusal)) this.hub.log.warn({ t: f.t, err: (e as Error)?.name ?? "error" }, "failing closed");
      this.hub.metrics.messages.inc({ t: f.t, kind: f.t === "send" ? f.body.kind : "", result: r.code });
      this.sendError(r, f.id);
    }
  }

  /** Three bad frames within a minute → close 4400 (7.2). */
  private noteBadFrame(): void {
    const now = Date.now();
    this.badFrames = this.badFrames.filter((t) => now - t < 60_000);
    this.badFrames.push(now);
    if (this.badFrames.length >= LIMITS.BAD_FRAMES_PER_MINUTE) this.close(CLOSE.BAD_FRAMES, "bad frames");
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.hooks.onGone(this);
  }
}
