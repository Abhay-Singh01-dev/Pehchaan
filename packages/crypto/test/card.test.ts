// CRY-14: card v2 encode/decode, every 6.1 validation failure, and every row of the 6.5 new-phone guard.
import { beforeAll, describe, expect, it } from "vitest";
import { b64url, utf8 } from "../src/bytes";
import {
  type CardError,
  cardLink,
  decodeCard,
  encodeCard,
  extractCode,
  guardNewCard,
  type CardV2,
  type KnownMember,
} from "../src/card";
import { makeDevice, type TestDevice } from "./helpers";

let arjunDev: TestDevice;
let scammerDev: TestDevice;
let arjun: CardV2;
let maaCard: CardV2;

async function cardFor(dev: TestDevice, over: Partial<CardV2> = {}, verifiable = true): Promise<CardV2> {
  const base: CardV2 = {
    v: 2,
    d: dev.deviceId,
    n: "Arjun Sharma",
    p: "+91 98765 43210",
    c: "indigo",
    r: verifiable ? "v" : "c",
    dk: dev.dk,
    ek: dev.ek,
    g: `${b64url(crypto.getRandomValues(new Uint8Array(8)))}.${b64url(crypto.getRandomValues(new Uint8Array(16)))}`,
    ts: 1761900000000,
  };
  if (verifiable)
    Object.assign(base, {
      kt: "pk",
      ki: b64url(crypto.getRandomValues(new Uint8Array(16))),
      pk: (await makeDevice()).dk,
    });
  return { ...base, ...over };
}

/** A family link carrying any JSON, as an attacker could build one. */
const raw = (o: unknown) => `https://app.yourdomain.in/join#c=${b64url(utf8(JSON.stringify(o)))}`;
const code = async (input: string, my?: string) => {
  try {
    await decodeCard(input, { myDeviceId: my });
    return "ok";
  } catch (e) {
    return (e as CardError).code;
  }
};

beforeAll(async () => {
  [arjunDev, scammerDev] = await Promise.all([makeDevice(), makeDevice()]);
  arjun = await cardFor(arjunDev);
  maaCard = await cardFor(await makeDevice(), { n: "Sunita Sharma", p: undefined }, false);
});

describe("CRY-14 · card v2 encode / decode (6.1)", () => {
  it("round-trips a can-be-verified card through a family link", async () => {
    const link = cardLink("https://app.yourdomain.in", arjun);
    expect(link.startsWith("https://app.yourdomain.in/join#c=")).toBe(true);
    expect(await decodeCard(link)).toEqual(arjun);
  });

  it("round-trips a checks-only card without kt, ki or pk", async () => {
    const decoded = await decodeCard(encodeCard(maaCard));
    expect(decoded).toEqual(maaCard);
    expect(decoded).not.toHaveProperty("kt");
  });

  it("accepts a bare code, a link, and a message containing the link", async () => {
    const c = encodeCard(arjun);
    expect(extractCode(c)).toBe(c);
    expect(extractCode(`Add me on Pehchaan: https://app.yourdomain.in/join#c=${c} thanks`)).toBe(c);
    expect(extractCode(`https://app.yourdomain.in/join?c=${c}`)).toBe(c);
    expect(extractCode("hello")).toBeNull();
    expect(extractCode("   ")).toBeNull();
  });

  it("keeps a full card within QR-friendly size (≈750–800 characters, 6.1)", () => {
    expect(cardLink("https://app.yourdomain.in", arjun).length).toBeLessThan(900);
  });

  it("trims the name and phone", async () => {
    const c = await decodeCard(raw({ ...arjun, n: "  Arjun  ", p: " +91 1234567890 " }));
    expect(c.n).toBe("Arjun");
    expect(c.p).toBe("+91 1234567890");
  });

  it("carries no safety words", () => {
    expect(JSON.stringify(arjun)).not.toMatch(/"w"/);
  });
});

