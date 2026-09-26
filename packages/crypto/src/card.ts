// The family card v2 (spec 6.1) and the "new phone" scam guard (6.5).
//
// A card is what the QR code and the family link carry: https://<app>/join#c=<base64url(UTF-8 JSON)>.
// The card travels in the URL fragment, which browsers never send to servers.
// Safety words are NOT in the card: every phone derives them itself (safety-words.ts).
import { b64url, b64urlDecode, utf8 } from "./bytes";
import { deviceIdFrom, isRawP256 } from "./device-auth";

export const CARD_VERSION = 2;
export const AVATAR_COLORS = ["indigo", "teal", "saffron", "rose", "plum", "slate"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** The wire form, with the short keys of 6.1. */
export interface CardV2 {
  v: 2;
  /** Device ID: base64url(SHA-256(dk)).slice(0, 22). */
  d: string;
  /** Display name, at most 40 characters. */
  n: string;
  /** Phone number, optional. */
  p?: string;
  c: AvatarColor;
  /** Role: "v" can be verified, "c" checks only. */
  r: "v" | "c";
  /** Device signing public key (raw, 65 bytes). */
  dk: string;
  /** Device encryption public key (raw, 65 bytes). */
  ek: string;
  /** Answer key type. Only passkeys ("pk") are built (D-015). */
  kt?: "pk";
  /** Passkey credential ID. */
  ki?: string;
  /** Passkey public key (raw, 65 bytes). */
  pk?: string;
  /** Contact grant "<grantId>.<secret>" (6.4). */
  g: string;
  /** When the card was made (ms). */
  ts: number;
}

export type CardErrorCode = "not_pehchaan" | "corrupt" | "old_version" | "altered" | "own_card";

export class CardError extends Error {
  readonly code: CardErrorCode;
  /** For "old_version": the name on the old card, so the app can say "Ask {name} to update Pehchaan". */
  readonly cardName?: string;
  constructor(code: CardErrorCode, cardName?: string) {
    super(`card: ${code}`);
    this.name = "CardError";
    this.code = code;
    if (cardName) this.cardName = cardName;
  }
}

export const LIMITS = { name: 40, phone: 24, credIdMinBytes: 16, credIdMaxBytes: 1023 } as const;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const GRANT = /^[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{22}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const KEYS = new Set(["v", "d", "n", "p", "c", "r", "dk", "ek", "kt", "ki", "pk", "g", "ts"]);

/** Card JSON in the 6.1 key order, base64url-encoded. */
export function encodeCard(c: CardV2): string {
  const ordered = {
    v: c.v,
    d: c.d,
    n: c.n,
    p: c.p,
    c: c.c,
    r: c.r,
    dk: c.dk,
    ek: c.ek,
    kt: c.kt,
    ki: c.ki,
    pk: c.pk,
    g: c.g,
    ts: c.ts,
  };
  return b64url(utf8(JSON.stringify(ordered)));
}

export const cardLink = (origin: string, c: CardV2): string => `${origin}/join#c=${encodeCard(c)}`;

/** The code inside a family link, a pasted message containing one, or a bare QR payload. */
export function extractCode(input: string): string | null {
  const text = input.trim();
  const m = text.match(/[#?&]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1]!;
  if (B64URL.test(text) && text.length > 40) return text;
  return null;
}

const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max && !CONTROL.test(v);

function isRawKey(v: unknown): boolean {
  if (typeof v !== "string" || v.length !== 87) return false;
  try {
    return isRawP256(b64urlDecode(v));
  } catch {
    return false;
  }
}

function isCredId(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    const n = b64urlDecode(v).length;
    return n >= LIMITS.credIdMinBytes && n <= LIMITS.credIdMaxBytes;
  } catch {
    return false;
  }
}

/**
 * Validation before anything is shown (6.1):
 *   1. v === 2 (a v1 card → "old_version", with the name for the message);
 *   2. every key decodes, and every public key is 65 bytes starting with 0x04;
 *   3. deviceIdFrom(dk) === d, otherwise the card was altered;
 *   4. d is not my own device, and every field is within its limit.
 * The new-phone guard (6.5) runs afterwards, against the family list: guardNewCard().
 */
export async function decodeCard(input: string, opts: { myDeviceId?: string | null } = {}): Promise<CardV2> {
  const code = extractCode(input);
  if (!code) throw new CardError("not_pehchaan");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(code)));
  } catch {
    throw new CardError("corrupt");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new CardError("corrupt");
  const o = raw as Record<string, unknown>;
  if (o.v === 1) throw new CardError("old_version", isText(o.n, LIMITS.name) ? o.n.trim() : undefined);
  if (o.v !== CARD_VERSION) throw new CardError("corrupt");
  if (Object.keys(o).some((k) => !KEYS.has(k))) throw new CardError("corrupt");

  const canBeVerified = o.r === "v";
  const ok =
    typeof o.d === "string" &&
    DEVICE_ID.test(o.d) &&
    isText(o.n, LIMITS.name) &&
    (o.p === undefined || isText(o.p, LIMITS.phone)) &&
    AVATAR_COLORS.includes(o.c as AvatarColor) &&
    (o.r === "v" || o.r === "c") &&
    isRawKey(o.dk) &&
    isRawKey(o.ek) &&
    typeof o.g === "string" &&
    GRANT.test(o.g) &&
    typeof o.ts === "number" &&
    Number.isSafeInteger(o.ts) &&
    o.ts > 0 &&
    (canBeVerified
      ? o.kt === "pk" && isCredId(o.ki) && isRawKey(o.pk)
      : o.kt === undefined && o.ki === undefined && o.pk === undefined);
  if (!ok) throw new CardError("corrupt");

  const card = o as unknown as CardV2;
  if ((await deviceIdFrom(b64urlDecode(card.dk))) !== card.d) throw new CardError("altered");
  if (opts.myDeviceId && card.d === opts.myDeviceId) throw new CardError("own_card");
  return {
    v: 2,
    d: card.d,
    n: card.n.trim(),
    ...(card.p ? { p: card.p.trim() } : {}),
    c: card.c,
    r: card.r,
    dk: card.dk,
    ek: card.ek,
    ...(canBeVerified ? { kt: "pk" as const, ki: card.ki!, pk: card.pk! } : {}),
    g: card.g,
    ts: card.ts,
  };
}

// ─── The "new phone" scam guard (6.5) ────────────────────────────────────────────────────────────

/** What this phone already knows about a family member. */
export interface KnownMember {
  deviceId: string;
  name: string;
  label: string;
  phone?: string;
  devicePub: string;
  encPub: string;
  keyType?: string;
  keyId?: string;
  publicKey?: string;
}

export type GuardOutcome<M extends KnownMember = KnownMember> =
  | { kind: "new" }
  /** Same device, identical keys: "{label} is already in your family." */
  | { kind: "already"; member: M }
  /** Same device, different keys: hard block, "This card has been altered. Don't add it." */
  | { kind: "altered"; member: M }
  /** Different device, same name or phone number as a member: the full-screen red warning. */
  | { kind: "impostor"; member: M; match: "name" | "phone" };

const normName = (s: string) => s.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/\s+/g, " ").trim();
const firstWord = (s: string) => normName(s).split(" ")[0]!; // split() always returns at least one element
const phoneDigits = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Card names match when the normalised full name, or the first word, equals a member's name or label (D-013). */
function sameName(cardName: string, m: KnownMember): boolean {
  const full = normName(cardName);
  const first = firstWord(cardName);
  const theirs = [normName(m.name), normName(m.label), firstWord(m.name), firstWord(m.label)].filter(Boolean);
  return theirs.includes(full) || (first.length > 0 && theirs.includes(first));
}

function samePhone(cardPhone: string | undefined, m: KnownMember): boolean {
  if (!cardPhone || !m.phone) return false;
  const a = phoneDigits(cardPhone);
  return a.length >= 6 && a === phoneDigits(m.phone);
}

/**
 * Decides what adding this card would mean. A card can only ever add a NEW person: it never replaces an
 * existing member, whether it came from a QR scan or a family link. Someone who really changed phones
 * is removed, then added again face to face.
 */
export function guardNewCard<M extends KnownMember>(card: CardV2, family: readonly M[]): GuardOutcome<M> {
  const same = family.find((m) => m.deviceId === card.d);
  if (same) {
    const identical =
      same.devicePub === card.dk &&
      same.encPub === card.ek &&
      (same.keyType ?? undefined) === card.kt &&
      (same.keyId ?? undefined) === card.ki &&
      (same.publicKey ?? undefined) === card.pk;
    return identical ? { kind: "already", member: same } : { kind: "altered", member: same };
  }
  for (const m of family) {
    if (sameName(card.n, m)) return { kind: "impostor", member: m, match: "name" };
    if (samePhone(card.p, m)) return { kind: "impostor", member: m, match: "phone" };
  }
  return { kind: "new" };
}
