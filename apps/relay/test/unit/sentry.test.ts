// Relay error reports (spec 16.7, APP-13 relay side): off without a DSN; with one, no personal data is collected and
// every event and breadcrumb is scrubbed.
import { describe, expect, it } from "vitest";
import { NO_PERSONAL_DATA, sentryOptions } from "../../src/sentry";

describe("relay Sentry options (16.7)", () => {
  it("are off without SENTRY_DSN", () => {
    expect(sentryOptions({ env: "production", release: "x" })).toBeNull();
  });

  it("collect no personal data, and scrub every event and breadcrumb", () => {
    const o = sentryOptions({ dsn: "https://k@o1.ingest.sentry.io/2", env: "production", release: "r1" })!;
    expect(o).toMatchObject({ environment: "production", release: "r1", tracesSampleRate: 0 });
    expect(o.dataCollection).toBe(NO_PERSONAL_DATA);
    expect(o.beforeSend!({ extra: { nonce: "n", t: "send", grant: "g.s" } } as never, {} as never)).toEqual({
      extra: { t: "send" },
    });
    expect(o.beforeBreadcrumb!({ data: { endpoint: "https://fcm", kind: "alert" } } as never)).toEqual({
      data: { kind: "alert" },
    });
  });
});
