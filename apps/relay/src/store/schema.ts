// The durable facts (spec 15.2), in Drizzle. The server stores no names, phone numbers, amounts or message
// contents (0, rule 5): these tables hold pseudonymous device IDs, keys and security events only.
// Migrations are generated from this file (`pnpm db:generate`), committed, and always expand-then-contract.
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Rows are never deleted, only tombstoned (retired_at), so a device ID can never be reused (6.6, 15.3). */
export const devices = pgTable(
  "devices",
  {
    deviceId: text("device_id").primaryKey(), // 22-char base64url
    devicePub: bytea("device_pub").notNull(),
    platform: text("platform"), // 'android-chrome', 'ios-pwa', 'desktop-chrome', 'canary', …
    appVersion: text("app_version"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    lastSeenOn: date("last_seen_on", { mode: "string" })
      .notNull()
      .default(sql`current_date`), // day precision only
    retiredAt: tstz("retired_at"),
    blockedAt: tstz("blocked_at"),
    blockReason: text("block_reason"),
  },
  (t) => [check("devices_device_pub_len", sql`length(${t.devicePub}) = 65`)],
);

/** A device's contact grants: only SHA-256(secret) is stored (6.4). */
export const contactGrants = pgTable(
  "contact_grants",
  {
    targetDeviceId: text("target_device_id")
      .notNull()
      .references(() => devices.deviceId),
    grantId: text("grant_id").notNull(),
    secretHash: bytea("secret_hash").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.targetDeviceId, t.grantId] }),
    check("contact_grants_secret_hash_len", sql`length(${t.secretHash}) = 32`),
  ],
);

/** Who may contact whom: "target ← sender". No cascade: blocks must survive (6.4, 6.6). */
export const contactBindings = pgTable(
  "contact_bindings",
  {
    targetDeviceId: text("target_device_id")
      .notNull()
      .references(() => devices.deviceId),
    senderDeviceId: text("sender_device_id")
      .notNull()
      .references(() => devices.deviceId),
    viaGrantId: text("via_grant_id"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.targetDeviceId, t.senderDeviceId] }),
    index("contact_bindings_sender").on(t.senderDeviceId),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.deviceId),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    vapidKeyId: text("vapid_key_id").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    lastSuccessAt: tstz("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    expiredAt: tstz("expired_at"),
  },
  (t) => [
    index("push_subs_active")
      .on(t.deviceId)
      .where(sql`expired_at is null`),
  ],
);

/** Security events, never content. `subject` is HMAC-SHA-256(AUDIT_KEY, device_id): pseudonymous. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: tstz("at").notNull().defaultNow(),
    kind: text("kind").notNull(),
    subject: text("subject"),
    meta: jsonb("meta").notNull().default({}),
  },
  (t) => [index("audit_events_at").on(t.at)],
);

/** Security Lab attacks (14.4), written only when LAB_ENABLED; kept 90 days. */
export const labAttacks = pgTable(
  "lab_attacks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: tstz("at").notNull().defaultNow(),
    attack: text("attack").notNull(),
    asker: text("asker").notNull(),
    answerer: text("answerer").notNull(),
    verdict: text("verdict"),
    invalidReason: text("invalid_reason"),
    failedChecks: smallint("failed_checks").array(),
    falseGreen: boolean("false_green").notNull().default(false),
  },
  (t) => [check("lab_attacks_attack", sql`${t.attack} in ('change','replay','forge')`)],
);

export const AUDIT_KINDS = [
  "device_first_seen",
  "auth_failed_burst",
  "grant_rotated",
  "binding_created",
  "binding_revoked",
  "binding_unrevoked",
  "push_expired",
  "rate_limited_burst",
  "device_retired",
  "device_blocked",
  "device_unblocked",
  "binding_burst",
  "lab_session",
  "lab_optin",
  "lab_attack",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
