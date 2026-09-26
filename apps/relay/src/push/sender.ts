// The Web Push sender (spec 11.3, 11.4, 11.8, 11.9; metrics 19.1).
//
// A push carries the deliver frame itself (sealed end to end inside, and encrypted again by Web Push to the
// subscription's keys, RFC 8291), so the phone can show F1 before its WebSocket has even connected. A frame
// over 3,000 bytes travels as a small "wake" instead; the service worker then fetches it (POST /v1/inbox/fetch).
//
// Every request is TTL-bounded (never deliver a stale request) and urgent. Requests, answers and cancels carry a
// Topic, so a cancel replaces its undelivered request in the push service's queue. Each subscription is signed
// with its own VAPID key (key rotation, 11.9). Endpoints are re-checked against the allowlist before every
// call (SSRF, 11.3), and never logged.
import { createHash } from "node:crypto";
import { request } from "undici";
import webpush from "web-push";
import { LIMITS, ulid } from "@pehchaan/protocol";
import type { Logger } from "pino";
import type { StoredFrame } from "../core/inbox";
import type { Metrics } from "../metrics";
import type { Push, PushOutcome } from "./push";
import { pushServiceOf, type Subscription, type Subscriptions } from "./subscriptions";

export interface VapidKey {
  id: string;
  publicKey: string;
  privateKey: string;
}

/** The first 32 characters of base64url(SHA-256(requestId)): a request and its cancel share it (11.3). */
export function topicFor(requestId: string): string {
  return createHash("sha256").update(requestId, "utf8").digest("base64url").slice(0, 32);
}

const RETRY_5XX_MS = [500, 1500];
const RETRY_AFTER_MAX_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5000;

type Attempt = "pushed" | "gone" | "too_large" | "failed";

export function createWebPush(o: {
  subscriptions: Subscriptions;
  /** The current key first; during a rotation also the previous one (11.9). */
  keys: VapidKey[];
  subject: string;
  metrics: Metrics;
  log: Logger;
  /** Test only (D-011): send every push to this mock push service instead of the endpoint's host. */
  testTarget?: string;
  sleep?: (ms: number) => Promise<void>;
}): Push {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** One HTTP request to the push service. */
  async function post(sub: Subscription, key: VapidKey, payload: string, ttlSec: number, topic?: string) {
    const details = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      {
        TTL: ttlSec,
        urgency: "high",
        contentEncoding: "aes128gcm",
        vapidDetails: { subject: o.subject, publicKey: key.publicKey, privateKey: key.privateKey },
        ...(topic ? { topic } : {}),
      },
    );
    const url = o.testTarget ? `${o.testTarget}/push?endpoint=${encodeURIComponent(sub.endpoint)}` : sub.endpoint;
    const res = await request(url, {
      method: "POST",
      headers: details.headers as Record<string, string>,
      body: details.body ?? undefined,
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS,
    });
    await res.body.dump();
    const retryAfter = Number(res.headers["retry-after"]);
    return { status: res.statusCode, retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null };
  }

  /** Sends to one subscription, following the 11.3 response table. */
  async function sendTo(
    deviceId: string,
    sub: Subscription,
    payload: string,
    ttlSec: number,
    topic?: string,
  ): Promise<Attempt> {
    const service = pushServiceOf(sub.endpoint);
    const key = o.keys.find((k) => k.id === sub.vapidKeyId);
    // Not an allowed push service, or signed with a key this relay no longer holds: the subscription can't be
    // used. Expire it; the app subscribes again at its next login.
    if (!service || !key) {
      await o.subscriptions.expire(deviceId, sub.id);
      return "gone";
    }
    let serverErrors = 0;
    let rateLimited = false;
    for (;;) {
      const started = Date.now();
      let status: number;
      let retryAfterMs: number | null = null;
      try {
        ({ status, retryAfterMs } = await post(sub, key, payload, ttlSec, topic));
      } catch {
        status = 0; // timeout or network error: treated like a 5xx
      }
      o.metrics.pushLatency.observe({ service }, Date.now() - started);
      const result = status >= 200 && status < 300 ? "ok" : status === 0 ? "timeout" : String(status);
      o.metrics.push.inc({ service, result });

      if (status >= 200 && status < 300) {
        await o.subscriptions.success(sub.id);
        return "pushed";
      }
      if (status === 404 || status === 410 || status === 403) {
        // Gone, or (403) signed with a VAPID key the push service no longer accepts after a rotation.
        await o.subscriptions.expire(deviceId, sub.id);
        return "gone";
      }
      if (status === 413) return "too_large";
      if (status === 429 && !rateLimited) {
        rateLimited = true;
        await sleep(Math.min(retryAfterMs ?? 1000, RETRY_AFTER_MAX_MS));
        continue;
      }
      if ((status === 0 || status >= 500) && serverErrors < RETRY_5XX_MS.length) {
        await sleep(RETRY_5XX_MS[serverErrors++]!);
        continue;
      }
      if (status === 400) o.log.warn({ service, status }, "push rejected as malformed");
      await o.subscriptions.failure(sub.id);
      return "failed";
    }
  }

  /** Sends a payload to every active subscription of the device. */
  async function sendAll(
    deviceId: string,
    payload: () => string,
    wake: () => string,
    ttlSec: number,
    topic?: string,
  ): Promise<PushOutcome> {
    const subs = await o.subscriptions.active(deviceId);
    if (subs.length === 0) return "queued";
    let pushed = false;
    for (const sub of subs) {
      const body = payload();
      // Over the size limit: a small wake instead (11.4); 413 from the push service: retry once as a wake.
      const first = Buffer.byteLength(body) > LIMITS.PUSH_MAX_FRAME_BYTES ? wake() : body;
      let r = await sendTo(deviceId, sub, first, ttlSec, topic);
      if (r === "too_large" && first !== wake()) r = await sendTo(deviceId, sub, wake(), ttlSec, topic);
      if (r === "pushed") pushed = true;
    }
    return pushed ? "pushed" : "failed";
  }

  return {
    async send(to: string, stored: StoredFrame): Promise<PushOutcome> {
      const ttlMs = stored.expiresAt - Date.now();
      if (ttlMs <= 0) return "failed";
      const f = stored.frame;
      // The time left is rewritten on every delivery, as on a socket (8.3).
      const payload = () => JSON.stringify({ ...f, sts: Date.now(), body: { ...f.body, ttlMs } });
      const wake = () => JSON.stringify({ t: "wake", id: f.id, kind: f.body.kind, from: f.body.from });
      const re = typeof f.body.re === "string" ? f.body.re : undefined;
      return sendAll(to, payload, wake, Math.ceil(ttlMs / 1000), re ? topicFor(re) : undefined);
    },

    async sendTest(to: string): Promise<PushOutcome> {
      const frame = JSON.stringify({ t: "test", id: ulid(), sts: Date.now() });
      return sendAll(
        to,
        () => frame,
        () => frame,
        60,
      );
    },

    async close(): Promise<void> {
      /* no pooled connections of our own: undici's global dispatcher closes with the process */
    },
  };
}
