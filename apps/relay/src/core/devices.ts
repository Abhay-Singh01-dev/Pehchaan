// Devices (spec 5.2, 6.6, 7.3, 15.2): the relay knows a device by its self-certifying ID and public key.
// Status (exists / retired / blocked) is cached in Valkey for 10 minutes and deleted on change (15.5).
// A cache miss that can't reach Postgres throws: authorisation fails closed (`unavailable`).
import { eq, sql } from "drizzle-orm";
import type { Db } from "../store/db";
import { devices } from "../store/schema";
import type { Audit } from "./audit";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

export const CACHE_TTL_MS = 10 * 60_000;

export interface DeviceStatus {
  exists: boolean;
  retired: boolean;
  blocked: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function createDevices(o: { redis: RelayRedis; keys: Keys; db: Db; audit: Audit }) {
  const { redis, keys, db } = o;

  async function status(deviceId: string): Promise<DeviceStatus> {
    const key = keys.deviceCache(deviceId);
    const c = await redis.hgetall(key);
    if (c.exists !== undefined) {
      return { exists: c.exists === "1", retired: c.retired === "1", blocked: c.blocked === "1" };
    }
    const row = await db
      .select({ retiredAt: devices.retiredAt, blockedAt: devices.blockedAt })
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);
    const s: DeviceStatus = {
      exists: row.length === 1,
      retired: Boolean(row[0]?.retiredAt),
      blocked: Boolean(row[0]?.blockedAt),
    };
    await redis
      .multi()
      .hset(key, { exists: s.exists ? "1" : "0", retired: s.retired ? "1" : "0", blocked: s.blocked ? "1" : "0" })
      .pexpire(key, CACHE_TTL_MS)
      .exec();
    return s;
  }

  return {
    status,

    /** The device's public signing key, for its signed HTTP requests (11.2, 11.4). Null if never seen. */
    async publicKey(deviceId: string): Promise<Uint8Array | null> {
      const row = await db
        .select({ pub: devices.devicePub })
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);
      return row[0] ? new Uint8Array(row[0].pub) : null;
    },

    /** A device that can be contacted: seen before, not retired, not blocked. */
    async isReachableTarget(deviceId: string): Promise<boolean> {
      const s = await status(deviceId);
      return s.exists && !s.retired && !s.blocked;
    },

    /** At login (7.3): create the row the first time, then refresh last_seen_on at most once a day. */
    async touch(deviceId: string, pubRaw: Uint8Array, platform: string, appVersion: string): Promise<void> {
      const key = keys.deviceCache(deviceId);
      if ((await redis.hget(key, "seen")) === today()) return;
      const r = await db
        .insert(devices)
        .values({ deviceId, devicePub: Buffer.from(pubRaw), platform, appVersion })
        .onConflictDoUpdate({
          target: devices.deviceId,
          set: { lastSeenOn: sql`current_date`, platform, appVersion },
          // Retired rows are tombstones: nothing about them changes again (15.3).
          setWhere: sql`${devices.retiredAt} is null`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (r[0]?.inserted) {
        await redis.del(key); // it exists now
        await o.audit.record("device_first_seen", deviceId, { platform });
      }
      await redis.multi().hset(key, "seen", today()).pexpire(key, CACHE_TTL_MS).exec();
    },

    async invalidate(deviceId: string): Promise<void> {
      await redis.del(keys.deviceCache(deviceId));
    },
  };
}
export type Devices = ReturnType<typeof createDevices>;
