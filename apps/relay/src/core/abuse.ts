// Automatic abuse signals (spec 16.8): behaviour only, never content. Each is written once per window to
// audit_events, where Grafana alerts on them.
//   - a device refused by rate limits 20 times within an hour → rate_limited_burst
//   - one sender creating more than 10 bindings in a day      → binding_burst
import type { Audit } from "./audit";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

export const RATE_LIMITED_BURST = 20;
export const BINDINGS_PER_DAY_SIGNAL = 10;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export function createAbuseSignals(o: { redis: RelayRedis; keys: Keys; audit: Audit }) {
  /** Counts in a window; true exactly once, when the count first passes the threshold. */
  const crossed = async (key: string, windowMs: number, threshold: number) => {
    const [[, n]] = (await o.redis.multi().incr(key).pexpire(key, windowMs, "NX").exec()) as [[null, number]];
    return n === threshold;
  };
  return {
    rateLimited(scope: string, key: string): void {
      const deviceId = key.split(">")[0]!; // per-pair keys are "<sender>><target>"
      if (!DEVICE_ID.test(deviceId)) return; // IP-scoped limits are never tied to a device
      void crossed(o.keys.abuse("rl", deviceId), 60 * 60_000, RATE_LIMITED_BURST)
        .then((hit) => (hit ? o.audit.record("rate_limited_burst", deviceId, { scope }) : undefined))
        .catch(() => {});
    },
    async bindingCreated(sender: string): Promise<void> {
      if (await crossed(o.keys.abuse("bind", sender), 24 * 60 * 60_000, BINDINGS_PER_DAY_SIGNAL + 1)) {
        await o.audit.record("binding_burst", sender);
      }
    },
  };
}
export type AbuseSignals = ReturnType<typeof createAbuseSignals>;
