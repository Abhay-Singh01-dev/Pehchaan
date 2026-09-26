// CRY-10: end-to-end seal and open (9.2, 9.3). Tampering with the header, the ciphertext or the sender,
// and a relay re-seal forgery, are all rejected.
import { beforeAll, describe, expect, it } from "vitest";
import { b64url, b64urlDecode } from "../src/bytes";
import { E2E_ALG, headerAad, open, seal, type Header, type Sealed } from "../src/e2e";
import { makeDevice, type TestDevice } from "./helpers";

let maa: TestDevice;
let arjun: TestDevice;
let mallory: TestDevice;
let h: Header;
const payload = {
  spk: "",
  sek: "",
  fromName: "Sunita",
  req: { requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F", amountInr: 50000 },
};

beforeAll(async () => {
  [maa, arjun, mallory] = await Promise.all([makeDevice(), makeDevice(), makeDevice()]);
  h = {
    kind: "verify.request",
    id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
    from: maa.deviceId,
    to: arjun.deviceId,
    re: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
  };
  payload.spk = maa.dk;
  payload.sek = maa.ek;
});

const sealToArjun = () => seal(payload, h, arjun.ekRaw, maa.sign.privateKey);
const openAsArjun = (e: Sealed, header: Header = h, knownDk?: string) =>
  open<typeof payload>(e, header, arjun.enc.privateKey, arjun.ekRaw, knownDk);

/** Flips one bit of a base64url field. */
function flip(s: string, byte = 0): string {
  const b = b64urlDecode(s);
  b[byte] = b[byte]! ^ 0x01;
  return b64url(b);
}

describe("CRY-10 · E2E", () => {
  it("round-trips: the recipient opens exactly the payload", async () => {
    const e = await sealToArjun();
    expect(e.alg).toBe(E2E_ALG);
    expect(await openAsArjun(e)).toEqual(payload);
    expect(await openAsArjun(e, h, maa.dk)).toEqual(payload); // matches the saved card too
  });

  it("uses a fresh ephemeral key and IV for every message", async () => {
    const a = await sealToArjun();
    const b = await sealToArjun();
    expect(a.epk).not.toBe(b.epk);
    expect(a.iv).not.toBe(b.iv);
  });

  it("headerAad is the canonical header, with re omitted when absent", () => {
    const { re: _re, ...noRe } = h;
    expect(new TextDecoder().decode(headerAad(noRe))).toBe(
      `{"from":"${maa.deviceId}","id":"${h.id}","kind":"verify.request","to":"${arjun.deviceId}","v":1}`,
    );
  });

  for (const field of ["kind", "id", "from", "to", "re"] as const) {
    it(`changing the header's ${field} → tampered`, async () => {
      const e = await sealToArjun();
      await expect(openAsArjun(e, { ...h, [field]: h[field] + "x" })).rejects.toThrow("tampered");
    });
  }

  it("dropping re from the header → tampered", async () => {
    const e = await sealToArjun();
    const { re: _re, ...noRe } = h;
    await expect(openAsArjun(e, noRe)).rejects.toThrow("tampered");
  });

  for (const field of ["ct", "iv", "epk", "sig"] as const) {
    it(`changing ${field} → tampered`, async () => {
      const e = await sealToArjun();
      await expect(openAsArjun({ ...e, [field]: flip(e[field], 5) })).rejects.toThrow("tampered");
    });
  }

  it("an unknown alg → tampered", async () => {
    const e = await sealToArjun();
    await expect(openAsArjun({ ...e, alg: "p256-hkdf-a128gcm" })).rejects.toThrow("tampered");
  });

  it("undecodable fields → tampered", async () => {
    const e = await sealToArjun();
    await expect(openAsArjun({ ...e, ct: "!!" })).rejects.toThrow("tampered");
  });

  it("a spoofed sender (spk belongs to someone else) → tampered", async () => {
    // Mallory seals a payload claiming Maa's key, signing with her own: the sender check or the signature fails.
    const spoofed = await seal({ ...payload, spk: maa.dk }, h, arjun.ekRaw, mallory.sign.privateKey);
    await expect(openAsArjun(spoofed)).rejects.toThrow("tampered");
    // Mallory uses her own key but Maa's device ID as the envelope's sender: spk ↔ from mismatch.
    const ownKey = await seal({ ...payload, spk: mallory.dk }, h, arjun.ekRaw, mallory.sign.privateKey);
    await expect(openAsArjun(ownKey)).rejects.toThrow("tampered");
  });

  it("a sender key that doesn't match my saved card for them → tampered", async () => {
    const e = await sealToArjun();
    await expect(openAsArjun(e, h, mallory.dk)).rejects.toThrow("tampered");
  });

  it("a relay re-seal forgery (valid encryption to Arjun, but not signed by Maa) → tampered", async () => {
    // The relay can encrypt anything to Arjun and can copy Maa's old signature, but the signature covers
    // this envelope's ephemeral key, IV and ciphertext, so it can't be reused.
    const genuine = await sealToArjun();
    const forged = await seal(
      { ...payload, req: { ...payload.req, amountInr: 1 } },
      h,
      arjun.ekRaw,
      mallory.sign.privateKey,
    );
    await expect(openAsArjun({ ...forged, sig: genuine.sig })).rejects.toThrow("tampered");
  });

  it("the wrong recipient key can't open it", async () => {
    const e = await sealToArjun();
    await expect(open(e, h, mallory.enc.privateKey, mallory.ekRaw)).rejects.toThrow("tampered");
    await expect(open(e, h, arjun.enc.privateKey, mallory.ekRaw)).rejects.toThrow("tampered");
  });
});
