// A refusal: something a device sent was not allowed. Handlers throw these; the connection turns them into
// `error { code, of, retryAfterMs? }` (and a `rejected` receipt for sends). Any other error from Valkey or
// Postgres becomes `unavailable`: the relay fails closed (15.5).
import type { ErrorCode } from "@pehchaan/protocol";

export class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = "Refusal";
  }
}

export const refuse = (code: ErrorCode, retryAfterMs?: number): never => {
  throw new Refusal(code, retryAfterMs);
};

/** Codes after which the sender may try again later (the app's outbox keeps the message). */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["rate_limited", "unavailable"]);

export function toRefusal(e: unknown): Refusal {
  return e instanceof Refusal ? e : new Refusal("unavailable");
}
