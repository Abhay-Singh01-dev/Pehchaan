// Building and opening envelopes (backend spec 7.4, 9.2–9.5).
//
// Outgoing: the payload for each kind, then either an E2E seal to the recipient's encryption key, or, only where
// allowed (both ends in the Security Lab, 9.5), `plain` with the sender signature `psig`.
// Incoming: the seal is opened (or `psig` checked, for requests, alerts and prompts), the sender key is tied to
// the relay-authenticated sender (and to my saved card for them, when I have one), and the payload is validated
// with its strict schema. Anything that fails is reported as unreadable, never guessed at.
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { open, seal, type Header, type Sealed } from "@pehchaan/crypto/e2e";
import { signPlain, verifyPlain } from "@pehchaan/crypto/plain-sig";
import { parsePayload, type DeliverBody, type Kind, type Payload } from "@pehchaan/protocol";
import type { IdentityRow } from "@/store/db";
import type { FamilyAlert, GuardPrompt, VerifyRequest, WireAnswer } from "../../types";

/** The wire request: exactly the signed fields plus v: 1 (7.4). Display-only fields stay on the phone. */
export function wireRequest(r: VerifyRequest) {
  return {
    v: 1 as const,
    requestId: r.requestId,
    nonce: r.nonce,
    fromDeviceId: r.fromDeviceId,
    toDeviceId: r.toDeviceId,
    claimedLabel: r.claimedLabel,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.amountInr ? { amountInr: r.amountInr } : {}),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

export function requestPayload(r: VerifyRequest, me: IdentityRow): Payload<"verify.request"> {
  return { spk: me.devicePub, sek: me.encPub, fromName: r.fromName.slice(0, 40), req: wireRequest(r) };
}

export function answerPayload(ans: WireAnswer, me: IdentityRow): Payload<"verify.answer"> {
  return { spk: me.devicePub, ans };
}

export function alertPayload(a: FamilyAlert, me: IdentityRow): Payload<"alert"> {
  return {
    spk: me.devicePub,
    sek: me.encPub,
    alert: {
      id: a.id,
      type: a.type,
      ...(a.aboutDeviceId ? { aboutDeviceId: a.aboutDeviceId } : {}),
      aboutLabel: a.aboutLabel.slice(0, 40),
      victimName: (a.victimName || "Pehchaan").slice(0, 40),
      ...(a.victimPhone ? { victimPhone: a.victimPhone.slice(0, 24) } : {}),
      ...(a.amountInr ? { amountInr: a.amountInr } : {}),
      createdAt: a.createdAt,
    },
  };
}

export function promptPayload(p: GuardPrompt, me: IdentityRow): Payload<"guard.prompt"> {
  return {
    spk: me.devicePub,
    prompt: {
      claimedLabel: p.claimedLabel.slice(0, 40),
      ...(p.claimedDeviceId ? { claimedDeviceId: p.claimedDeviceId } : {}),
      ...(p.amountInr ? { amountInr: p.amountInr } : {}),
      tactics: p.tactics,
      at: p.at,
    },
  };
}

export interface Seal {
  e2e?: Sealed;
  plain?: Record<string, unknown>;
  psig?: string;
}

/** Seals the payload to the recipient (E2E), or signs it as plain when `plain` is chosen (9.5). */
export async function wrap(
  payload: object,
  h: Header,
  me: IdentityRow,
  recipientEncPub: string,
  mode: "e2e" | "plain",
): Promise<Seal> {
  if (mode === "e2e") return { e2e: await seal(payload, h, b64urlDecode(recipientEncPub), me.signKey.privateKey) };
  return { plain: payload as Record<string, unknown>, psig: await signPlain(payload, h, me.signKey.privateKey) };
}

export type Opened<K extends Kind> = { ok: true; payload: Payload<K>; plain: boolean } | { ok: false };

/**
 * Opens a delivered envelope addressed to me. `acceptPlain` is false once this app seals everything (FC-7):
 * it then refuses `plain` unless its own Lab opt-in is on, so the relay can't quietly downgrade it (9.5).
 */
export async function unwrap<K extends Kind>(
  kind: K,
  body: DeliverBody,
  frameId: string,
  me: IdentityRow,
  opts: { acceptPlain: boolean; knownSenderDk?: string },
): Promise<Opened<K>> {
  const h: Header = { kind, id: frameId, from: body.from, to: me.deviceId, ...(body.re ? { re: body.re } : {}) };
  let raw: unknown;
  let plain = false;
  if (body.e2e) {
    try {
      raw = await open(body.e2e, h, me.encKey.privateKey, b64urlDecode(me.encPub), opts.knownSenderDk);
    } catch {
      return { ok: false };
    }
  } else if (body.plain && opts.acceptPlain) {
    plain = true;
    raw = body.plain;
    // Requests, alerts and prompts must carry a valid sender signature. Answers are authenticated by the passkey
    // and the 7 checks instead: that is what lets the Security Lab's altered answers reach the verifier (9.5).
    if (kind !== "verify.answer") {
      if (!body.psig || !(await verifyPlain(raw as { spk: string }, h, body.psig, opts.knownSenderDk))) {
        return { ok: false };
      }
    }
  } else {
    return { ok: false };
  }
  // Never trust the shape just because the seal verified (9.3).
  const payload = parsePayload(kind, raw);
  return payload ? { ok: true, payload, plain } : { ok: false };
}
