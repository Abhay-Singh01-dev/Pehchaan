// Field formats with explicit length and format limits (16.2). Every inbound schema is built from these.
import { z } from "zod";
import { LIMITS } from "./limits";

export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]*$/;
export const GRANT_RE = /^[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{22}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** base64url text of a byte string whose length is between minBytes and maxBytes. */
export const b64url = (minBytes: number, maxBytes: number) =>
  z
    .string()
    .min(Math.ceil((minBytes * 4) / 3))
    .max(Math.ceil((maxBytes * 4) / 3))
    .regex(B64URL_RE);

export const deviceId = z.string().regex(DEVICE_ID_RE);
export const ulidString = z.string().regex(ULID_RE);
/** Raw uncompressed P-256 public key: 65 bytes → 87 characters. */
export const rawPubKey = z.string().length(87).regex(B64URL_RE);
/** 32-byte nonce → 43 characters. */
export const nonce = z.string().length(43).regex(B64URL_RE);
/** Raw r‖s ECDSA signature: 64 bytes → 86 characters. */
export const rawSig = z.string().length(86).regex(B64URL_RE);
export const grant = z.string().regex(GRANT_RE);
/** Milliseconds since the epoch (or a duration), as a non-negative safe integer. */
export const millis = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** A name or label: 1–40 characters, no control characters (6.1). */
export const label = z
  .string()
  .min(1)
  .max(40)
  .refine((s) => s.trim().length > 0 && !CONTROL_RE.test(s), "invalid text");
export const phone = z
  .string()
  .min(3)
  .max(24)
  .refine((s) => !CONTROL_RE.test(s), "invalid text");
/** Whole rupees. */
export const amountInr = z.number().int().min(1).max(1_000_000_000_000);

export const REASONS = ["money", "otp", "bank_details", "install_app", "nothing_yet"] as const;
export const TACTICS = ["identity", "money", "urgency", "secrecy", "otp", "authority"] as const;
export const KINDS = ["verify.request", "verify.answer", "alert", "guard.prompt"] as const;
export type Kind = (typeof KINDS)[number];

/** Sealed E2E envelope (9.2): the ciphertext is capped at 8 KiB. */
export const sealed = z.strictObject({
  alg: z.string().min(1).max(32),
  epk: rawPubKey,
  iv: b64url(12, 12),
  ct: b64url(16, LIMITS.CT_MAX_BYTES),
  sig: rawSig,
});
export type SealedWire = z.infer<typeof sealed>;
