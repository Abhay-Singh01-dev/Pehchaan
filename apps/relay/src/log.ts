// Structured logs (spec 16.7, 19.2): pino JSON to stdout.
// Never logged: payloads (e2e, plain), nonces, signatures, grant secrets, push endpoints, names, labels or
// phone numbers. Device IDs appear only as an HMAC (`dev`). IPs are never logged at all.
import { createHmac } from "node:crypto";
import pino, { type Logger } from "pino";

export type { Logger };

/** Field names that must never reach a log line, wherever they appear. */
export const FORBIDDEN_LOG_KEYS = [
  "e2e",
  "plain",
  "psig",
  "nonce",
  "sig",
  "signature",
  "grant",
  "secret",
  "hash",
  "endpoint",
  "p256dh",
  "auth",
  "name",
  "fromName",
  "label",
  "claimedLabel",
  "aboutLabel",
  "victimName",
  "phone",
  "victimPhone",
  "password",
  "ip",
  "deviceId",
  "devicePub",
  "body",
  "frame",
];

export function createLogger(opts: { level: string; gatewayId: string; destination?: pino.DestinationStream }) {
  const paths = FORBIDDEN_LOG_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);
  return pino(
    {
      level: opts.level,
      base: { gw: opts.gatewayId },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "msg",
      redact: { paths, censor: "[redacted]" },
      formatters: { level: (label) => ({ level: label }) },
    },
    opts.destination,
  );
}

/** The pseudonymous form of a device ID used in logs and audit events. */
export function hmacId(key: string, deviceId: string): string {
  return createHmac("sha256", Buffer.from(key, "hex")).update(deviceId).digest("base64url").slice(0, 16);
}
