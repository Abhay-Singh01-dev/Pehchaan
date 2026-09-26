// authenticatorData parsing: flags and minimum length (21.1).
import { describe, expect, it } from "vitest";
import { AUTH_DATA_MIN, FLAG_UP, FLAG_UV, parseAuthData } from "../src/authdata";

describe("authenticatorData", () => {
  it("reads the rpId hash, UP and UV flags and the sign count", () => {
    const ad = new Uint8Array(37);
    ad.fill(9, 0, 32);
    ad[32] = FLAG_UP | FLAG_UV;
    ad.set([0, 0, 1, 2], 33);
    const p = parseAuthData(ad);
    expect(p.rpIdHash).toEqual(new Uint8Array(32).fill(9));
    expect(p.up).toBe(true);
    expect(p.uv).toBe(true);
    expect(p.signCount).toBe(258);
  });

  it("reports missing flags", () => {
    const ad = new Uint8Array(AUTH_DATA_MIN);
    ad[32] = FLAG_UP;
    expect(parseAuthData(ad).uv).toBe(false);
    ad[32] = FLAG_UV;
    expect(parseAuthData(ad).up).toBe(false);
  });

  it("refuses anything under 37 bytes", () => {
    expect(() => parseAuthData(new Uint8Array(36))).toThrow("too short");
  });

  it("reads a sign count with the top bit set as unsigned", () => {
    const ad = new Uint8Array(37);
    ad.set([0xff, 0xff, 0xff, 0xff], 33);
    expect(parseAuthData(ad).signCount).toBe(0xffffffff);
  });
});
