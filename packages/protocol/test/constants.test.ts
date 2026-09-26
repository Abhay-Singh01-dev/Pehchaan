// C-7.5a the error and close code tables; C-16.2a the limits; ULIDs; the version.
import { describe, expect, it } from "vitest";
import {
  CLOSE,
  CONTACTS,
  ERROR_CODES,
  LIMITS,
  PROTOCOL_VERSION,
  RECEIPT_STATES,
  SUBPROTOCOL,
  TIMING,
  ULID_RE,
  ulid,
  ulidTime,
} from "../src/index";

describe("C-7.5a · error and close codes (7.5)", () => {
  it("lists every error code", () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        "bad_request",
        "unauthenticated",
        "not_allowed",
        "unknown_target",
        "rate_limited",
        "too_large",
        "duplicate_request",
        "already_answered",
        "cancelled",
        "expired",
        "e2e_required",
        "unavailable",
        "lab_disabled",
        "lab_denied",
      ].sort(),
    );
  });

  it("maps every close code", () => {
    expect(CLOSE).toEqual({
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
    });
  });

  it("lists every receipt state (8.4)", () => {
    expect(RECEIPT_STATES).toEqual(["accepted", "pushed", "delivered", "seen", "queued", "failed", "rejected"]);
  });
});

describe("C-16.2a · limits and timings", () => {
  it("matches sections 7.1, 8, 11.4, 12, 14 and 16.2", () => {
    expect(LIMITS).toEqual({
      FRAME_MAX_BYTES: 16384,
      SOCKET_MAX_PAYLOAD: 65536,
      CT_MAX_BYTES: 8192,
      PRESENCE_MAX_IDS: 50,
      INBOX_MAX_ENTRIES: 50,
      SOCKETS_PER_DEVICE: 3,
      UNAUTH_PER_IP: 20,
      BUFFERED_MAX_BYTES: 1048576,
      BAD_FRAMES_PER_MINUTE: 3,
      PUSH_MAX_FRAME_BYTES: 3000,
    });
    expect(TIMING.AUTH_DEADLINE_MS).toBe(10_000);
    expect(TIMING.RELAY_PING_MS).toBe(25_000);
    expect(TIMING.RELAY_MISSED_PONGS).toBe(2);
    expect(TIMING.APP_PONG_TIMEOUT_MS).toBe(10_000);
    expect([TIMING.REQUEST_TTL_MIN_MS, TIMING.REQUEST_TTL_MAX_MS]).toEqual([10_000, 60_000]);
    expect(TIMING.ANSWER_GRACE_MS).toBe(30_000);
    expect(TIMING.RECORD_EXTRA_MS).toBe(90_000);
    expect(TIMING.OUTBOX_RETRY_MS).toBe(2_000);
    expect(TIMING.ACCEPT_TIMEOUT_MS).toBe(5_000);
    expect(TIMING.DEDUPE_MS).toBe(300_000);
    expect(TIMING.ACK_PUSH_FALLBACK_MS).toBe(1_500);
    expect(TIMING.TOMBSTONE_MS).toBe(120_000);
    expect(TIMING.RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(TIMING.RECONNECT_JITTER).toBe(0.3);
    expect(TIMING.OFFLINE_AFTER_MS).toBe(30_000);
    expect(TIMING.INBOX_TTL_ALERT_MS).toBe(86_400_000);
    expect(TIMING.INBOX_TTL_PROMPT_MS).toBe(120_000);
    expect(TIMING.INBOX_TTL_CANCEL_MS).toBe(60_000);
    expect(TIMING.LAB_HOLD_MS).toBe(10_000);
    expect(TIMING.LAB_SESSION_MS).toBe(4 * 3600_000);
    expect(TIMING.LAB_OPTIN_MS).toBe(4 * 3600_000);
    expect(TIMING.LAB_SWITCH_MS).toBe(12 * 3600_000);
    expect(TIMING.USED_NONCE_KEEP_MS).toBe(30 * 86_400_000);
    expect(TIMING.PUSH_TEST_DELAY_MS).toBe(10_000);
    expect(TIMING.PRESENCE_REASK_MS).toBe(30_000);
    expect(TIMING.APP_PING_MS).toBe(25_000);
    expect(CONTACTS).toEqual({ BINDINGS_PER_TARGET: 50, NEW_BINDINGS_PER_DAY: 20 });
  });
});

describe("ULIDs", () => {
  it("are 26 Crockford base32 characters, sortable by time, with the time recoverable", () => {
    const a = ulid(1761900000000);
    const b = ulid(1761900000001);
    expect(a).toMatch(ULID_RE);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(ulidTime(a)).toBe(1761900000000);
    expect(ulid()).toMatch(ULID_RE);
    expect(ulid(0).slice(0, 10)).toBe("0000000000");
  });

  it("are unique", () => {
    const set = new Set(Array.from({ length: 2000 }, () => ulid(1)));
    expect(set.size).toBe(2000);
  });
});

describe("version (7.1, 7.6)", () => {
  it("speaks envelope v1 over the pehchaan.v1 subprotocol", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(SUBPROTOCOL).toBe("pehchaan.v1");
  });
});
