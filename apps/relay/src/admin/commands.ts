// Admin tasks (spec 16.8). There are no admin HTTP endpoints: these run over SSH on the VM,
//   docker compose exec relay-a node dist/admin.js <command>
// so the relay has no admin surface to attack (16.4). Every action is written to audit_events.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { CLOSE, TIMING } from "@pehchaan/protocol";
import type { Audit } from "../core/audit";
import type { Bus } from "../core/bus";
import type { Keys } from "../core/keys";
import type { RelayRedis } from "../core/redis";
import type { Store } from "../store/db";
import { auditEvents, contactBindings, devices, labAttacks, pushSubscriptions } from "../store/schema";

export interface AdminDeps {
  store: Store;
  redis: RelayRedis;
  keys: Keys;
  bus: Bus;
  audit: Audit;
  retire: (deviceId: string, by: "admin") => Promise<void>;
}

/** The retention SQL, shared with the nightly backup job (infra/backup/retention.sql). */
export function retentionSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "..", "..", "infra", "backup", "retention.sql"), // src/admin → repo root
    join(here, "..", "retention.sql"), // dist/ in the image (copied by the Dockerfile)
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try the next location */
    }
  }
  throw new Error("retention.sql not found");
}

export function createAdmin(d: AdminDeps) {
  const kick = (deviceId: string) =>
    d.bus.publish(d.keys.adminChannel(), { t: "kick", deviceId, code: CLOSE.RETIRED_OR_BLOCKED });

  return {
    /** Refuses future logins and closes the device's sockets on every gateway (4403). */
    async block(deviceId: string, reason: string): Promise<boolean> {
      const r = await d.store.db
        .update(devices)
        .set({ blockedAt: sql`now()`, blockReason: reason })
        .where(eq(devices.deviceId, deviceId))
        .returning({ id: devices.deviceId });
      await d.redis.del(d.keys.deviceCache(deviceId)); // drop the status cache (15.5)
      await kick(deviceId);
      await d.audit.record("device_blocked", deviceId, { reason: reason.slice(0, 80) });
      return r.length === 1;
    },

    async unblock(deviceId: string): Promise<boolean> {
      const r = await d.store.db
        .update(devices)
        .set({ blockedAt: null, blockReason: null })
        .where(eq(devices.deviceId, deviceId))
        .returning({ id: devices.deviceId });
      await d.redis.del(d.keys.deviceCache(deviceId));
      await d.audit.record("device_unblocked", deviceId);
      return r.length === 1;
    },

    /** For deletion requests received by email (24.7). */
    async retire(deviceId: string): Promise<void> {
      await d.retire(deviceId, "admin");
    },

    /** Counts only: no IDs, no content. The canary's synthetic devices are left out (19.6). */
    async stats() {
      const db = d.store.db;
      const real = sql`coalesce(${devices.platform}, '') <> 'canary'`;
      const n = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
      return {
        devicesActive: await n(
          db
            .select({ n: count() })
            .from(devices)
            .where(and(isNull(devices.retiredAt), real)),
        ),
        devicesRetired: await n(
          db
            .select({ n: count() })
            .from(devices)
            .where(and(isNotNull(devices.retiredAt), real)),
        ),
        devicesBlocked: await n(
          db
            .select({ n: count() })
            .from(devices)
            .where(and(isNotNull(devices.blockedAt), real)),
        ),
        bindings: await n(db.select({ n: count() }).from(contactBindings).where(isNull(contactBindings.revokedAt))),
        bindingsRevoked: await n(
          db.select({ n: count() }).from(contactBindings).where(isNotNull(contactBindings.revokedAt)),
        ),
        pushSubscriptions: await n(
          db.select({ n: count() }).from(pushSubscriptions).where(isNull(pushSubscriptions.expiredAt)),
        ),
        auditEvents24h: await n(
          db
            .select({ n: count() })
            .from(auditEvents)
            .where(sql`${auditEvents.at} > now() - interval '1 day'`),
        ),
        labAttacks: await n(db.select({ n: count() }).from(labAttacks)),
        labFalseGreens: await n(db.select({ n: count() }).from(labAttacks).where(eq(labAttacks.falseGreen, true))),
      };
    },

    /** The Security Lab's runtime switch (14.1): on for at most 12 hours, off at once, no deploy. */
    async lab(on: boolean): Promise<void> {
      if (on) await d.redis.set(d.keys.labSwitch(), "on", "PX", TIMING.LAB_SWITCH_MS);
      else await d.redis.del(d.keys.labSwitch(), d.keys.labArmed());
      await d.bus.publish(d.keys.labChannel(), { t: "switch", on });
      await d.audit.record("lab_session", null, { switch: on ? "on" : "off" });
    },

    /** Runs the retention rules now (normally the nightly backup job does). */
    async retention(): Promise<void> {
      await d.store.pool.query(retentionSql());
    },
  };
}
export type Admin = ReturnType<typeof createAdmin>;
