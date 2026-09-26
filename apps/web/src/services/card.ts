// CardService: encodes a FamilyCard into a family link (https://<origin>/join#c=<base64url JSON>)
// and decodes links, raw codes, or pasted text back into a card. This is plain encoding,
// the same in simulation and real mode.
//
// On the wire the JSON uses short keys so the QR code stays small and quick to scan:
//   { v, d: deviceId, n: name, p?: phone, c: color, b: canBeVerified (0/1), k?: keyId,
//     pk?: publicKey, w: "WORD.WORD.WORD.WORD" }
// fromLink() also accepts the long form (a plain FamilyCard JSON).
import { CardError, type AvatarColor, type CardService, type FamilyCard } from "./types";
import { base64UrlToUtf8, utf8ToBase64Url } from "./crypto";

const COLORS: AvatarColor[] = ["indigo", "teal", "saffron", "rose", "plum", "slate"];
const B64URL = /^[A-Za-z0-9_-]+$/;

interface WireCard {
  v: 1;
  d: string;
  n: string;
  p?: string;
  c: AvatarColor;
  b: 0 | 1;
  k?: string;
  pk?: string;
  w: string;
}

function toWire(card: FamilyCard): WireCard {
  const w: WireCard = {
    v: 1,
    d: card.deviceId,
    n: card.name,
    c: card.color,
    b: card.canBeVerified ? 1 : 0,
    w: card.safetyWords.join("."),
  };
  if (card.phone) w.p = card.phone;
  if (card.canBeVerified) {
    w.k = card.keyId;
    w.pk = card.publicKey;
  }
  return w;
}

function fromWire(raw: Record<string, unknown>): Record<string, unknown> {
  if (!("d" in raw)) return raw; // long form
  return {
    v: raw.v,
    deviceId: raw.d,
    name: raw.n,
    phone: raw.p,
    color: raw.c,
    canBeVerified: raw.b === 1 || raw.b === true,
    keyId: raw.k,
    publicKey: raw.pk,
    safetyWords: typeof raw.w === "string" ? raw.w.split(".") : raw.w,
  };
}

function extractCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  // A full family link, or any text containing one: "#c=<code>" or "?c=<code>".
  const m = text.match(/[#?&]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1]!;
  // A bare code (the QR payload without the URL).
  if (B64URL.test(text) && text.length > 40) return text;
  return null;
}

function validate(raw: unknown): FamilyCard {
  if (!raw || typeof raw !== "object") throw new CardError("corrupt");
  const c = fromWire(raw as Record<string, unknown>);
  const words = c.safetyWords;
  const ok =
    c.v === 1 &&
    typeof c.deviceId === "string" &&
    c.deviceId.length > 0 &&
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    typeof c.color === "string" &&
    COLORS.includes(c.color as AvatarColor) &&
    typeof c.canBeVerified === "boolean" &&
    Array.isArray(words) &&
    words.length === 4 &&
    words.every((w) => typeof w === "string" && w.length > 0) &&
    (c.phone === undefined || typeof c.phone === "string") &&
    (!c.canBeVerified || (typeof c.keyId === "string" && typeof c.publicKey === "string"));
  if (!ok) throw new CardError("corrupt");
  const card: FamilyCard = {
    v: 1,
    deviceId: c.deviceId as string,
    name: (c.name as string).trim().slice(0, 30),
    color: c.color as AvatarColor,
    canBeVerified: c.canBeVerified as boolean,
    safetyWords: words as FamilyCard["safetyWords"],
  };
  if (typeof c.phone === "string" && c.phone) card.phone = c.phone;
  if (card.canBeVerified) {
    card.keyId = c.keyId as string;
    card.publicKey = c.publicKey as string;
  }
  return card;
}

export function createCardService(getMyDeviceId: () => string | null): CardService {
  return {
    toLink(card) {
      return `${location.origin}/join#c=${utf8ToBase64Url(JSON.stringify(toWire(card)))}`;
    },
    fromLink(urlOrText) {
      const code = extractCode(urlOrText);
      if (!code) throw new CardError("not_pehchaan");
      let parsed: unknown;
      try {
        parsed = JSON.parse(base64UrlToUtf8(code));
      } catch {
        throw new CardError("corrupt");
      }
      const card = validate(parsed);
      if (card.deviceId === getMyDeviceId()) throw new CardError("own_card");
      return card;
    },
  };
}

/** The card this phone shares (C3), built from the profile. */
export function myCard(p: {
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  role: "can_be_verified" | "checks_only";
  keyId?: string;
  publicKey?: string;
  safetyWords?: FamilyCard["safetyWords"];
}): FamilyCard {
  const canBeVerified = p.role === "can_be_verified" && Boolean(p.keyId && p.publicKey);
  const card: FamilyCard = {
    v: 1,
    deviceId: p.deviceId,
    name: p.name,
    color: p.color,
    canBeVerified,
    safetyWords: p.safetyWords ?? ["—", "—", "—", "—"],
  };
  if (p.phone) card.phone = p.phone;
  if (canBeVerified) {
    card.keyId = p.keyId;
    card.publicKey = p.publicKey;
  }
  return card;
}
