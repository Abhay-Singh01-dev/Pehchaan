// Test devices: real WebCrypto keys (never mocked), the real login handshake, and a WebSocket client that
// records every frame the relay sends.
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { authMessage, deviceIdFrom, signAuth } from "@pehchaan/crypto/device-auth";
import { b64url } from "@pehchaan/crypto/bytes";
import { signPlain } from "@pehchaan/crypto/plain-sig";
import {
  SUBPROTOCOL,
  parseRelayFrame,
  ulid,
  type ClientBody,
  type ClientType,
  type RelayFrame,
} from "@pehchaan/protocol";
import type { Relay } from "../../src/relay";
import { ORIGIN, RELAY_HOST } from "./relays";

export interface ClientOptions {
  origin?: string;
  protocol?: string | string[];
  headers?: Record<string, string>;
  autoPong?: boolean;
  perMessageDeflate?: boolean;
}

export class TestClient {
  readonly frames: RelayFrame[] = [];
  private waiters: Array<{ pred: (f: RelayFrame) => boolean; resolve: (f: RelayFrame) => void }> = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  hello: RelayFrame | null = null;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
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

  static open(relay: Relay | number, o: ClientOptions = {}): Promise<TestClient> {
    const port = typeof relay === "number" ? relay : relay.port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, o.protocol ?? SUBPROTOCOL, {
      origin: o.origin ?? ORIGIN,
      headers: o.headers,
      autoPong: o.autoPong ?? true,
      perMessageDeflate: o.perMessageDeflate ?? false,
    });
    return new Promise((resolve, reject) => {
      const c = new TestClient(ws);
      ws.once("open", () => resolve(c));
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once("error", (e) => reject(e));
    });
  }

  send<T extends ClientType>(t: T, body: ClientBody<T> | Record<string, unknown>, id: string = ulid()): string {
    this.ws.send(JSON.stringify({ v: 1, t, id, ts: Date.now(), body }));
    return id;
  }

  /** The first frame (already received or still to come) that matches. */
  next(pred: (f: RelayFrame) => boolean, timeoutMs = 5000): Promise<RelayFrame> {
    const found = this.frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`timed out waiting for a frame; got: ${this.frames.map((f) => f.t).join(",")}`));
        }
      }, timeoutMs);
    });
  }

  type<T extends RelayFrame["t"]>(
    t: T,
    pred: (f: Extract<RelayFrame, { t: T }>) => boolean = () => true,
    timeoutMs = 5000,
  ) {
    return this.next((f) => f.t === t && pred(f as Extract<RelayFrame, { t: T }>), timeoutMs) as Promise<
      Extract<RelayFrame, { t: T }>
    >;
  }

  receipt(of: string, state: string, timeoutMs = 5000) {
    return this.type("receipt", (f) => f.body.of === of && f.body.state === state, timeoutMs);
  }

  error(of: string, timeoutMs = 5000) {
    return this.type("error", (f) => f.body.of === of, timeoutMs);
  }

  all<T extends RelayFrame["t"]>(t: T): Array<Extract<RelayFrame, { t: T }>> {
    return this.frames.filter((f) => f.t === t) as Array<Extract<RelayFrame, { t: T }>>;
  }

  close(): void {
    this.ws.close();
  }
}

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export class TestDevice {
  private constructor(
    readonly deviceId: string,
    readonly sign: CryptoKeyPair,
    readonly enc: CryptoKeyPair,
    readonly dk: string,
    readonly ek: string,
    public grant: { id: string; secret: string; hash: string },
  ) {}

  static async create(): Promise<TestDevice> {
    const sign = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
    const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const dkRaw = new Uint8Array(await crypto.subtle.exportKey("raw", sign.publicKey));
    const ekRaw = new Uint8Array(await crypto.subtle.exportKey("raw", enc.publicKey));
    return new TestDevice(await deviceIdFrom(dkRaw), sign, enc, b64url(dkRaw), b64url(ekRaw), TestDevice.newGrant());
  }

  static newGrant() {
    const secretBytes = crypto.getRandomValues(new Uint8Array(16));
    return {
      id: b64url(crypto.getRandomValues(new Uint8Array(8))),
      secret: b64url(secretBytes),
      hash: createHash("sha256").update(secretBytes).digest("base64url"),
    };
  }

  /** The grant string on this device's card: "<grantId>.<secret>". */
  get cardGrant(): string {
    return `${this.grant.id}.${this.grant.secret}`;
  }

  /** The auth frame body for a given hello nonce and relay host. */
  async authBody(serverNonce: string, relayHost = RELAY_HOST, ver = "1.0.0") {
    const sig = await signAuth(this.sign.privateKey, authMessage(relayHost, serverNonce, this.deviceId));
    return { deviceId: this.deviceId, devicePub: this.dk, sig, client: { ver, platform: "test" } };
  }

  /** Connects and logs in; also registers the grant, as the app does after every login (8.9). */
  async login(relay: Relay | number, o: ClientOptions & { grant?: boolean; ver?: string } = {}): Promise<TestClient> {
    const c = await TestClient.open(relay, o);
    const hello = await c.type("hello");
    c.hello = hello;
    c.send("auth", await this.authBody(hello.body.serverNonce, RELAY_HOST, o.ver));
    await c.type("auth.ok");
    if (o.grant !== false) {
      const id = c.send("grant.set", { grantId: this.grant.id, hash: this.grant.hash, rotate: false });
      await c.receipt(id, "accepted");
    }
    return c;
  }

  /** A plain (Lab/pre-E2E) send body with a valid sender signature (9.5). */
  async plainSend(
    kind: "verify.request" | "verify.answer" | "alert" | "guard.prompt",
    to: TestDevice | string,
    o: { id?: string; re?: string; grant?: string; ttlMs?: number; plain?: Record<string, unknown> } = {},
  ) {
    const toId = typeof to === "string" ? to : to.deviceId;
    const id = o.id ?? ulid();
    const re = o.re ?? (kind === "verify.request" ? id : undefined);
    const plain = o.plain ?? this.samplePayload(kind, toId, re);
    const psig = await signPlain(
      plain,
      { kind, id, from: this.deviceId, to: toId, ...(re ? { re } : {}) },
      this.sign.privateKey,
    );
    return {
      id,
      re,
      body: {
        kind,
        to: toId,
        ...(re ? { re } : {}),
        ...(o.grant ? { grant: o.grant } : {}),
        ttlMs: o.ttlMs ?? (kind === "verify.request" ? 60_000 : 0),
        plain,
        psig,
      },
    };
  }

  samplePayload(kind: string, to: string, re?: string): Record<string, unknown> {
    const now = Date.now();
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
    if (kind === "verify.request") {
      return {
        spk: this.dk,
        sek: this.ek,
        fromName: "Sunita",
        req: {
          v: 1,
          requestId: re!,
          nonce,
          fromDeviceId: this.deviceId,
          toDeviceId: to,
          claimedLabel: "Arjun",
          createdAt: now,
          expiresAt: now + 60_000,
        },
      };
    }
    if (kind === "verify.answer") {
      return {
        spk: this.dk,
        ans: {
          requestId: re!,
          nonce,
          decision: "NOT_ME",
          keyType: "pk",
          credId: b64url(new Uint8Array(16).fill(1)),
          authenticatorData: b64url(new Uint8Array(37).fill(2)),
          clientDataJSON: b64url(new TextEncoder().encode('{"type":"webauthn.get"}')),
          signature: b64url(new Uint8Array(70).fill(3)),
          answeredAt: now,
        },
      };
    }
    if (kind === "alert") {
      return {
        spk: this.dk,
        sek: this.ek,
        alert: {
          id: `a${now}`,
          type: "impersonation",
          aboutDeviceId: to,
          aboutLabel: "Arjun",
          victimName: "Sunita",
          createdAt: now,
        },
      };
    }
    return { spk: this.dk, prompt: { claimedLabel: "Arjun", tactics: ["identity"], at: now } };
  }
}

/** Two devices where `asker` may contact `target`: the target is registered (logged in once with its grant),
 *  and the asker holds the target's card grant. */
export async function pair(relay: Relay) {
  const asker = await TestDevice.create();
  const target = await TestDevice.create();
  const a = await asker.login(relay);
  const t = await target.login(relay);
  return { asker, target, a, t };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
