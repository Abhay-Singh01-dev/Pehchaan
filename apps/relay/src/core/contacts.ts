// Who may contact whom (spec 6.4, 16.3).
//
//  - Grant: each device registers SHA-256(secret) of the grant on its card. The relay never stores secrets.
//  - First contact: a sender presents the grant it holds; if it matches an active grant of the target, the
//    relay records a binding "target ← sender". Senders keep presenting it, so bindings re-form by themselves
//    if the table is ever lost (15.4).
//  - Revocation: a revoked binding can't be recreated with ANY grant. Only the target can clear it
//    (contact.unrevoke, when it re-adds that device in person).
//  - Answers need no binding: the request record authorises them.
//
// Caches (15.5): cb:<target> = allowed senders, cg:<target> = active grants; 10 minutes; deleted on change.
// A cache miss that can't reach Postgres throws, so authorisation fails closed.
import { createHash, timingSafeEqual } from "node:crypto";
import { and, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { CONTACTS } from "@pehchaan/protocol";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import type { Db } from "../store/db";
import { contactBindings, contactGrants } from "../store/schema";
import type { Audit } from "./audit";
import { CACHE_TTL_MS } from "./devices";
import type { Keys } from "./keys";
import type { RateLimiter } from "./ratelimit";
import type { RelayRedis } from "./redis";
import { refuse } from "./refusal";

/** Marks a cache set as loaded even when it has no members (Valkey drops empty sets). */
const LOADED = ".";

/** grant = "<grantId>.<secret>" → SHA-256 of the secret's bytes, as the target registered it (D-028). */
export function grantSecretHash(secretB64: string): Buffer {
  return createHash("sha256").update(b64urlDecode(secretB64)).digest();
}

export function createContacts(o: { redis: RelayRedis; keys: Keys; db: Db; audit: Audit; limiter: RateLimiter }) {
  const { redis, keys, db, audit, limiter } = o;

  async function allowedSenders(target: string): Promise<Set<string>> {
    const key = keys.bindingCache(target);
    const cached = await redis.smembers(key);
    if (cached.length > 0) return new Set(cached.filter((m) => m !== LOADED));
    const rows = await db
      .select({ sender: contactBindings.senderDeviceId })
      .from(contactBindings)
      .where(and(eq(contactBindings.targetDeviceId, target), isNull(contactBindings.revokedAt)));
    const senders = rows.map((r) => r.sender);
    await redis
      .multi()
      .sadd(key, LOADED, ...senders)
      .pexpire(key, CACHE_TTL_MS)
      .exec();
    return new Set(senders);
  }

  async function activeGrants(target: string): Promise<Record<string, string>> {
    const key = keys.grantCache(target);
    const cached = await redis.hgetall(key);
    if (cached[LOADED] !== undefined) {
      delete cached[LOADED];
      return cached;
    }
    const rows = await db
      .select({ grantId: contactGrants.grantId, hash: contactGrants.secretHash })
      .from(contactGrants)
      .where(and(eq(contactGrants.targetDeviceId, target), isNull(contactGrants.revokedAt)));
    const grants = Object.fromEntries(rows.map((r) => [r.grantId, r.hash.toString("hex")]));
    await redis
      .multi()
      .hset(key, { [LOADED]: "1", ...grants })
      .pexpire(key, CACHE_TTL_MS)
      .exec();
    return grants;
  }

  function grantMatches(grants: Record<string, string>, grant: string): string | null {
    const dot = grant.indexOf(".");
    const grantId = grant.slice(0, dot);
    const stored = grants[grantId];
    if (!stored) return null;
    let presented: Buffer;
    try {
      presented = grantSecretHash(grant.slice(dot + 1));
    } catch {
      return null;
    }
    return timingSafeEqual(presented, Buffer.from(stored, "hex")) ? grantId : null;
  }

  return {
    grantMatches,

    /** May `sender` contact `target`? Creates the binding on a valid first contact. Throws not_allowed. */
    async authorise(target: string, sender: string, grant: string | undefined): Promise<void> {
      if ((await allowedSenders(target)).has(sender)) return;
      const row = await db
        .select({ revokedAt: contactBindings.revokedAt })
        .from(contactBindings)
        .where(and(eq(contactBindings.targetDeviceId, target), eq(contactBindings.senderDeviceId, sender)))
        .limit(1);
      if (row[0]?.revokedAt) refuse("not_allowed"); // revoked: no grant can bring it back
      if (row[0]) {
        await redis.del(keys.bindingCache(target)); // an allowed row the cache didn't know: refresh it
        return;
      }
      if (!grant) refuse("not_allowed");
      const grantId = grantMatches(await activeGrants(target), grant!);
      if (!grantId) refuse("not_allowed");
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(contactBindings)
        .where(and(eq(contactBindings.targetDeviceId, target), isNull(contactBindings.revokedAt)));
      if (n >= CONTACTS.BINDINGS_PER_TARGET) refuse("not_allowed");
      await limiter.take("binding_target", target);
      await limiter.take("binding_sender", sender);
      await db
        .insert(contactBindings)
        .values({ targetDeviceId: target, senderDeviceId: sender, viaGrantId: grantId })
        .onConflictDoNothing();
      await redis.del(keys.bindingCache(target));
      await audit.record("binding_created", target);
    },

    /** Presence (12) and similar: does `target` accept messages from `sender` right now? */
    async isBound(target: string, sender: string): Promise<boolean> {
      return (await allowedSenders(target)).has(sender);
    },

    /** grant.set (6.4): register my grant's hash; `rotate` revokes every older grant. */
    async setGrant(me: string, grantId: string, hash: Buffer, rotate: boolean): Promise<void> {
      if (rotate) await limiter.take("grant_rotate_device", me);
      await db.transaction(async (tx) => {
        await tx.insert(contactGrants).values({ targetDeviceId: me, grantId, secretHash: hash }).onConflictDoNothing();
        if (rotate) {
          await tx
            .update(contactGrants)
            .set({ revokedAt: sql`now()` })
            .where(
              and(
                eq(contactGrants.targetDeviceId, me),
                ne(contactGrants.grantId, grantId),
                isNull(contactGrants.revokedAt),
              ),
            );
        }
      });
      await redis.del(keys.grantCache(me));
      if (rotate) await audit.record("grant_rotated", me);
    },

    /** contact.revoke: block that device from contacting me, even with my grant. */
    async revoke(me: string, other: string): Promise<void> {
      await db
        .insert(contactBindings)
        .values({ targetDeviceId: me, senderDeviceId: other, revokedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [contactBindings.targetDeviceId, contactBindings.senderDeviceId],
          set: { revokedAt: sql`now()` },
        });
      await redis.del(keys.bindingCache(me));
      await audit.record("binding_revoked", me);
    },

    /** contact.unrevoke: I re-added that device in person, so it may contact me again. */
    async unrevoke(me: string, other: string): Promise<void> {
      await db
        .update(contactBindings)
        .set({ revokedAt: null, viaGrantId: null })
        .where(
          and(
            eq(contactBindings.targetDeviceId, me),
            eq(contactBindings.senderDeviceId, other),
            isNotNull(contactBindings.revokedAt),
          ),
        );
      await redis.del(keys.bindingCache(me));
      await audit.record("binding_unrevoked", me);
    },

    /** contact.list: who can reach me. No names: the app resolves them from its own family list. */
    async list(me: string) {
      const rows = await db
        .select({
          deviceId: contactBindings.senderDeviceId,
          since: contactBindings.createdAt,
          via: contactBindings.viaGrantId,
        })
        .from(contactBindings)
        .where(and(eq(contactBindings.targetDeviceId, me), isNull(contactBindings.revokedAt)));
      return rows.map((r) => ({
        deviceId: r.deviceId,
        since: r.since.getTime(),
        via: r.via ? ("grant" as const) : ("unrevoked" as const),
      }));
    },
  };
}
export type Contacts = ReturnType<typeof createContacts>;
