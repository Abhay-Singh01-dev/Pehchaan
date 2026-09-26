// App → relay messages (spec 7.4, 14.2). Every body is a strict schema: unknown fields are rejected (7.2).
import { z } from "zod";
import { b64url, deviceId, grant, KINDS, millis, rawPubKey, rawSig, sealed, ulidString } from "./fields";
import { LIMITS } from "./limits";
import { PAYLOADS } from "./payloads";

const empty = z.strictObject({});

/** `send`: exactly one of `e2e` (sealed) or `plain` with its sender signature `psig`; `re` is required for
 *  requests and answers; a plain payload must match its kind's schema (7.4, 9.5). */
export const sendBody = z
  .strictObject({
    kind: z.enum(KINDS),
    to: deviceId,
    re: ulidString.optional(),
    grant: grant.optional(),
    ttlMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60_000),
    e2e: sealed.optional(),
    plain: z.record(z.string(), z.unknown()).optional(),
    psig: rawSig.optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.e2e === undefined) === (b.plain === undefined)) {
      ctx.addIssue({ code: "custom", message: "exactly one of e2e or plain" });
    }
    if (b.plain !== undefined && b.psig === undefined) ctx.addIssue({ code: "custom", message: "plain needs psig" });
    if (b.e2e !== undefined && b.psig !== undefined)
      ctx.addIssue({ code: "custom", message: "psig is for plain only" });
    if ((b.kind === "verify.request" || b.kind === "verify.answer") && b.re === undefined) {
      ctx.addIssue({ code: "custom", message: "re is required for requests and answers" });
    }
    if (b.plain !== undefined && !PAYLOADS[b.kind].safeParse(b.plain).success) {
      ctx.addIssue({ code: "custom", message: "plain doesn't match its kind" });
    }
  });

export const LAB_ATTACKS = ["change", "replay", "forge"] as const;
export const VERDICTS = ["VERIFIED", "DENIED", "NO_RESPONSE", "INVALID", "UNKNOWN_PERSON"] as const;
export const INVALID_REASONS = [
  "changed",
  "reused",
  "wrong_key",
  "wrong_app",
  "not_unlocked",
  "bad_signature",
  "expired",
] as const;

const password = z.string().min(1).max(256);

export const CLIENT_BODIES = {
  auth: z.strictObject({
    deviceId,
    devicePub: rawPubKey,
    sig: rawSig,
    client: z.strictObject({
      ver: z
        .string()
        .min(1)
        .max(40)
        .regex(/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/),
      platform: z
        .string()
        .min(1)
        .max(32)
        .regex(/^[a-z0-9-]+$/),
    }),
  }),
  ping: empty,
  send: sendBody,
  ack: z.strictObject({ of: ulidString }),
  seen: z.strictObject({ re: ulidString }),
  cancel: z.strictObject({ re: ulidString }),
  "presence.query": z.strictObject({ ids: z.array(deviceId).min(1).max(LIMITS.PRESENCE_MAX_IDS) }),
  "push.subscribe": z.strictObject({
    endpoint: z.string().min(10).max(1024),
    p256dh: rawPubKey,
    auth: b64url(16, 16),
    vapidKeyId: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_.-]+$/),
  }),
  "push.unsubscribe": z.strictObject({ endpoint: z.string().min(10).max(1024) }),
  "push.test": empty,
  "grant.set": z.strictObject({ grantId: b64url(8, 8), hash: b64url(32, 32), rotate: z.boolean() }),
  "contact.list": empty,
  "contact.revoke": z.strictObject({ deviceId }),
  "contact.unrevoke": z.strictObject({ deviceId }),
  "device.retire": empty,
  // Security Lab (14.2)
  "lab.join": z.strictObject({ password }),
  "lab.optin": z.strictObject({ password }),
  "lab.optout": empty,
  "lab.arm": z.strictObject({ attack: z.enum(LAB_ATTACKS), asker: deviceId, answerer: deviceId }),
  "lab.disarm": empty,
  "lab.release": z.strictObject({ heldId: ulidString, replacement: z.record(z.string(), z.unknown()).optional() }),
  "lab.inject": z.strictObject({
    as: deviceId,
    to: deviceId,
    kind: z.enum(KINDS),
    re: ulidString,
    plain: z.record(z.string(), z.unknown()),
  }),
  "lab.report": z.strictObject({
    requestId: ulidString,
    verdict: z.enum(VERDICTS),
    invalidReason: z.enum(INVALID_REASONS).optional(),
    failedChecks: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine((a) => new Set(a).size === a.length, "duplicate checks"),
  }),
} as const;

export type ClientType = keyof typeof CLIENT_BODIES;
export const CLIENT_TYPES = Object.keys(CLIENT_BODIES) as ClientType[];
export type ClientBody<T extends ClientType> = z.infer<(typeof CLIENT_BODIES)[T]>;

/** The outer envelope of every app → relay frame (7.2). `ts` is the sender's clock: informational only. */
export const clientEnvelope = z.strictObject({
  v: z.literal(1),
  t: z.enum(CLIENT_TYPES as [ClientType, ...ClientType[]]),
  id: ulidString,
  ts: millis,
  body: z.unknown(),
});

export type ClientFrame = {
  [T in ClientType]: { v: 1; t: T; id: string; ts: number; body: ClientBody<T> };
}[ClientType];

export type ParsedClientFrame =
  { ok: true; frame: ClientFrame } | { ok: false; id?: string; reason: "json" | "envelope" | "body" };

/** Parses one text frame from an app. On failure, returns the frame's `id` when it could be read, so the
 *  relay can answer `error { code: "bad_request", of: id }` (7.2). Never throws. */
export function parseClientFrame(text: string): ParsedClientFrame {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  const env = clientEnvelope.safeParse(json);
  if (!env.success) {
    const id = (json as { id?: unknown } | null)?.id;
    return typeof id === "string" && ulidString.safeParse(id).success
      ? { ok: false, id, reason: "envelope" }
      : { ok: false, reason: "envelope" };
  }
  const body = CLIENT_BODIES[env.data.t].safeParse(env.data.body);
  if (!body.success) return { ok: false, id: env.data.id, reason: "body" };
  return { ok: true, frame: { ...env.data, body: body.data } as ClientFrame };
}

/** Builds an app → relay frame (the app uses this; the relay only parses). */
export function clientFrame<T extends ClientType>(t: T, id: string, body: ClientBody<T>, ts: number = Date.now()) {
  return { v: 1 as const, t, id, ts, body };
}
