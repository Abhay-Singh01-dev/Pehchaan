// The byte helpers of spec 9.3, including strict base64url.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { b64url, b64urlDecode, concat, equalBytes, sha256, utf8 } from "../src/bytes";

describe("base64url", () => {
  it("matches Node's base64url for any bytes and round-trips (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const s = b64url(bytes);
        expect(s).toBe(Buffer.from(bytes).toString("base64url"));
        expect(b64urlDecode(s)).toEqual(bytes);
      }),
    );
  });

  it("rejects characters outside A–Z a–z 0–9 - _ (including padding and standard base64)", () => {
    for (const bad of ["ab+c", "ab/c", "abc=", "ab c", "ab\nc", "abç", "ab🙂"]) {
      expect(() => b64urlDecode(bad), bad).toThrow("base64url");
    }
  });

  it("rejects impossible lengths", () => {
    expect(() => b64urlDecode("a")).toThrow("bad length");
    expect(() => b64urlDecode("abcde")).toThrow("bad length");
  });

  it("rejects non-canonical trailing bits, so each byte string has one text form", () => {
    expect(b64urlDecode("AA")).toEqual(new Uint8Array([0]));
    expect(() => b64urlDecode("AB")).toThrow("non-canonical");
    expect(() => b64urlDecode("AAB")).toThrow("non-canonical");
  });

  it("decodes the empty string", () => {
    expect(b64urlDecode("")).toEqual(new Uint8Array(0));
    expect(b64url(new Uint8Array(0))).toBe("");
  });
});

describe("concat, equalBytes, sha256, utf8", () => {
  it("concatenates in order", () => {
    expect(concat(new Uint8Array([1]), new Uint8Array([]), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("compares bytes", () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
  });

  it("hashes with SHA-256", async () => {
    expect(Buffer.from(await sha256(utf8("abc"))).toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("encodes UTF-8", () => {
    expect(utf8("बे")).toEqual(new Uint8Array(Buffer.from("बे", "utf8")));
  });
});
