// CardService (backend spec 6.1, 6.3, 6.5, FC-3): family links carry card v2; safety words are always derived
// on the receiving phone; the new-phone guard decides what adding a card would mean. Real WebCrypto throughout.
import { describe, expect, it } from "vitest";
import { createSoftCredential } from "@pehchaan/crypto/soft-authenticator";
import { createCardService, myCard, ownSafetyWords, toWire } from "@/services/card";
import { newIdentity } from "@/services/identity";
import { CardError, type FamilyCard, type FamilyMember, type Profile } from "@/services/types";
import type { IdentityRow } from "@/store/db";
import { DEFAULT_PREFS } from "@/store/profile";

const utf8ToBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

interface Phone {
  id: IdentityRow;
  profile: Profile;
  card: FamilyCard;
}

async function phone(name: string, opts: { verifiable?: boolean; phone?: string } = {}): Promise<Phone> {
  const id = await newIdentity();
  const cred = opts.verifiable === false ? null : await createSoftCredential();
  const profile: Profile = {
    ...DEFAULT_PREFS,
    deviceId: id.deviceId,
    name,
    color: "indigo",
    role: cred ? "can_be_verified" : "checks_only",
    createdAt: 1,
    setupComplete: true,
    ...(opts.phone ? { phone: opts.phone } : {}),
    ...(cred ? { keyId: cred.credId, publicKey: cred.publicKey, keyCreatedAt: id.createdAt + 1 } : {}),
  };
  return { id, profile, card: myCard(profile, id) };
}

const asMember = (c: FamilyCard, label: string): FamilyMember => ({
  ...c,
  id: `m_${label}`,
  label,
  relation: "son",
  addedAt: 1,
  addedBy: "in_person",
});

async function errorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    return e instanceof CardError ? e.code : "not a CardError";
  }
  return null;
}

describe("family links (card v2)", () => {
  const maa = createCardService(() => "maa-device-id-not-arjun");

  it("round-trips a card, and the receiver derives the same safety words the owner sees", async () => {
    const arjun = await phone("Arjun Sharma", { phone: "+91 98765 43210" });
    const link = maa.toLink(arjun.card);
    expect(link).toMatch(/^https:\/\/pehchaan\.test\/join#c=[A-Za-z0-9_-]+$/);
    const received = await maa.fromLink(link);
    const { safetyWords, ...rest } = received;
    const { safetyWords: _placeholder, ...sent } = arjun.card;
    expect(rest).toEqual(sent);
    expect(safetyWords).toEqual(await ownSafetyWords(arjun.profile, arjun.id));
    expect(safetyWords.every((w) => /^[A-Z]+$/.test(w))).toBe(true);
  });

  it("a checks-only card carries no passkey, and its words still cover the device keys", async () => {
    const guest = await phone("Guest", { verifiable: false });
    const received = await maa.fromLink(maa.toLink(guest.card));
    expect(received.canBeVerified).toBe(false);
    expect(received.keyId).toBeUndefined();
    expect(received.safetyWords).toEqual(await ownSafetyWords(guest.profile, guest.id));
  });

  it("different keys give different words (the words are the card's fingerprint)", async () => {
    const [a, b] = await Promise.all([phone("Arjun"), phone("Arjun")]);
    expect(await ownSafetyWords(a.profile, a.id)).not.toEqual(await ownSafetyWords(b.profile, b.id));
  });

  it("accepts pasted text around the link, and Devanagari names", async () => {
    const arjun = await phone("अर्जुन शर्मा");
    const received = await maa.fromLink(`Here's my code: ${maa.toLink(arjun.card)} thanks`);
    expect(received.name).toBe("अर्जुन शर्मा");
  });

  it("keeps the QR stable: the card's time is its newest key's, not now", async () => {
    const arjun = await phone("Arjun");
    expect(myCard(arjun.profile, arjun.id).createdAt).toBe(myCard(arjun.profile, arjun.id).createdAt);
    expect(arjun.card.createdAt).toBe(arjun.profile.keyCreatedAt);
  });

  it("refuses what isn't a valid card: not_pehchaan, corrupt, old_version (with the name), own_card", async () => {
    const arjun = await phone("Arjun");
    expect(await errorCode(maa.fromLink("hello"))).toBe("not_pehchaan");
    expect(await errorCode(maa.fromLink("https://x/join#c=bm90LWpzb24"))).toBe("corrupt");
    expect(await errorCode(maa.fromLink(`https://x/join#c=${utf8ToBase64Url('{"v":3}')}`))).toBe("corrupt");
    const v1 = maa.fromLink(`https://x/join#c=${utf8ToBase64Url('{"v":1,"n":"Arjun"}')}`);
    await expect(v1).rejects.toMatchObject({ code: "old_version", cardName: "Arjun" });
    const own = createCardService(() => arjun.id.deviceId);
    expect(await errorCode(own.fromLink(own.toLink(arjun.card)))).toBe("own_card");
  });

  it("refuses a card that claims its own safety words (an unknown field)", async () => {
    const arjun = await phone("Arjun");
    const forged = { ...toWire(arjun.card), w: ["TIGER", "MANGO", "RIVER", "LAMP"] };
    expect(await errorCode(maa.fromLink(`https://x/join#c=${utf8ToBase64Url(JSON.stringify(forged))}`))).toBe(
      "corrupt",
    );
  });

  it("refuses a card whose device ID doesn't come from its signing key (altered)", async () => {
    const [arjun, other] = await Promise.all([phone("Arjun"), phone("Other")]);
    const swapped = { ...toWire(arjun.card), dk: toWire(other.card).dk };
    expect(await errorCode(maa.fromLink(`https://x/join#c=${utf8ToBase64Url(JSON.stringify(swapped))}`))).toBe(
      "altered",
    );
  });
});

describe("the new-phone guard (6.5)", () => {
  const cards = createCardService(() => null);

  it("a stranger's card is new", async () => {
    const [arjun, priya] = await Promise.all([phone("Arjun Sharma"), phone("Priya Sharma")]);
    expect(cards.guard(arjun.card, [asMember(priya.card, "Priya")])).toEqual({ kind: "new" });
  });

  it("the same card again is 'already in your family', never a replacement", async () => {
    const arjun = await phone("Arjun Sharma");
    const saved = asMember(arjun.card, "Arjun");
    expect(cards.guard(arjun.card, [saved])).toEqual({ kind: "already", member: saved });
  });

  it("the same device with a different passkey is 'altered'", async () => {
    const arjun = await phone("Arjun Sharma");
    const saved = asMember(arjun.card, "Arjun");
    const cred = await createSoftCredential();
    const changed: FamilyCard = { ...arjun.card, keyId: cred.credId, publicKey: cred.publicKey };
    expect(cards.guard(changed, [saved]).kind).toBe("altered");
  });

  it("a new device using a saved member's name or phone is an impostor", async () => {
    const [arjun, scammer, scammer2] = await Promise.all([
      phone("Arjun Sharma", { phone: "+91 98765 43210" }),
      phone("Arjun"),
      phone("Rahul", { phone: "098765 43210" }),
    ]);
    const saved = asMember(arjun.card, "Arjun");
    expect(cards.guard(scammer.card, [saved])).toMatchObject({ kind: "impostor", match: "name" });
    expect(cards.guard(scammer2.card, [saved])).toMatchObject({ kind: "impostor", match: "phone" });
  });
});
