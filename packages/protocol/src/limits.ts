// Every number the protocol depends on, in one place (spec 7.1, 8, 12, 14, 16.2). The relay and the app
// both read these; tests assert them against the spec.

export const LIMITS = {
  /** A frame above this gets `error too_large` (7.1). */
  FRAME_MAX_BYTES: 16 * 1024,
  /** The socket-level limit: anything larger is closed with 1009 (7.1). */
  SOCKET_MAX_PAYLOAD: 64 * 1024,
  /** Sealed ciphertext (16.2). */
  CT_MAX_BYTES: 8 * 1024,
  PRESENCE_MAX_IDS: 50,
  INBOX_MAX_ENTRIES: 50,
  SOCKETS_PER_DEVICE: 3,
  /** Unauthenticated sockets per IP at a time (16.2). */
  UNAUTH_PER_IP: 20,
  /** A socket whose unsent data exceeds this is a slow or malicious reader: close 1008 (16.2). */
  BUFFERED_MAX_BYTES: 1024 * 1024,
  BAD_FRAMES_PER_MINUTE: 3,
  /** Web Push payloads are limited to 4,096 bytes after encryption; keep frames under this (11.4). */
  PUSH_MAX_FRAME_BYTES: 3000,
} as const;

export const TIMING = {
  AUTH_DEADLINE_MS: 10_000,
  /** Relay WebSocket ping; two missed pongs terminate the socket (7.1). */
  RELAY_PING_MS: 25_000,
  RELAY_MISSED_PONGS: 2,
  /** App `{t:"ping"}` in the foreground; no `pong` in 10 s means a dead connection (7.1). */
  APP_PING_MS: 25_000,
  APP_PONG_TIMEOUT_MS: 10_000,
  /** The relay's deadline for a request: relayNow + clamp(ttlMs, 10 s, 60 s) (8.1). */
  REQUEST_TTL_MIN_MS: 10_000,
  REQUEST_TTL_MAX_MS: 60_000,
  /** Answers are forwarded up to 30 s after the deadline, marked late (8.8). */
  ANSWER_GRACE_MS: 30_000,
  /** Request records live until deadline + 90 s (8.1). */
  RECORD_EXTRA_MS: 90_000,
  /** The app re-sends an unacknowledged `send` with the same id this often (8.4). */
  OUTBOX_RETRY_MS: 2_000,
  /** `sendRequest()` rejects if no `accepted` receipt arrives within this (8.4). */
  ACCEPT_TIMEOUT_MS: 5_000,
  /** dd:<from>:<id> idempotency window (8.4). */
  DEDUPE_MS: 300_000,
  /** A delivered frame not acked within this → push, in case the OS froze the socket (8.3). */
  ACK_PUSH_FALLBACK_MS: 1_500,
  /** Cancelled and finished request IDs are remembered this long, to drop late duplicates (8.10). */
  TOMBSTONE_MS: 120_000,
  /** Presence is re-asked at most this often while a screen needs it (12). */
  PRESENCE_REASK_MS: 30_000,
  /** Reconnect backoff, each with ±30% jitter, then every 8 s (8.9). */
  RECONNECT_BACKOFF_MS: [500, 1000, 2000, 4000, 8000] as readonly number[],
  RECONNECT_JITTER: 0.3,
  /** Reconnecting for this long counts as offline (8.9). */
  OFFLINE_AFTER_MS: 30_000,
  /** Inbox lifetimes per kind (8.3). The request's is its deadline; the answer's is the deadline + 30 s. */
  INBOX_TTL_CANCEL_MS: 60_000,
  INBOX_TTL_ALERT_MS: 24 * 60 * 60_000,
  INBOX_TTL_PROMPT_MS: 2 * 60_000,
  /** Security Lab (14.1): a held message is forwarded unchanged after 10 s; sessions and opt-ins last 4 h;
   *  the runtime switch expires after 12 h. */
  LAB_HOLD_MS: 10_000,
  LAB_SESSION_MS: 4 * 60 * 60_000,
  LAB_OPTIN_MS: 4 * 60 * 60_000,
  LAB_SWITCH_MS: 12 * 60 * 60_000,
  /** The used-nonce store keeps entries this long (10.9). */
  USED_NONCE_KEEP_MS: 30 * 24 * 60 * 60_000,
  /** `push.test` arrives after this delay (11.8). */
  PUSH_TEST_DELAY_MS: 10_000,
} as const;

export const CONTACTS = {
  BINDINGS_PER_TARGET: 50,
  NEW_BINDINGS_PER_DAY: 20,
} as const;
