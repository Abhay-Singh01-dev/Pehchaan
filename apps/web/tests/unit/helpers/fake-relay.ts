// A scripted relay for RealRelay's unit tests: a WebSocket stand-in that speaks the wire protocol (7.1–7.4).
// It checks the phone's login signature with the real security core and answers the way the real relay does
// (hello → auth.ok, `accepted` receipts). Tests then script deliveries, refusals and closes. The real relay is
// exercised end to end by the Playwright journeys (tests/e2e); this one isolates the app's protocol client.
import { verifyAuth } from "@pehchaan/crypto/device-auth";
import { b64url } from "@pehchaan/crypto/bytes";
import { ulid } from "@pehchaan/protocol";

export const RELAY_HOST = "relay.pehchaan.test";

export interface ClientFrame {
  v: 1;
  t: string;
  id: string;
  ts: number;
  body: Record<string, unknown>;
}

export class FakeSocket {
  readyState = 0;
  protocol = "";
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly frames: ClientFrame[] = [];

  constructor(
    private relay: FakeRelay,
    readonly url: string,
    readonly protocols: string | string[],
  ) {
    relay.sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.protocol = Array.isArray(protocols) ? protocols[0]! : protocols;
      void relay.onOpen(this);
    });
  }

  /** The phone sends a frame. */
  send(text: string): void {
    const f = JSON.parse(text) as ClientFrame;
    this.frames.push(f);
    void this.relay.onFrame(this, f);
  }

  /** The phone closes the socket. */
  close(): void {
    this.readyState = 3;
  }

  /** The relay sends a frame. */
  push(t: string, body: unknown, id: string = ulid()): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, id, sts: Date.now() + this.relay.clockAheadMs, body }) });
  }

  /** The relay closes the socket with a code. */
  kill(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

export class FakeRelay {
  readonly sockets: FakeSocket[] = [];
  /** Every frame any phone sent, in order. */
  readonly frames: ClientFrame[] = [];
  /** The relay's clock is this far ahead of the phone's (display offsets only, 8.7). */
  clockAheadMs = 0;
  /** Reply to a client frame; return false to send nothing (the default accepts sends and control messages). */
  reply: (s: FakeSocket, f: ClientFrame) => boolean | void = () => undefined;
  authed = new Set<FakeSocket>();
  loginFailures = 0;
  /** What auth.ok reports about this phone's push subscription. */
  pushStatus: "ok" | "missing" | "expired" = "ok";
  private nonces = new Map<FakeSocket, string>();

  /** Pass as RealRelay's WebSocketImpl. */
  readonly Impl = ((relay: FakeRelay) =>
    class extends FakeSocket {
      constructor(url: string, protocols: string | string[]) {
        super(relay, url, protocols);
      }
    })(this) as unknown as typeof WebSocket;

  get last(): FakeSocket {
    const s = this.sockets.at(-1);
    if (!s) throw new Error("no socket yet");
    return s;
  }

  async onOpen(s: FakeSocket): Promise<void> {
    const serverNonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.nonces.set(s, serverNonce);
    s.push("hello", {
      serverNonce,
      serverTime: Date.now() + this.clockAheadMs,
      gatewayId: "gw-test",
      minClient: "1.0.0",
      vapidKeyId: "v1",
      env: "test",
      e2eRequired: false,
    });
  }

  async onFrame(s: FakeSocket, f: ClientFrame): Promise<void> {
    this.frames.push(f);
    if (f.t === "auth") {
      const ok = await verifyAuth(f.body as never, this.nonces.get(s)!, RELAY_HOST);
      if (!ok) {
        this.loginFailures++;
        return s.kill(4401);
      }
      this.authed.add(s);
      return s.push("auth.ok", {
        serverTime: Date.now() + this.clockAheadMs,
        pushStatus: this.pushStatus,
        lab: { optedIn: false },
      });
    }
    if (this.reply(s, f) === false) return;
    if (f.t === "ping") return s.push("pong", { serverTime: Date.now() + this.clockAheadMs });
    if (f.t === "ack" || f.t === "seen" || f.t.startsWith("presence") || f.t === "contact.list") return;
    s.push("receipt", { of: f.id, state: "accepted", ...(typeof f.body.re === "string" ? { re: f.body.re } : {}) });
  }

  /** Frames of one type the phone sent. */
  sent(t: string): ClientFrame[] {
    return this.frames.filter((f) => f.t === t);
  }
}

/** Resolves when `check` passes (polling), or throws after `ms`. */
export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}
