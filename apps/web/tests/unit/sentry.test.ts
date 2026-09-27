// APP-13 (spec 16.7): error reports never carry personal data. Sentry is set up with sendDefaultPii off and every
// event and breadcrumb passes the scrubber, which removes each field 16.7 names, at any depth.
import { describe, expect, it } from "vitest";
import { SCRUBBED_FIELDS, scrub } from "@/app/scrub";
import { NO_PERSONAL_DATA, sentryOptions } from "@/app/sentry";

describe("the scrubber (16.7)", () => {
  it("removes e2e, plain, nonce, signature, grant, endpoint, phone, name and label, at any depth", () => {
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
    const event = {
      message: "Relay: rejected",
      extra: { e2e: { ct: "x" }, plain: { req: 1 }, nonce: "n", signature: "s", grant: "g", endpoint: "https://fcm" },
      user: { name: "Sunita", phone: "+91", id: "keep-me-not" },
      contexts: { member: { Label: "Maa", kind: "verify.request" } },
    };
    expect(scrub(event)).toEqual({
      message: "Relay: rejected",
      extra: {},
      user: { id: "keep-me-not" },
      contexts: { member: { kind: "verify.request" } },
    });
  });
});

describe("Sentry options", () => {
  it("are off without a DSN, and with one collect no personal data and scrub every event and breadcrumb", () => {
    expect(sentryOptions({ dsn: "", env: "production", build: "abc" })).toBeNull();
    const o = sentryOptions({ dsn: "https://k@o1.ingest.sentry.io/2", env: "production", build: "abc" })!;
    expect(o).toMatchObject({ dsn: "https://k@o1.ingest.sentry.io/2", environment: "production", release: "abc" });
    // Sentry 11's replacement for sendDefaultPii: false. Every kind of automatic collection is off.
    expect(o.dataCollection).toBe(NO_PERSONAL_DATA);
    expect(
      Object.values(NO_PERSONAL_DATA).every(
        (v) =>
          v === false ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && Object.values(v).every((x) => x === false)),
      ),
    ).toBe(true);
    expect(o.beforeSend!({ extra: { name: "Sunita", t: "send" } } as never, {} as never)).toEqual({
      extra: { t: "send" },
    });
    expect(o.beforeBreadcrumb!({ data: { url: "/x", phone: "+91" } } as never)).toEqual({ data: { url: "/x" } });
  });
});
