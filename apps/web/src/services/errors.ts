// Typed errors thrown by services, so screens can show the right state without parsing messages.

export type KeyErrorCode = "cancelled" | "no_screen_lock" | "no_passkeys" | "no_key" | "failed";

export class KeyError extends Error {
  code: KeyErrorCode;
  constructor(code: KeyErrorCode) {
    super(`Key: ${code}`);
    this.name = "KeyError";
    this.code = code;
  }
}

/** offline: no network; unreachable: no `accepted` in time; not_allowed: the person isn't accepting checks from
 *  me (not_allowed / unknown_target, FC-13); rejected: any other refusal. */
export type RelayErrorCode = "offline" | "unreachable" | "not_allowed" | "rejected";

export class RelayError extends Error {
  code: RelayErrorCode;
  /** The relay's own code for a refusal (e.g. already_answered, expired), when there was one. */
  reason?: string;
  constructor(code: RelayErrorCode, reason?: string) {
    super(`Relay: ${code}`);
    this.name = "RelayError";
    this.code = code;
    if (reason) this.reason = reason;
  }
}

export type GuardErrorCode = "mic_unsupported" | "mic_denied";

export class GuardError extends Error {
  code: GuardErrorCode;
  constructor(code: GuardErrorCode) {
    super(`Guard: ${code}`);
    this.name = "GuardError";
    this.code = code;
  }
}

export const isKeyError = (e: unknown, code?: KeyErrorCode): e is KeyError =>
  e instanceof KeyError && (!code || e.code === code);
export const isRelayError = (e: unknown, code?: RelayErrorCode): e is RelayError =>
  e instanceof RelayError && (!code || e.code === code);
