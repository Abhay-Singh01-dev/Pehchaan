// The service worker's two signed HTTP routes (spec 11.2, 11.4). The app is closed, so there is no WebSocket
// login: each request is signed with the device key instead, over a message naming this relay, the device,
// what is asked and the time. The relay checks, in order:
//   1. the body's shape (strict);
//   2. its time is within ±120 s of the relay's clock (a captured request goes stale);
//   3. the device's rate limit;
//   4. the device exists and is neither retired nor blocked;
//   5. the signature, against the public key stored at the device's first login.
// Any failure says as little as possible. CORS allows only the app's own origins (registered in server.ts).
import { fetchMessage, resubscribeMessage, verifyDeviceRequest } from "@pehchaan/crypto/device-auth";
import {
  SIGNED_REQUEST_WINDOW_MS,
  inboxFetchBody,
  pushResubscribeBody,
  type InboxFetchBody,
  type PushResubscribeBody,
} from "@pehchaan/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Hub } from "../hub";
import type { StoredFrame } from "../core/inbox";
import { Refusal } from "../core/refusal";

type Checked<T> = { ok: true; body: T } | { ok: false; status: number; retryAfterMs?: number };

async function check<T extends { deviceId: string; ts: number; sig: string }>(
  hub: Hub,
  parse: (raw: unknown) => { success: true; data: T } | { success: false },
  raw: unknown,
  scope: "http_fetch_device" | "push_subscribe_device",
  message: (b: T) => Uint8Array,
): Promise<Checked<T>> {
  const parsed = parse(raw); // 1
  if (!parsed.success) return { ok: false, status: 400 };
  const b = parsed.data;
  if (Math.abs(Date.now() - b.ts) > SIGNED_REQUEST_WINDOW_MS) return { ok: false, status: 401 }; // 2
  try {
    await hub.limiter.take(scope, b.deviceId); // 3
    if (!(await hub.devices.isReachableTarget(b.deviceId))) return { ok: false, status: 403 }; // 4
    const pub = await hub.devices.publicKey(b.deviceId);
    if (!pub || !(await verifyDeviceRequest(pub, message(b), b.sig))) return { ok: false, status: 401 }; // 5
  } catch (e) {
    if (e instanceof Refusal && e.code === "rate_limited") {
      return { ok: false, status: 429, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}) };
    }
    return { ok: false, status: 503 }; // Valkey or Postgres down: fail closed (15.5)
  }
  return { ok: true, body: b };
}

function refuseWith(reply: FastifyReply, c: { status: number; retryAfterMs?: number }) {
  if (c.retryAfterMs) reply.header("retry-after", String(Math.ceil(c.retryAfterMs / 1000)));
  return reply.code(c.status).send({ ok: false });
}

export function registerSignedRoutes(app: FastifyInstance, hub: Hub): void {
  const host = hub.config.RELAY_HOST;

  /** 11.4: the frame a wake push points at, from the device's own inbox (never removed here: the app acks it). */
  app.post("/v1/inbox/fetch", async (req, reply) => {
    const c = await check<InboxFetchBody>(
      hub,
      (raw) => inboxFetchBody.safeParse(raw),
      req.body,
      "http_fetch_device",
      (b) => fetchMessage(host, b.deviceId, b.msgId, b.ts),
    );
    if (!c.ok) return refuseWith(reply, c);
    let text: string | null;
    try {
      text = await hub.redis.get(hub.keys.inboxFrame(c.body.deviceId, c.body.msgId));
    } catch {
      return reply.code(503).send({ ok: false });
    }
    if (!text) return reply.code(404).send({ ok: false });
    const stored = JSON.parse(text) as StoredFrame;
    const ttlMs = stored.expiresAt - Date.now();
    if (ttlMs <= 0) return reply.code(404).send({ ok: false });
    // As on a socket: the time left is rewritten to the relay's clock now (8.3).
    return { frame: { ...stored.frame, sts: Date.now(), body: { ...stored.frame.body, ttlMs } } };
  });

  /** 11.2 (P1): the browser replaced the push subscription while the app was closed. */
  app.post("/v1/push/resubscribe", async (req, reply) => {
    const c = await check<PushResubscribeBody>(
      hub,
      (raw) => pushResubscribeBody.safeParse(raw),
      req.body,
      "push_subscribe_device",
      (b) => resubscribeMessage(host, b.deviceId, b.subscription.endpoint, b.ts),
    );
    if (!c.ok) return refuseWith(reply, c);
    try {
      await hub.subscriptions.save(c.body.deviceId, c.body.subscription);
      if (c.body.oldEndpoint && c.body.oldEndpoint !== c.body.subscription.endpoint) {
        await hub.subscriptions.remove(c.body.deviceId, c.body.oldEndpoint);
      }
    } catch (e) {
      // Not an allowed push service (SSRF guard, 11.3), or the database is down.
      return reply.code(e instanceof Refusal && e.code === "not_allowed" ? 400 : 503).send({ ok: false });
    }
    return reply.code(204).send();
  });
}
