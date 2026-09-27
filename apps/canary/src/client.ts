// A minimal relay client for the canary (spec 7.1–7.4): connect with the subprotocol and the app's Origin, log in
// with the device key, then send frames and wait for the relay's replies.
import WebSocket from "ws";
import { SUBPROTOCOL, parseRelayFrame, ulid, type RelayFrame } from "@pehchaan/protocol";
import type { CanaryDevice } from "./device";

/** The canary's own version, sent at login like an app's (7.3: a semver, at least the relay's minimum). */
export const CANARY_VERSION = "1.0.0";

export interface Endpoint {
  /** wss://relay.example/v1/ws */
  url: string;
  /** The app origin the relay accepts (Origin header). */
  origin: string;
  /** The host the relay signs logins for. */
  relayHost: string;
}

export class RelayClient {
  readonly frames: RelayFrame[] = [];
  private waiters: Array<{ pred: (f: RelayFrame) => boolean; resolve: (f: RelayFrame) => void }> = [];

  private constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const f = parseRelayFrame(String(data));
      if (!f) return;
      this.frames.push(f);
      for (const w of [...this.waiters]) {
        if (w.pred(f)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(f);
        }
      }
    });
  }

  static open(ep: Endpoint): Promise<RelayClient> {
    const ws = new WebSocket(ep.url, SUBPROTOCOL, { origin: ep.origin, perMessageDeflate: false });
    return new Promise((resolve, reject) => {
      const c = new RelayClient(ws);
      ws.once("open", () => resolve(c));
      ws.once("unexpected-response", (_q, res) =>
        reject(new Error(`relay refused the connection: HTTP ${res.statusCode}`)),
      );
      ws.once("error", reject);
    });
  }

  send(t: string, body: unknown, id: string = ulid()): string {
    this.ws.send(JSON.stringify({ v: 1, t, id, ts: Date.now(), body }));
    return id;
  }

  next(pred: (f: RelayFrame) => boolean, timeoutMs: number, what: string): Promise<RelayFrame> {
    const found = this.frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i < 0) return;
        this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }, timeoutMs);
    });
  }

  /** hello → auth → auth.ok, then grant.set (as the app does after every login, 8.9). */
  async login(device: CanaryDevice, ep: Endpoint, timeoutMs: number): Promise<void> {
    const hello = await this.next((f) => f.t === "hello", timeoutMs, "hello");
    if (hello.t !== "hello") throw new Error("no hello");
    this.send("auth", await device.authBody(hello.body.serverNonce, ep.relayHost, CANARY_VERSION));
    const r = await this.next((f) => f.t === "auth.ok" || f.t === "error", timeoutMs, "auth.ok");
    if (r.t !== "auth.ok") throw new Error(`login refused: ${JSON.stringify(r.body)}`);
    const id = this.send("grant.set", { grantId: device.grantId, hash: device.grantHash, rotate: false });
    await this.accepted(id, timeoutMs, "grant.set");
  }

  /** Waits for `receipt { of: id, state: accepted }`; an error or a rejected receipt fails the run. */
  async accepted(id: string, timeoutMs: number, what: string): Promise<void> {
    const f = await this.next(
      (x) => (x.t === "receipt" || x.t === "error") && x.body.of === id,
      timeoutMs,
      `${what} accepted`,
    );
    if (f.t !== "receipt" || f.body.state !== "accepted") throw new Error(`${what} refused: ${JSON.stringify(f.body)}`);
  }

  close(): void {
    this.ws.close();
  }
}
