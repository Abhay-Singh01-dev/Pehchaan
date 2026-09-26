// Rate limits (spec 16.1), enforced with the GCRA Lua script. Limits are configuration
// (RATE_LIMIT_PROFILE), not code. IP limits are deliberately generous: Indian carriers put thousands of users
// behind one address (CGNAT); per-device limits do the real work.
import { createHmac } from "node:crypto";
import type { RelayRedis } from "./redis";
import type { Keys } from "./keys";
import { Refusal } from "./refusal";

export interface Limit {
  /** Requests allowed per window, at the steady rate. */
  limit: number;
  windowMs: number;
  /** Requests allowed at once. */
  burst: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Every row of the 16.1 table. */
export const STANDARD = {
  upgrade_ip: { limit: 120, windowMs: MIN, burst: 30 },
  login_fail_ip: { limit: 30, windowMs: 10 * MIN, burst: 10 },
  frame_socket: { limit: 20, windowMs: 1000, burst: 40 },
  request_device_min: { limit: 10, windowMs: MIN, burst: 5 },
  request_device_hour: { limit: 60, windowMs: HOUR, burst: 5 },
  request_pair: { limit: 3, windowMs: MIN, burst: 2 },
  answer_device: { limit: 20, windowMs: MIN, burst: 10 },
  alert_device: { limit: 100, windowMs: HOUR, burst: 20 },
  prompt_device: { limit: 12, windowMs: MIN, burst: 4 },
  presence_device: { limit: 30, windowMs: MIN, burst: 10 },
  push_subscribe_device: { limit: 10, windowMs: HOUR, burst: 3 },
  grant_rotate_device: { limit: 10, windowMs: DAY, burst: 3 },
  binding_target: { limit: 20, windowMs: DAY, burst: 5 },
  binding_sender: { limit: 20, windowMs: DAY, burst: 5 },
  push_target: { limit: 60, windowMs: HOUR, burst: 20 },
  lab_password_ip: { limit: 5, windowMs: 10 * MIN, burst: 3 },
  push_test_device: { limit: 3, windowMs: HOUR, burst: 1 },
  http_fetch_device: { limit: 30, windowMs: MIN, burst: 10 },
} as const satisfies Record<string, Limit>;

export type Scope = keyof typeof STANDARD;

/** Load tests on staging only: 100× the steady rate and burst. */
const RELAXED = Object.fromEntries(
  Object.entries(STANDARD).map(([k, v]) => [k, { ...v, limit: v.limit * 100, burst: v.burst * 100 }]),
) as Record<Scope, Limit>;

export const PROFILES = { standard: STANDARD as Record<Scope, Limit>, relaxed: RELAXED };

export interface RateLimiter {
  /** 0 when allowed (and counted), otherwise the ms until the next request would be allowed. */
  check(scope: Scope, key: string): Promise<number>;
  /** Counts the request, or throws Refusal("rate_limited", retryAfterMs). */
  take(scope: Scope, key: string): Promise<void>;
  /** A pseudonymous key for an IP address (rate-limit keys never hold raw IPs, 16.1, 17.1). */
  ipKey(ip: string): string;
  limits: Record<Scope, Limit>;
}

export function createRateLimiter(o: {
  redis: RelayRedis;
  keys: Keys;
  profile: keyof typeof PROFILES;
  ipHashKey: string;
  onLimited?: (scope: Scope, key: string) => void;
}): RateLimiter {
  const limits = PROFILES[o.profile];
  const check = async (scope: Scope, key: string) => {
    const l = limits[scope];
    return o.redis.gcra(o.keys.rate(scope, key), Date.now(), l.windowMs / l.limit, l.burst);
  };
  return {
    limits,
    check,
    async take(scope, key) {
      const wait = await check(scope, key);
      if (wait > 0) {
        o.onLimited?.(scope, key);
        throw new Refusal("rate_limited", wait);
      }
    },
    ipKey: (ip) => createHmac("sha256", Buffer.from(o.ipHashKey, "hex")).update(ip).digest("base64url").slice(0, 22),
  };
}

/** The same GCRA, in memory, for per-socket frame limits (a socket lives on one process, so a Valkey
 *  round trip per frame would buy nothing). */
export function localGcra(l: Limit): () => number {
  const T = l.windowMs / l.limit;
  let tat = 0;
  return () => {
    const now = Date.now();
    const newTat = Math.max(tat, now) + T;
    const allowAt = newTat - l.burst * T;
    if (allowAt > now) return Math.ceil(allowAt - now);
    tat = newTat;
    return 0;
  };
}
