// Request records (spec 8.1, 8.6): who asked whom, the deadline on the relay's clock, and whether the
// request is open, answered or cancelled. "First answer wins" and cancellation are atomic Lua scripts.
import { TIMING } from "@pehchaan/protocol";
import type { Keys } from "./keys";
import type { RelayRedis } from "./redis";
import { refuse } from "./refusal";

export const OPEN_REQUESTS_MAX = 3;

/** The relay's deadline: its own now + clamp(ttlMs, 10 s, 60 s). The sealed expiresAt is never read (8.1). */
export function deadlineFor(now: number, ttlMs: number): number {
  return now + Math.min(Math.max(ttlMs, TIMING.REQUEST_TTL_MIN_MS), TIMING.REQUEST_TTL_MAX_MS);
}

export interface RequestRecord {
  from: string;
  to: string[];
  deadline: number;
  state: "open" | "answered" | "cancelled";
  by?: string;
}

export function createRequests(redis: RelayRedis, keys: Keys) {
  return {
    /** Opens a record. Refuses a 4th open request from the same asker, and a reused request ID. */
    async create(requestId: string, from: string, to: string[], deadline: number, now: number): Promise<void> {
      const reserved = await redis.openReserve(
        keys.openRequests(from),
        requestId,
        deadline,
        now,
        OPEN_REQUESTS_MAX,
        TIMING.REQUEST_TTL_MAX_MS * 2,
      );
      if (reserved !== 1) refuse("rate_limited", Math.max(1000, deadline - now));
      const ttl = deadline - now + TIMING.RECORD_EXTRA_MS;
      const r = await redis.requestCreate(keys.request(requestId), from, to.join(","), deadline, ttl, now);
      if (r === "duplicate") {
        await redis.zrem(keys.openRequests(from), requestId);
        refuse("duplicate_request");
      }
    },

    /** First answer wins (8.6). Returns the record's deadline and targets when accepted. */
    async answer(requestId: string, answerer: string, recipient: string, now: number) {
      const [status, deadline, to] = await redis.answerCheck(
        keys.request(requestId),
        answerer,
        recipient,
        now,
        TIMING.ANSWER_GRACE_MS,
      );
      if (status !== "ok" && status !== "ok_late") {
        refuse(status as "expired" | "not_allowed" | "already_answered" | "cancelled");
      }
      await redis.zrem(keys.openRequests(recipient), requestId);
      // When the request was accepted, for the answer-time metric only (the human part of a check, 19.1).
      const at = Number(await redis.hget(keys.request(requestId), "at")) || null;
      return { late: status === "ok_late", deadline: Number(deadline), to: to.split(",").filter(Boolean), askedAt: at };
    },

    /** The asker stops waiting (8.6). Returns the targets to notify. */
    async cancel(requestId: string, sender: string): Promise<string[]> {
      const [status, to] = await redis.cancelRequest(keys.request(requestId), sender);
      if (status !== "ok") refuse(status as "expired" | "not_allowed" | "already_answered" | "cancelled");
      await redis.zrem(keys.openRequests(sender), requestId);
      return to.split(",").filter(Boolean);
    },

    async get(requestId: string): Promise<RequestRecord | null> {
      const h = await redis.hgetall(keys.request(requestId));
      if (!h.from) return null;
      return {
        from: h.from,
        to: (h.to ?? "").split(",").filter(Boolean),
        deadline: Number(h.deadline),
        state: h.state as RequestRecord["state"],
        ...(h.by ? { by: h.by } : {}),
      };
    },
  };
}
export type Requests = ReturnType<typeof createRequests>;
