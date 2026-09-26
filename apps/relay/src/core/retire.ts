// "Delete my key" / leave Pehchaan (spec 6.6), and `admin retire` for deletion requests (24.7).
//
// The device row becomes a TOMBSTONE (ID, public key, retire date; platform and version cleared): that ID can
// never log in again, and blocks attached to it stay. Then the relay deletes the device's grants, push
// subscriptions, inbox, the bindings where it is the target, and the non-revoked bindings where it is the
// sender. REVOKED bindings are kept, so a blocked device can't erase its block by retiring.
import { and, eq, isNull, sql } from "drizzle-orm";
import { CLOSE } from "@pehchaan/protocol";
import type { Db } from "../store/db";
import { contactBindings, contactGrants, devices, pushSubscriptions } from "../store/schema";
import type { Audit } from "./audit";
import type { Bus } from "./bus";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

export function createRetire(o: { db: Db; redis: RelayRedis; keys: Keys; bus: Bus; audit: Audit }) {
  const { db, redis, keys } = o;
  return async function retire(deviceId: string, by: "device" | "admin" = "device"): Promise<void> {
    const targets = await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ retiredAt: sql`coalesce(${devices.retiredAt}, now())`, platform: null, appVersion: null })
        .where(eq(devices.deviceId, deviceId));
      await tx.delete(contactGrants).where(eq(contactGrants.targetDeviceId, deviceId));
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.deviceId, deviceId));
      await tx.delete(contactBindings).where(eq(contactBindings.targetDeviceId, deviceId));
      // Bindings where it was the sender: the targets' caches must forget it. Revoked rows stay.
      return tx
        .delete(contactBindings)
        .where(and(eq(contactBindings.senderDeviceId, deviceId), isNull(contactBindings.revokedAt)))
        .returning({ target: contactBindings.targetDeviceId });
    });
    // Valkey: the inbox, status and subscription caches, the device's own binding and grant caches, and
    // every cache that listed it as an allowed sender.
    const inboxIds = await redis.zrange(keys.inboxIndex(deviceId), 0, -1);
    await redis.del(
      keys.deviceCache(deviceId),
      keys.pushCache(deviceId),
      keys.grantCache(deviceId),
      keys.bindingCache(deviceId),
      keys.inboxIndex(deviceId),
      ...inboxIds.map((m) => keys.inboxFrame(deviceId, m)),
      ...targets.map((t) => keys.bindingCache(t.target)),
    );
    // Every gateway closes this device's sockets (4403).
    await o.bus.publish(keys.adminChannel(), { t: "kick", deviceId, code: CLOSE.RETIRED_OR_BLOCKED });
    await o.audit.record("device_retired", deviceId, { by });
  };
}
