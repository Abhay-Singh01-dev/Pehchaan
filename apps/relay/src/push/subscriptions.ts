// Web Push subscriptions (spec 11.1–11.3, 15.2): an endpoint URL at a push service plus the browser's
// encryption keys. Re-sent by the app on every login. Cached for 10 minutes in ps:<device> (15.5).
//
// SSRF guard (11.3): only https endpoints at the known push services are ever stored, so the relay can
// never be tricked into calling an internal URL.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ClientBody } from "@pehchaan/protocol";
import type { Keys } from "../core/keys";
import { CACHE_TTL_MS } from "../core/devices";
import type { RelayRedis } from "../core/redis";
import { refuse } from "../core/refusal";
import type { Db } from "../store/db";
import { pushSubscriptions } from "../store/schema";
import type { PushStatus } from "./push";

/** The push services (11.3). */
export const PUSH_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^(.+\.)?push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^(.+\.)?notify\.windows\.com$/,
];

export function pushServiceOf(endpoint: string): "fcm" | "apple" | "mozilla" | "wns" | null {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return null;
  }
  // https only, the default port only, no credentials in the URL.
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (PUSH_HOSTS[0]!.test(host)) return "fcm";
  if (PUSH_HOSTS[1]!.test(host)) return "apple";
  if (PUSH_HOSTS[2]!.test(host)) return "mozilla";
  if (PUSH_HOSTS[3]!.test(host)) return "wns";
  return null;
}

export interface Subscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  vapidKeyId: string;
}

interface Cached {
  subs: Subscription[];
  hadExpired: boolean;
}

export function createSubscriptions(o: { db: Db; redis: RelayRedis; keys: Keys }) {
  const { db, redis, keys } = o;

  async function load(deviceId: string): Promise<Cached> {
    const key = keys.pushCache(deviceId);
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Cached;
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        vapidKeyId: pushSubscriptions.vapidKeyId,
        expiredAt: pushSubscriptions.expiredAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.deviceId, deviceId));
    const value: Cached = {
      subs: rows.filter((r) => !r.expiredAt).map(({ expiredAt: _e, ...s }) => s),
      hadExpired: rows.some((r) => r.expiredAt),
    };
    await redis.set(key, JSON.stringify(value), "PX", CACHE_TTL_MS);
    return value;
  }

  return {
    async save(deviceId: string, s: ClientBody<"push.subscribe">): Promise<void> {
      if (!pushServiceOf(s.endpoint)) refuse("not_allowed");
      const previous = await db
        .select({ deviceId: pushSubscriptions.deviceId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, s.endpoint))
        .limit(1);
      await db
        .insert(pushSubscriptions)
        .values({ deviceId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, vapidKeyId: s.vapidKeyId })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { deviceId, p256dh: s.p256dh, auth: s.auth, vapidKeyId: s.vapidKeyId, expiredAt: null, failureCount: 0 },
        });
      await redis.del(keys.pushCache(deviceId), ...(previous[0] ? [keys.pushCache(previous[0].deviceId)] : []));
    },

    async remove(deviceId: string, endpoint: string): Promise<void> {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.deviceId, deviceId), eq(pushSubscriptions.endpoint, endpoint)));
      await redis.del(keys.pushCache(deviceId));
    },

    async active(deviceId: string): Promise<Subscription[]> {
      return (await load(deviceId)).subs;
    },

    /** For auth.ok (11.2): the app silently re-subscribes when this says expired or missing. */
    async status(deviceId: string): Promise<PushStatus> {
      const c = await load(deviceId);
      return c.subs.length ? "ok" : c.hadExpired ? "expired" : "missing";
    },

    /** 404/410, or 403 after a VAPID key rotation: the subscription is dead (11.3). */
    async expire(deviceId: string, id: number): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({ expiredAt: sql`now()` })
        .where(and(eq(pushSubscriptions.id, id), isNull(pushSubscriptions.expiredAt)));
      await redis.del(keys.pushCache(deviceId));
    },

    async success(id: number): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: sql`now()`, failureCount: 0 })
        .where(eq(pushSubscriptions.id, id));
    },

    async failure(id: number): Promise<void> {
      await db
        .update(pushSubscriptions)
        .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
        .where(eq(pushSubscriptions.id, id));
    },
  };
}
export type Subscriptions = ReturnType<typeof createSubscriptions>;
