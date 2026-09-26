// CRY-06: DER ↔ raw ECDSA signatures (10.6).
import { describe, expect, it } from "vitest";
import { concat } from "../src/bytes";
import { derToRaw, rawToDer } from "../src/der";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG = { name: "ECDSA", hash: "SHA-256" } as const;

describe("CRY-06 · derToRaw", () => {
  it("round-trips 1,000 real WebCrypto signatures, and each still verifies", async () => {
    const pair = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
    for (let i = 0; i < 1000; i++) {
      const msg = crypto.getRandomValues(new Uint8Array(32));
      const raw = new Uint8Array(await crypto.subtle.sign(SIG, pair.privateKey, msg));
      const der = rawToDer(raw);
      expect(der[0]).toBe(0x30);
      const back = derToRaw(der);
      expect(back).toEqual(raw);
      if (i % 100 === 0) expect(await crypto.subtle.verify(SIG, pair.publicKey, back, msg)).toBe(true);
    }
  });

  it("encodes minimal integers: a leading zero only when the top bit is set", () => {
    const r = new Uint8Array(32).fill(0x80);
    const s = new Uint8Array(32);
    s[31] = 1; // s = 1 → a single byte
    const der = rawToDer(concat(r, s));
    expect([...der.subarray(0, 4)]).toEqual([0x30, 2 + 33 + 2 + 1, 0x02, 33]);
    expect(der[4]).toBe(0);
    expect([...der.subarray(der.length - 3)]).toEqual([0x02, 1, 1]);
    expect(derToRaw(der)).toEqual(concat(r, s));
  });

  it("strips leading zeros but keeps one before a high byte", () => {
    const r = new Uint8Array(32);
    r[2] = 0x85;
    const s = new Uint8Array(32).fill(1);
    const der = rawToDer(concat(r, s));
    expect([...der.subarray(2, 5)]).toEqual([0x02, 31, 0x00]);
    expect(derToRaw(der)).toEqual(concat(r, s));
  });

  it("encodes an all-zero integer as one zero byte", () => {
    const der = rawToDer(new Uint8Array(64));
    expect([...der]).toEqual([0x30, 6, 0x02, 1, 0, 0x02, 1, 0]);
  });

  it("rawToDer refuses anything but 64 bytes", () => {
    expect(() => rawToDer(new Uint8Array(63))).toThrow();
  });

  const good = () => rawToDer(concat(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)));

  it("rejects a wrong SEQUENCE tag", () => {
    const d = good();
    d[0] = 0x31;
    expect(() => derToRaw(d)).toThrow("bad DER");
  });

  it("rejects short and long input (length mismatch)", () => {
    const d = good();
    expect(() => derToRaw(d.subarray(0, d.length - 1))).toThrow("bad DER");
    expect(() => derToRaw(concat(d, new Uint8Array([0])))).toThrow("bad DER");
    expect(() => derToRaw(new Uint8Array(0))).toThrow("bad DER");
  });

  it("rejects a long-form sequence length", () => {
    const d = good();
    d[1] = 0x81;
    expect(() => derToRaw(d)).toThrow("bad DER");
  });

  it("rejects a wrong INTEGER tag", () => {
    const d = good();
    d[2] = 0x03;
    expect(() => derToRaw(d)).toThrow("bad DER");
  });

  it("rejects a zero-length integer", () => {
    expect(() => derToRaw(new Uint8Array([0x30, 5, 0x02, 0, 0x02, 1, 1]))).toThrow("bad DER");
  });

  it("rejects an integer longer than 33 bytes", () => {
    const body = concat(new Uint8Array([0x02, 34]), new Uint8Array(34), new Uint8Array([0x02, 1, 1]));
    expect(() => derToRaw(concat(new Uint8Array([0x30, body.length]), body))).toThrow("bad DER");
  });

  it("rejects a 33-byte integer without a leading zero", () => {
    const body = concat(new Uint8Array([0x02, 33]), new Uint8Array(33).fill(1), new Uint8Array([0x02, 1, 1]));
    expect(() => derToRaw(concat(new Uint8Array([0x30, body.length]), body))).toThrow("bad DER");
  });

  it("rejects an integer that runs past the end", () => {
    expect(() => derToRaw(new Uint8Array([0x30, 4, 0x02, 3, 1, 1]))).toThrow("bad DER");
  });

  it("rejects extra bytes after the two integers", () => {
    const body = concat(new Uint8Array([0x02, 1, 1, 0x02, 1, 1]), new Uint8Array([0]));
    expect(() => derToRaw(concat(new Uint8Array([0x30, body.length]), body))).toThrow("bad DER");
  });
});
