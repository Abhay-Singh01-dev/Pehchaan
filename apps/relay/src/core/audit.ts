// Security events (spec 15.2, 16.8): never content, and never a raw device ID. The subject is
// HMAC-SHA-256(AUDIT_KEY, device_id), so events about one device can be grouped without naming it.
import { createHmac } from "node:crypto";
import type { Db } from "../store/db";
import { auditEvents, type AuditKind } from "../store/schema";

export function createAudit(db: Db, auditKey: string) {
  const subject = (deviceId: string) =>
    createHmac("sha256", Buffer.from(auditKey, "hex")).update(deviceId).digest("base64url");
  return {
    subject,
    /** Records an event. Failures are swallowed: an audit write never blocks the action it records. */
    async record(kind: AuditKind, deviceId: string | null, meta: Record<string, string | number | boolean> = {}) {
      try {
        await db.insert(auditEvents).values({ kind, subject: deviceId ? subject(deviceId) : null, meta });
      } catch {
        /* Postgres unavailable: the action itself already failed closed or succeeded without it */
      }
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;
