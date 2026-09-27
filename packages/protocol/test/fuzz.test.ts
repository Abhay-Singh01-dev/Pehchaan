// SEC-01 (spec 21.7), parser half: whatever arrives, the frame and payload parsers answer (ok, or a refusal) and
// never throw. Random text, random JSON, and valid frames with random fields changed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CLIENT_TYPES, KINDS, parseClientFrame, parsePayload, parseRelayFrame, RELAY_TYPES, ulid } from "../src";

const RUNS = { numRuns: 3000 };
const json = fc.jsonValue({ maxDepth: 5 });

describe("SEC-01 · parsers never throw", () => {
  it("on any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 400 }), (s) => {
        expect(() => parseClientFrame(s)).not.toThrow();
        expect(() => parseRelayFrame(s)).not.toThrow();
      }),
      RUNS,
    );
  });

  it("on any JSON", () => {
    fc.assert(
      fc.property(json, (v) => {
        const s = JSON.stringify(v) ?? "null";
        const c = parseClientFrame(s);
        expect(typeof c.ok).toBe("boolean");
        expect(() => parseRelayFrame(s)).not.toThrow();
        for (const k of KINDS) expect(() => parsePayload(k, v)).not.toThrow();
      }),
      RUNS,
    );
  });

  it("on frames of every type with random bodies (a refusal names the frame id when it has one)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLIENT_TYPES, ...RELAY_TYPES), json, fc.boolean(), (t, body, withId) => {
        const id = ulid();
        const s = JSON.stringify({ v: 1, t, ...(withId ? { id } : {}), ts: Date.now(), sts: Date.now(), body });
        const c = parseClientFrame(s);
        if (!c.ok && withId) expect([id, undefined]).toContain(c.id);
        expect(() => parseRelayFrame(s)).not.toThrow();
      }),
      RUNS,
    );
  });

  it("on deeply nested or huge values without running out of stack", () => {
    // Written as text: building a 5,000-deep object and stringifying it would overflow the test itself.
    const deep = '{"a":'.repeat(5000) + '"x"' + "}".repeat(5000);
    const s = `{"v":1,"t":"send","id":"${ulid()}","ts":1,"body":${deep}}`;
    expect(parseClientFrame(s).ok).toBe(false);
    expect(parseRelayFrame(s)).toBeNull();
    expect(
      parseClientFrame(JSON.stringify({ v: 1, t: "ping", id: ulid(), ts: 1, body: { pad: "x".repeat(200_000) } })).ok,
    ).toBe(false);
  });
});
