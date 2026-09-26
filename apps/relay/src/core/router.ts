// Routing (spec 8.2, 8.3): getting an envelope to a device, wherever it is.
//
//   1. Store it in the device's inbox (durable across gateways until it expires).
//   2. Find the gateways holding a socket for the device (rt:<device>, filtered by gateway liveness).
//   3. None → Web Push (or `queued`, if the device has no subscription).
//      Some → deliver locally, or publish to the owning gateway's channel.
//   4. A delivered frame that isn't acked within 1.5 s may be on a socket the OS has frozen → push too.
// Every delivery rewrites body.ttlMs to the time actually left on the relay's clock; nothing stale is sent.
import type { Logger } from "pino";
import type { Metrics } from "../metrics";
import type { Push, PushOutcome } from "../push/push";
import type { Bus } from "./bus";
import type { Inbox, StoredFrame } from "./inbox";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

export const ROUTE_TTL_MS = 24 * 60 * 60_000;
export const GATEWAY_ALIVE_TTL_MS = 30_000;

export interface LocalSocket {
  sendText(text: string): void;
}

export type BusMessage =
  | { type: "deliver"; to: string; stored: StoredFrame; push: boolean }
  | { type: "notify"; to: string; frame: unknown }
  | { type: "kick"; deviceId: string; code: number };

export type RouteOutcome = "routed" | PushOutcome;

export function createRouter(o: {
  gatewayId: string;
  redis: RelayRedis;
  keys: Keys;
  bus: Bus;
  inbox: Inbox;
  push: () => Push;
  sockets: (deviceId: string) => readonly LocalSocket[];
  ackFallbackMs: number;
  metrics: Metrics;
  log: Logger;
  /** Called with the outcome of a push that happened after routing (ack timeout, or a gateway that found no
   *  socket), so the sender gets its `pushed`/`failed` receipt. */
  onLatePush: (stored: StoredFrame, to: string, outcome: PushOutcome) => void;
}) {
  const { redis, keys } = o;
  /** Ack timers: "<deviceId> <msgId>" → timer. */
  const acks = new Map<string, NodeJS.Timeout>();

  async function aliveGateways(deviceId: string): Promise<string[]> {
    const gws = await redis.smembers(keys.route(deviceId));
    if (gws.length === 0) return [];
    const alive = await redis.mget(gws.map((g) => keys.gatewayAlive(g)));
    const dead = gws.filter((_, i) => alive[i] === null);
    // Lazy cleanup: a gateway whose liveness key expired is gone (8.2).
    if (dead.length) await redis.srem(keys.route(deviceId), ...dead);
    return gws.filter((_, i) => alive[i] !== null);
  }

  async function pushNow(to: string, stored: StoredFrame): Promise<PushOutcome> {
    if (stored.expiresAt - Date.now() <= 0) return "failed";
    try {
      return await o.push().send(to, stored);
    } catch (e) {
      o.log.warn({ err: (e as Error).message }, "push error");
      return "failed";
    }
  }

  /** Writes the frame to this gateway's sockets for the device. Returns false if it had none. */
  function localDeliver(to: string, stored: StoredFrame, pushAllowed: boolean): boolean {
    const ttl = stored.expiresAt - Date.now();
    if (ttl <= 0) return true; // too late: drop, never deliver stale
    const sockets = o.sockets(to);
    if (sockets.length === 0) {
      if (pushAllowed) void pushNow(to, stored).then((r) => o.onLatePush(stored, to, r));
      return false;
    }
    const text = JSON.stringify({ ...stored.frame, sts: Date.now(), body: { ...stored.frame.body, ttlMs: ttl } });
    for (const s of sockets) s.sendText(text);
    o.metrics.routeLatency.observe(Math.max(0, Date.now() - stored.frame.sts));
    if (pushAllowed) {
      const key = `${to} ${stored.frame.id}`;
      clearTimeout(acks.get(key));
      acks.set(
        key,
        setTimeout(() => {
          acks.delete(key);
          // Still in the inbox (not acked)? The socket may be frozen: wake the phone with a push.
          void redis
            .exists(keys.inboxFrame(to, stored.frame.id))
            .then((n) => (n ? pushNow(to, stored).then((r) => o.onLatePush(stored, to, r)) : undefined))
            .catch(() => {});
        }, o.ackFallbackMs),
      );
    }
    return true;
  }

  return {
    aliveGateways,
    localDeliver,

    /** Stores (if asked) and routes an envelope. */
    async route(to: string, stored: StoredFrame, p: { inbox: boolean; push: boolean }): Promise<RouteOutcome | "full"> {
      if (p.inbox) {
        const ok = await o.inbox.put(to, stored, Date.now());
        o.metrics.inboxPut.inc();
        if (!ok) {
          o.metrics.inboxFull.inc();
          return "full";
        }
      }
      const gateways = await aliveGateways(to);
      if (gateways.length === 0) return p.push ? pushNow(to, stored) : "queued";
      for (const g of gateways) {
        if (g === o.gatewayId) localDeliver(to, stored, p.push);
        else
          await o.bus.publish(keys.gatewayChannel(g), {
            type: "deliver",
            to,
            stored,
            push: p.push,
          } satisfies BusMessage);
      }
      return "routed";
    },

    /** Live-only delivery (receipts, presence answers, Lab notices): no inbox, no push. */
    async notify(to: string, frame: unknown): Promise<void> {
      const local = o.sockets(to);
      if (local.length) {
        const text = JSON.stringify(frame);
        for (const s of local) s.sendText(text);
      }
      const gateways = (await aliveGateways(to)).filter((g) => g !== o.gatewayId);
      for (const g of gateways) {
        await o.bus.publish(keys.gatewayChannel(g), { type: "notify", to, frame } satisfies BusMessage);
      }
    },

    /** The device acked: stop waiting to push. */
    acked(deviceId: string, msgId: string): void {
      const key = `${deviceId} ${msgId}`;
      clearTimeout(acks.get(key));
      acks.delete(key);
    },

    async addRoute(deviceId: string): Promise<void> {
      await redis.multi().sadd(keys.route(deviceId), o.gatewayId).pexpire(keys.route(deviceId), ROUTE_TTL_MS).exec();
    },

    async removeRoute(deviceId: string): Promise<void> {
      await redis.srem(keys.route(deviceId), o.gatewayId);
    },

    /** Refreshes this gateway's liveness key (every 10 s, 8.2). */
    async heartbeat(): Promise<void> {
      await redis.set(keys.gatewayAlive(o.gatewayId), "1", "PX", GATEWAY_ALIVE_TTL_MS);
    },

    stop(): void {
      for (const t of acks.values()) clearTimeout(t);
      acks.clear();
    },
  };
}
export type Router = ReturnType<typeof createRouter>;
