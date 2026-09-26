// Relay → app messages (spec 7.4, 14.2). The app parses these leniently: unknown fields in outbound notices
// are ignored (7.6), so new optional fields can ship at any time without breaking older apps.
import { z } from "zod";
import { RECEIPT_STATES } from "./codes";
import { deviceId, KINDS, millis, ulidString } from "./fields";
import { INVALID_REASONS, LAB_ATTACKS, VERDICTS } from "./client";

export const CANCEL_REASONS = ["asker_cancelled", "answered_elsewhere", "expired"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const PRESENCE_STATES = ["online", "push", "offline"] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];
export const PUSH_STATUSES = ["ok", "missing", "expired"] as const;
export const DELIVER_KINDS = [...KINDS, "verify.cancel"] as const;
export type DeliverKind = (typeof DELIVER_KINDS)[number];

const sealedLoose = z.object({ alg: z.string(), epk: z.string(), iv: z.string(), ct: z.string(), sig: z.string() });

export const deliverBody = z.object({
  from: deviceId,
  kind: z.enum(DELIVER_KINDS),
  re: ulidString.optional(),
  /** Time left on the relay's clock, rewritten on every delivery (8.3). */
  ttlMs: millis,
  late: z.boolean().optional(),
  e2e: sealedLoose.optional(),
  plain: z.record(z.string(), z.unknown()).optional(),
  psig: z.string().optional(),
  /** Relay-generated notices, e.g. verify.cancel (not end-to-end). */
  system: z.object({ reason: z.enum(CANCEL_REASONS) }).optional(),
});

const armed = z.object({ attack: z.enum(LAB_ATTACKS), asker: deviceId, answerer: deviceId });

export const RELAY_BODIES = {
  hello: z.object({
    serverNonce: z.string().length(43),
    serverTime: millis,
    gatewayId: z.string(),
    minClient: z.string(),
    vapidKeyId: z.string(),
    env: z.string(),
    e2eRequired: z.boolean(),
  }),
  "auth.ok": z.object({
    serverTime: millis,
    pushStatus: z.enum(PUSH_STATUSES),
    lab: z.object({ optedIn: z.boolean(), until: millis.optional() }),
  }),
  pong: z.object({ serverTime: millis }),
  deliver: deliverBody,
  receipt: z.object({
    of: ulidString,
    to: deviceId.optional(),
    re: ulidString.optional(),
    state: z.enum(RECEIPT_STATES),
    reason: z.string().optional(),
  }),
  presence: z.object({ states: z.record(z.string(), z.enum(PRESENCE_STATES)) }),
  "contact.list.result": z.object({
    contacts: z.array(z.object({ deviceId, since: millis, via: z.enum(["grant", "unrevoked"]) })),
  }),
  error: z.object({ code: z.string(), of: z.string().optional(), retryAfterMs: millis.optional() }),
  reconnect: z.object({ afterMs: millis }),
  // Security Lab (14.2)
  "lab.state": z.object({
    /** The Lab module is loaded and its runtime switch is on. */
    active: z.boolean(),
    optedIn: z.array(deviceId),
    armed: armed.nullable().optional(),
    since: millis,
    /** "held_timeout": the Lab page didn't answer a hold within 10 s; the original was forwarded (14.3). */
    notice: z.string().optional(),
  }),
  "lab.traffic": z.object({
    event: z.object({
      id: z.string(),
      at: millis,
      kind: z.enum(["request", "answer", "alert", "presence", "guard"]),
      from: z.string(),
      to: z.string(),
      summary: z.string(),
      payload: z.unknown().optional(),
      tampered: z.enum(LAB_ATTACKS).optional(),
      verdictSeen: z.enum(VERDICTS).optional(),
      requestId: z.string().optional(),
    }),
  }),
  "lab.held": z.object({
    heldId: ulidString,
    attack: z.enum(LAB_ATTACKS),
    frame: z.object({ v: z.literal(1), t: z.literal("deliver"), id: ulidString, sts: millis, body: deliverBody }),
  }),
  "lab.result": z.object({
    attack: z.enum(LAB_ATTACKS),
    requestId: ulidString,
    verdict: z.enum(VERDICTS),
    invalidReason: z.enum(INVALID_REASONS).optional(),
    failedChecks: z.array(z.number().int()),
    falseGreen: z.boolean(),
  }),
} as const;

export type RelayType = keyof typeof RELAY_BODIES;
export const RELAY_TYPES = Object.keys(RELAY_BODIES) as RelayType[];
export type RelayBody<T extends RelayType> = z.infer<(typeof RELAY_BODIES)[T]>;
export type RelayFrame = {
  [T in RelayType]: { v: 1; t: T; id: string; sts: number; body: RelayBody<T> };
}[RelayType];
export type DeliverBody = z.infer<typeof deliverBody>;

/** Every relay frame also carries `sts`, the relay's clock, used by apps for display offsets only (7.2). */
export const relayEnvelope = z.object({
  v: z.literal(1),
  t: z.string(),
  id: ulidString,
  sts: millis,
  body: z.unknown(),
});

/** The app's parser. Unknown message types and malformed frames return null (ignored). Never throws. */
export function parseRelayFrame(text: string): RelayFrame | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const env = relayEnvelope.safeParse(json);
  // Own properties only: a frame naming "toString" or "__proto__" must be ignored, not crash the parser.
  if (!env.success || !Object.hasOwn(RELAY_BODIES, env.data.t)) return null;
  const t = env.data.t as RelayType;
  const body = RELAY_BODIES[t].safeParse(env.data.body);
  if (!body.success) return null;
  return { v: 1, t, id: env.data.id, sts: env.data.sts, body: body.data } as RelayFrame;
}

/** Builds a relay → app frame (the relay uses this). */
export function relayFrame<T extends RelayType>(t: T, id: string, body: RelayBody<T>, sts: number = Date.now()) {
  return { v: 1 as const, t, id, sts, body };
}