describe("CRY-14 · every 6.1 validation failure", () => {
  it("not a Pehchaan code", async () => {
    expect(await code("https://example.com/")).toBe("not_pehchaan");
  });

  it("not JSON, or not an object → corrupt", async () => {
    expect(await code(b64url(utf8("not json at all, just text...............")))).toBe("corrupt");
    expect(await code(raw([1, 2, 3]))).toBe("corrupt");
    expect(await code(raw(null))).toBe("corrupt");
    expect(await code(`https://app.yourdomain.in/join#c=${b64url(new Uint8Array([0xff, 0xfe, 0x00]))}`)).toBe(
      "corrupt",
    );
  });

  it("a v1 card → old_version, with the name for the message", async () => {
    try {
      await decodeCard(raw({ v: 1, d: "sim-arjun", n: "Arjun", c: "indigo", b: 1, w: "A.B.C.D" }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CardError).code).toBe("old_version");
      expect((e as CardError).cardName).toBe("Arjun");
    }
    expect(await code(raw({ v: 1, n: 5 }))).toBe("old_version");
  });

  it("an unknown version → corrupt", async () => {
    expect(await code(raw({ ...arjun, v: 3 }))).toBe("corrupt");
  });

  it("unknown fields → corrupt", async () => {
    expect(await code(raw({ ...arjun, w: "TIGER.MANGO.RIVER.LAMP" }))).toBe("corrupt");
  });

  it("a public key that isn't 65 bytes starting with 0x04 → corrupt", async () => {
    const short = b64url(new Uint8Array(64).fill(4));
    const prefix = new Uint8Array(65).fill(1);
    prefix[0] = 2;
    for (const k of ["dk", "ek", "pk"] as const) {
      expect(await code(raw({ ...arjun, [k]: short }))).toBe("corrupt");
      expect(await code(raw({ ...arjun, [k]: b64url(prefix) }))).toBe("corrupt");
      expect(await code(raw({ ...arjun, [k]: "!".repeat(87) }))).toBe("corrupt");
    }
  });

  it("each field outside its limits → corrupt", async () => {
    const bad: Array<Partial<Record<keyof CardV2, unknown>>> = [
      { d: "short" },
      { d: 42 },
      { n: "" },
      { n: "x".repeat(41) },
      { n: "Arjun\u0000" },
      { p: "9".repeat(25) },
      { p: 98765 },
      { c: "green" },
      { r: "x" },
      { g: "nodot" },
      { g: "a.b" },
      { ts: 1.5 },
      { ts: -1 },
      { ts: "1761900000000" },
      { kt: "pin" },
      { ki: "!!" },
      { ki: b64url(new Uint8Array(8)) }, // too short for a credential ID
      { ki: undefined },
      { pk: undefined },
    ];
    for (const over of bad) expect(await code(raw({ ...arjun, ...over })), JSON.stringify(over)).toBe("corrupt");
    // A checks-only card carrying passkey fields is corrupt too.
    expect(await code(raw({ ...arjun, r: "c" }))).toBe("corrupt");
  });

  it("an ID that doesn't belong to the device key → altered", async () => {
    expect(await code(raw({ ...arjun, dk: scammerDev.dk }))).toBe("altered");
  });

  it("my own card → own_card", async () => {
    expect(await code(encodeCard(arjun), arjun.d)).toBe("own_card");
    expect(await code(encodeCard(arjun), "someone-else-entirely-")).toBe("ok");
  });
});

describe("CRY-14 · the new-phone guard, every 6.5 row", () => {
  const member = (c: CardV2, label: string): KnownMember => ({
    deviceId: c.d,
    name: c.n,
    label,
    ...(c.p ? { phone: c.p } : {}),
    devicePub: c.dk,
    encPub: c.ek,
    ...(c.kt ? { keyType: c.kt, keyId: c.ki!, publicKey: c.pk! } : {}),
  });

  it("same d, identical keys → already", () => {
    const family = [member(arjun, "Arjun")];
    expect(guardNewCard(arjun, family)).toEqual({ kind: "already", member: family[0] });
    const checksOnly = [member(maaCard, "Maa")];
    expect(guardNewCard(maaCard, checksOnly).kind).toBe("already");
  });

  it("same d, different ek / ki / pk → altered (hard block)", async () => {
    const family = [member(arjun, "Arjun")];
    expect(guardNewCard({ ...arjun, ek: scammerDev.ek }, family).kind).toBe("altered");
    expect(guardNewCard({ ...arjun, ki: b64url(new Uint8Array(16).fill(3)) }, family).kind).toBe("altered");
    expect(guardNewCard({ ...arjun, pk: scammerDev.dk }, family).kind).toBe("altered");
    const { kt: _kt, ki: _ki, pk: _pk, ...noPasskey } = arjun;
    expect(guardNewCard({ ...noPasskey, r: "c" }, family).kind).toBe("altered");
  });

  it("a different d with the same name → impostor (the red warning)", async () => {
    const family = [member(arjun, "Arjun")];
    const scam = await cardFor(scammerDev, { n: "Arjun Sharma", p: undefined });
    expect(guardNewCard(scam, family)).toMatchObject({ kind: "impostor", match: "name", member: family[0] });
    // Case, spacing and first-name-only variants still match (D-013).
    for (const n of ["ARJUN  sharma", "Arjun", "arjun kumar"]) {
      expect(guardNewCard({ ...scam, n }, family).kind, n).toBe("impostor");
    }
    // The label counts too: Maa saved him as "Beta".
    const labelled = [member(arjun, "Beta")];
    expect(guardNewCard({ ...scam, n: "Beta" }, labelled).kind).toBe("impostor");
  });

  it("a different d with the same phone number → impostor", async () => {
    const family = [member(arjun, "Arjun")];
    const scam = await cardFor(scammerDev, { n: "Rahul Verma", p: "098765 43210" });
    expect(guardNewCard(scam, family)).toMatchObject({ kind: "impostor", match: "phone" });
    // Too few digits never matches.
    const tiny = [{ ...member(arjun, "Arjun"), phone: "12" }];
    expect(guardNewCard({ ...scam, p: "12" }, tiny).kind).toBe("new");
  });

  it("a genuinely new person → new", async () => {
    const family = [member(arjun, "Arjun")];
    const priya = await cardFor(scammerDev, { n: "Priya Sharma", p: "+91 91111 22222" });
    expect(guardNewCard(priya, family)).toEqual({ kind: "new" });
    expect(guardNewCard(priya, [])).toEqual({ kind: "new" });
    const noPhone = [{ ...member(arjun, "Arjun"), phone: undefined }];
    expect(guardNewCard({ ...priya, p: undefined }, noPhone).kind).toBe("new");
  });
});
