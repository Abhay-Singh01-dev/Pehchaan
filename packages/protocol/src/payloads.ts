// The payloads inside `e2e` (after opening) or `plain` (spec 7.4). Validated strictly by the receiving app
// ("never trust the shape just because the seal verified", 9.3) and, for plain frames, by the relay too.
import { z } from "zod";
import {
  amountInr,
  b64url,
  deviceId,
  label,
  millis,
  nonce,
  phone,
  rawPubKey,
  REASONS,
  TACTICS,
  ulidString,
  type Kind,
} from "./fields";

export const wireRequest = z.strictObject({
  v: z.literal(1),
  requestId: ulidString,
  nonce,
  fromDeviceId: deviceId,
  toDeviceId: deviceId,
  claimedLabel: label,
  reason: z.enum(REASONS).optional(),
  amountInr: amountInr.optional(),
  createdAt: millis,
  expiresAt: millis,
});

export const verifyRequestPayload = z.strictObject({
  spk: rawPubKey,
  sek: rawPubKey,
  fromName: label,
  req: wireRequest,
});

export const wireAnswer = z.strictObject({
  requestId: ulidString,
  nonce,
  decision: z.enum(["ME", "NOT_ME"]),
  keyType: z.enum(["pk", "pin"]),
  credId: b64url(1, 1023),
  authenticatorData: b64url(1, 1024),
  clientDataJSON: b64url(1, 2048),
  signature: b64url(1, 144),
  answeredAt: millis,
});

export const verifyAnswerPayload = z.strictObject({
  spk: rawPubKey,
  ans: wireAnswer,
});

export const alertPayload = z.strictObject({
  spk: rawPubKey,
  sek: rawPubKey,
  alert: z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    type: z.enum(["impersonation", "check_on"]),
    aboutDeviceId: deviceId.optional(),
    aboutLabel: label,
    victimName: label,
    victimPhone: phone.optional(),
    amountInr: amountInr.optional(),
    createdAt: millis,
  }),
});

export const guardPromptPayload = z.strictObject({
  spk: rawPubKey,
  prompt: z.strictObject({
    claimedLabel: label,
    claimedDeviceId: deviceId.optional(),
    amountInr: amountInr.optional(),
    tactics: z.array(z.enum(TACTICS)).max(TACTICS.length),
    at: millis,
  }),
});

export const PAYLOADS = {
  "verify.request": verifyRequestPayload,
  "verify.answer": verifyAnswerPayload,
  alert: alertPayload,
  "guard.prompt": guardPromptPayload,
} as const satisfies Record<Kind, z.ZodType>;

export type VerifyRequestPayload = z.infer<typeof verifyRequestPayload>;
export type VerifyAnswerPayload = z.infer<typeof verifyAnswerPayload>;
export type AlertPayload = z.infer<typeof alertPayload>;
export type GuardPromptPayload = z.infer<typeof guardPromptPayload>;
export type WireRequest = z.infer<typeof wireRequest>;
export type WireAnswerPayload = z.infer<typeof wireAnswer>;
export type Payload<K extends Kind> = z.infer<(typeof PAYLOADS)[K]>;

/** Validates a payload for its kind. Returns null when it doesn't match exactly. */
export function parsePayload<K extends Kind>(kind: K, value: unknown): Payload<K> | null {
  const r = PAYLOADS[kind].safeParse(value);
  return r.success ? (r.data as Payload<K>) : null;
}
