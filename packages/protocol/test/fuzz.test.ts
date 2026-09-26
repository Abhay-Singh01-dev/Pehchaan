// PRO-02: random JSON never crashes the parsers; frames are always accepted or rejected cleanly.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CLIENT_TYPES, parseClientFrame, parsePayload, parseRelayFrame, KINDS, RELAY_TYPES } from "../src/index";
import { clientBodies, frame } from "./samples";

const anyJson = fc.jsonValue();

describe("PRO-02 · fuzzing the parsers", () => {
  it("arbitrary strings never throw", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = parseClientFrame(s);
        expect(typeof r.ok).toBe("boolean");
        parseRelayFrame(s);
      }),
      { numRuns: 3000 },
    );
  });

  it("arbitrary JSON values never throw", () => {
    fc.assert(
      fc.property(anyJson, (v) => {
        parseClientFrame(JSON.stringify(v));
        parseRelayFrame(JSON.stringify(v));
        for (const k of KINDS) parsePayload(k, v);
      }),
      { numRuns: 3000 },
    );
  });

  it("envelopes with random t and random bodies never throw", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...CLIENT_TYPES, ...RELAY_TYPES, "__proto__", "constructor", "toString"), fc.string()),
        anyJson,
        (t, body) => {
          parseClientFrame(frame(t, body));
          parseRelayFrame(JSON.stringify({ v: 1, t, id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F", sts: 1, body }));
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("valid bodies with one field replaced by random JSON are accepted or rejected cleanly", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLIENT_TYPES), fc.string(), anyJson, (t, field, value) => {
        const body = { ...(clientBodies[t] as Record<string, unknown>), [field]: value };
        const r = parseClientFrame(frame(t, body));
        expect(typeof r.ok).toBe("boolean");
      }),
      { numRuns: 3000 },
    );
  });
});
