// CRY-01 canonical JSON; CRY-03 the challenge binds every signed field and the decision.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { b64url } from "../src/bytes";
import { canonical, canonicalRequest, challengeFor } from "../src/canonical";
import type { CanonicalRequestFields } from "../src/types";
import vectors from "./vectors.json";

describe("CRY-01 · canonical JSON (10.1)", () => {
  it("sorts keys recursively and writes no whitespace", () => {
    expect(canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("sorts by UTF-16 code units (capitals before lower case)", () => {
    expect(canonical({ b: 1, B: 2, a: 3, _: 4 })).toBe('{"B":2,"_":4,"a":3,"b":1}');
  });

  it("omits undefined fields", () => {
    expect(canonical({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it("writes strings exactly as JSON.stringify, keeping Devanagari as raw UTF-8", () => {
    expect(canonical({ s: 'बेटा "x"\n' })).toBe('{"s":"बेटा \\"x\\"\\n"}');
    expect(canonical("बेटा")).not.toContain("\\u");
  });

  it("writes null, booleans and empty containers", () => {
    expect(canonical({ n: null, t: true, f: false, e: [], o: {} })).toBe('{"e":[],"f":false,"n":null,"o":{},"t":true}');
  });

  it("allows only safe integers", () => {
    expect(canonical(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    expect(() => canonical({ amountInr: 50000.5 })).toThrow("integers only");
    expect(() => canonical(Number.MAX_SAFE_INTEGER + 1)).toThrow("integers only");
    expect(() => canonical(Number.NaN)).toThrow("integers only");
    expect(() => canonical(Infinity)).toThrow("integers only");
  });

  it("refuses values JSON can't represent", () => {
    expect(() => canonical(undefined)).toThrow("unsupported");
    expect(() => canonical([undefined])).toThrow("unsupported");
    expect(() => canonical(() => 1)).toThrow("unsupported");
    expect(() => canonical(Symbol("x"))).toThrow("unsupported");
    expect(() => canonical(1n)).toThrow("unsupported");
  });

  it("is independent of key insertion order (property)", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.string(), fc.boolean())), (o) => {
        const reversed = Object.fromEntries(Object.entries(o).reverse());
        expect(canonical(reversed)).toBe(canonical(o));
        expect(JSON.parse(canonical(o))).toEqual(o);
      }),
    );
  });
});

describe("CRY-01 · canonicalRequest carries exactly the signed fields (10.2)", () => {
  it("ignores display-only fields and adds v: 1", () => {
    const withDisplay = { ...vectors.requestA, fromName: "Sunita", fromLabel: "Maa", channel: "call" };
    expect(canonicalRequest(withDisplay)).toBe(vectors.canonicalA);
  });
});

const baseReq: CanonicalRequestFields = vectors.requestA;
const SIGNED_FIELDS = [
  "requestId",
  "nonce",
  "fromDeviceId",
  "toDeviceId",
  "claimedLabel",
  "reason",
  "amountInr",
  "createdAt",
  "expiresAt",
] as const;

describe("CRY-03 · the challenge binds every signed field and the decision", () => {
  it("changing any signed field changes the challenge (property)", async () => {
    const original = b64url(await challengeFor(baseReq, "ME"));
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SIGNED_FIELDS),
        fc.string({ minLength: 1 }),
        fc.integer(),
        async (f, s, n) => {
          const current = baseReq[f];
          const next = typeof current === "number" ? (n === current ? n + 1 : n) : s === current ? s + "x" : s;
          const changed = { ...baseReq, [f]: next } as CanonicalRequestFields;
          expect(b64url(await challengeFor(changed, "ME"))).not.toBe(original);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("removing an optional field changes the challenge", async () => {
    const { reason: _r, ...noReason } = baseReq;
    const { amountInr: _a, ...noAmount } = baseReq;
    const original = b64url(await challengeFor(baseReq, "ME"));
    expect(b64url(await challengeFor(noReason, "ME"))).not.toBe(original);
    expect(b64url(await challengeFor(noAmount, "ME"))).not.toBe(original);
  });

  it("the decision is part of the challenge", async () => {
    expect(b64url(await challengeFor(baseReq, "ME"))).not.toBe(b64url(await challengeFor(baseReq, "NOT_ME")));
  });
});
