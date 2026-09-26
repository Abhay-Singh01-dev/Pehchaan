// Idempotency (spec 8.4): the app re-sends an unconfirmed `send` with the SAME id every 2 s. The relay
// remembers each (sender, id) for 5 minutes; a duplicate gets the original receipt again and is never routed
// twice.
import { TIMING, type RelayBody } from "@pehchaan/protocol";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";

const PENDING = "~";

export type StoredOutcome = { receipt?: RelayBody<"receipt">; error?: RelayBody<"error"> };

export function createDedupe(redis: RelayRedis, keys: Keys) {
  return {
    /** True if this is the first time the relay sees this message; otherwise the stored outcome (or null
     *  while the first copy is still being processed). */
    async claim(from: string, id: string): Promise<{ first: true } | { first: false; outcome: StoredOutcome | null }> {
      const key = keys.dedupe(from, id);
      const set = await redis.set(key, PENDING, "PX", TIMING.DEDUPE_MS, "NX");
      if (set === "OK") return { first: true };
      const v = await redis.get(key);
      return { first: false, outcome: v && v !== PENDING ? (JSON.parse(v) as StoredOutcome) : null };
    },
    /** Remembers what the relay answered, for duplicates (keeps the 5-minute expiry). */
    async record(from: string, id: string, outcome: StoredOutcome): Promise<void> {
      await redis.set(keys.dedupe(from, id), JSON.stringify(outcome), "KEEPTTL", "XX");
    },
    /** A message refused for a retryable reason may be sent again with the same id. */
    async release(from: string, id: string): Promise<void> {
      await redis.del(keys.dedupe(from, id));
    },
  };
}
export type Dedupe = ReturnType<typeof createDedupe>;
