// Error codes and WebSocket close codes (spec 7.5).

export const ERROR_CODES = [
  "bad_request", // schema or size violation (a bug)
  "unauthenticated", // sent before auth.ok
  "not_allowed", // no binding, revoked, not a target of that request, or Lab not opted in
  "unknown_target", // device ID never seen, or retired
  "rate_limited", // retryAfterMs given
  "too_large", // frame over 16 KiB
  "duplicate_request", // a request ID was reused
  "already_answered", // first answer won elsewhere
  "cancelled", // the asker stopped waiting
  "expired", // past the deadline + grace
  "e2e_required", // plain sent where not allowed
  "unavailable", // Redis or another dependency is down: the relay fails closed
  "lab_disabled", // the Security Lab is off
  "lab_denied", // wrong Lab password, or no Lab session
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const CLOSE = {
  GOING_AWAY: 1001,
  BINARY_FRAME: 1003,
  POLICY: 1008,
  TOO_BIG: 1009,
  SERVICE_RESTART: 1012,
  BAD_FRAMES: 4400,
  LOGIN_FAILED: 4401,
  RETIRED_OR_BLOCKED: 4403,
  LOGIN_TIMEOUT: 4408,
  REPLACED: 4409,
  APP_TOO_OLD: 4426,
  RATE_LIMIT: 4429,
} as const;
export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE];

/** What happened to something a device sent (8.4). */
export const RECEIPT_STATES = ["accepted", "pushed", "delivered", "seen", "queued", "failed", "rejected"] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];
