// Phase 9: the error-report scrubber (spec 16.7, APP-13 relay side). Sentry's beforeSend runs every event through it.
import { describe, expect, it } from "vitest";
import { SCRUBBED_FIELDS, scrub } from "../../src/scrub";

describe("scrub (16.7)", () => {
  it("removes every field named in 16.7, at any depth, in objects and arrays, whatever its case", () => {
    const event = {
      message: "failing closed",
      extra: { e2e: { ct: "x" }, plain: { req: 1 }, Nonce: "n", signature: "s", grant: "g.s", endpoint: "https://fcm" },
      contexts: { device: { name: "Sunita", phone: "+919810000021", label: "Maa", t: "send" } },
      breadcrumbs: [{ data: { kind: "verify.request", nested: [{ LABEL: "Arjun", ok: true }] } }],
    };
    expect(scrub(event)).toEqual({
      message: "failing closed",
      extra: {},
      contexts: { device: { t: "send" } },
      breadcrumbs: [{ data: { kind: "verify.request", nested: [{ ok: true }] } }],
    });
    expect(SCRUBBED_FIELDS).toEqual([
      "e2e",
      "plain",
      "nonce",
      "signature",
      "grant",
      "endpoint",
      "phone",
      "name",
      "label",
    ]);
  });

  it("leaves the original untouched, and passes other values through", () => {
    const e = { name: "x", n: 1, s: "ok", z: null, list: [1, "a"] };
    expect(scrub(e)).toEqual({ n: 1, s: "ok", z: null, list: [1, "a"] });
    expect(e.name).toBe("x");
    expect(scrub("text")).toBe("text");
    expect(scrub(null)).toBe(null);
  });

  it("copes with cycles", () => {
    const a: Record<string, unknown> = { k: 1, nonce: "n" };
    a.self = a;
    expect(scrub(a)).toEqual({ k: 1, self: "[cycle]" });
  });
});
