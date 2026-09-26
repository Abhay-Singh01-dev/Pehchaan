// Inboxes (spec 8.5): every envelope a device should get waits here until it is acked or expires, so
// losing a socket, a pub/sub message or a whole gateway never loses an envelope (20.3).
import { LIMITS } from "@pehchaan/protocol";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

/** A deliver frame as stored: the relay's own expiry travels with it, so every delivery can rewrite
 *  `ttlMs` to the time actually left (8.3). */
export interface StoredFrame {
  frame: {
    v: 1;
    t: "deliver";
    id: string;
    sts: number;
    body: Record<string, unknown> & { from: string; kind: string };
  };
  expiresAt: number;
}

export function createInbox(redis: RelayRedis, keys: Keys) {
  return {
    /** Stores the envelope until expiresAt. False when the inbox is full (50 entries). */
    async put(deviceId: string, s: StoredFrame, now: number): Promise<boolean> {
      const ttl = s.expiresAt - now;
      if (ttl <= 0) return true; // nothing left to wait for: never store a stale envelope
      const r = await redis.inboxPut(
        keys.inboxIndex(deviceId),
        keys.inboxFrame(deviceId, s.frame.id),
        s.frame.id,
        s.expiresAt,
        JSON.stringify(s),
        ttl,
        now,
        LIMITS.INBOX_MAX_ENTRIES,
      );
      return r === 1;
    },

    /** Every unexpired envelope, soonest expiry first (the login drain). */
    async pending(deviceId: string, now: number): Promise<StoredFrame[]> {
      const ids = await redis.zrangebyscore(keys.inboxIndex(deviceId), now + 1, "+inf");
      if (ids.length === 0) return [];
      const frames = await redis.mget(ids.map((id) => keys.inboxFrame(deviceId, id)));
      return frames.filter((f): f is string => f !== null).map((f) => JSON.parse(f) as StoredFrame);
    },

    /** Removes the envelope from the device's OWN inbox; returns it the first time only (16.3 ack row). */
    async ack(deviceId: string, msgId: string): Promise<StoredFrame | null> {
      const f = await redis.inboxAck(keys.inboxIndex(deviceId), keys.inboxFrame(deviceId, msgId), msgId);
      return f ? (JSON.parse(f) as StoredFrame) : null;
    },

    async size(deviceId: string): Promise<number> {
      return redis.zcard(keys.inboxIndex(deviceId));
    },
  };
}
export type Inbox = ReturnType<typeof createInbox>;
