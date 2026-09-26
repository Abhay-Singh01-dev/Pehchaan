// CardService (backend spec 6.1, 6.3, 6.5, FC-3): family cards v2.
//   https://<app>/join#c=<base64url(UTF-8 JSON)>  (the fragment is never sent to any server)
// Validation, the new-phone guard and the safety words are the security core's (@pehchaan/crypto/card,
// safety-words); this file only maps them to the app's types. Safety words are ALWAYS derived here, never read
// from a card (a card that claimed its own words could lie).
import {
  CardError as CoreCardError,
  cardLink,
  decodeCard,
  guardNewCard,
  type CardV2,
  type KnownMember,
} from "@pehchaan/crypto/card";
import { safetyWords } from "@pehchaan/crypto/safety-words";
import { appConfig } from "@/app/config";
import type { IdentityRow } from "@/store/db";
import {
  CardError,
  type CardGuard,
  type CardService,
  type FamilyCard,
  type FamilyMember,
  type Profile,
  type SafetyWordsT,
} from "./types";

export function toWire(c: FamilyCard): CardV2 {
  return {
    v: 2,
    d: c.deviceId,
    n: c.name,
    ...(c.phone ? { p: c.phone } : {}),
    c: c.color,
    r: c.canBeVerified ? "v" : "c",
    dk: c.devicePub,
    ek: c.encPub,
    ...(c.canBeVerified && c.keyId && c.publicKey ? { kt: "pk" as const, ki: c.keyId, pk: c.publicKey } : {}),
    g: c.grant,
    ts: c.createdAt,
  };
}

/** The safety words for a card's keys (6.3): PBKDF2 at 600,000 iterations, so this takes a moment. */
export function wordsFor(
  c: Pick<FamilyCard, "deviceId" | "devicePub" | "encPub" | "keyId" | "publicKey" | "canBeVerified">,
) {
  const withKey = c.canBeVerified && c.keyId && c.publicKey;
  return safetyWords({
    d: c.deviceId,
    dk: c.devicePub,
    ek: c.encPub,
    ...(withKey ? { kt: "pk" as const, ki: c.keyId!, pk: c.publicKey! } : {}),
  }) as Promise<SafetyWordsT>;
}

async function fromWire(w: CardV2): Promise<FamilyCard> {
  const card: FamilyCard = {
    v: 2,
    deviceId: w.d,
    name: w.n,
    color: w.c,
    canBeVerified: w.r === "v",
    devicePub: w.dk,
    encPub: w.ek,
    grant: w.g,
    createdAt: w.ts,
    safetyWords: ["", "", "", ""],
  };
  if (w.p) card.phone = w.p;
  if (w.r === "v") Object.assign(card, { keyType: "pk" as const, keyId: w.ki!, publicKey: w.pk! });
  card.safetyWords = await wordsFor(card);
  return card;
}

const known = (m: FamilyMember): KnownMember & { member: FamilyMember } => ({
  deviceId: m.deviceId,
  name: m.name,
  label: m.label,
  ...(m.phone ? { phone: m.phone } : {}),
  devicePub: m.devicePub,
  encPub: m.encPub,
  ...(m.keyType ? { keyType: m.keyType } : {}),
  ...(m.keyId ? { keyId: m.keyId } : {}),
  ...(m.publicKey ? { publicKey: m.publicKey } : {}),
  member: m,
});

export function createCardService(getMyDeviceId: () => string | null): CardService {
  return {
    toLink(card) {
      return cardLink(appConfig.origin, toWire(card));
    },
    async fromLink(urlOrText) {
      try {
        return await fromWire(await decodeCard(urlOrText, { myDeviceId: getMyDeviceId() }));
      } catch (e) {
        if (e instanceof CoreCardError) throw new CardError(e.code, e.cardName);
        throw new CardError("corrupt");
      }
    },
    guard(card, family): CardGuard {
      const r = guardNewCard(toWire(card), family.map(known));
      return r.kind === "new"
        ? r
        : r.kind === "impostor"
          ? { ...r, member: r.member.member }
          : { kind: r.kind, member: r.member.member };
    },
  };
}

/** My own card's safety words (6.3): derived from my card's keys exactly as family derive them from my link. */
export function ownSafetyWords(
  p: Pick<Profile, "role" | "keyId" | "publicKey">,
  id: IdentityRow,
): Promise<SafetyWordsT> {
  const canBeVerified = p.role === "can_be_verified" && Boolean(p.keyId && p.publicKey);
  return wordsFor({
    deviceId: id.deviceId,
    devicePub: id.devicePub,
    encPub: id.encPub,
    canBeVerified,
    ...(canBeVerified ? { keyId: p.keyId, publicKey: p.publicKey } : {}),
  });
}

/** The card this phone shares (C3), built from the profile and the device identity. */
export function myCard(p: Profile, id: IdentityRow): FamilyCard {
  const canBeVerified = p.role === "can_be_verified" && Boolean(p.keyId && p.publicKey);
  const card: FamilyCard = {
    v: 2,
    deviceId: id.deviceId,
    name: p.name,
    color: p.color,
    canBeVerified,
    devicePub: id.devicePub,
    encPub: id.encPub,
    grant: `${id.grantId}.${id.grantSecret}`,
    // Stable, so the QR code doesn't change on every render: the card is as new as its newest key.
    createdAt: Math.max(id.createdAt, p.keyCreatedAt ?? 0),
    safetyWords: p.safetyWords ?? ["—", "—", "—", "—"],
  };
  if (p.phone) card.phone = p.phone;
  if (canBeVerified) Object.assign(card, { keyType: "pk" as const, keyId: p.keyId, publicKey: p.publicKey });
  return card;
}
