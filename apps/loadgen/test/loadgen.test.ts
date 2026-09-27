// apps/loadgen (spec 21.4): the pure pieces. The scenarios themselves run against a real relay stack in
// `pnpm test:ops` (OPS-03) and `pnpm test:load:short` / LOAD-01…03.
import { describe, expect, it } from "vitest";
import { backoffMs } from "../src/backoff";
import { endpointFrom } from "../src/cli";
import { Samples, percentile } from "../src/stats";

describe("percentiles", () => {
  it("uses the nearest rank", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it("summarises a window and can start a new one", () => {
    const s = new Samples();
    for (const ms of [30, 10, 20]) s.add(ms);
    expect(s.summary(true)).toEqual({ count: 3, p50: 20, p95: 30, p99: 30, max: 30 });
    expect(s.summary().count).toBe(0);
  });
});

describe("reconnect backoff (the app's, 8.9)", () => {
  it("is 0.5, 1, 2, 4, 8 s, then stays at 8 s", () => {
    const mid = () => 0.5; // no jitter
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => backoffMs(n, mid))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it("jitters by ±30%", () => {
    expect(backoffMs(0, () => 0)).toBe(350);
    expect(backoffMs(0, () => 1)).toBe(650);
  });
});

describe("settings", () => {
  const ok = { LOADGEN_RELAY_URL: "wss://relay.example.in/v1/ws", LOADGEN_ORIGIN: "https://app.example.in" };

  it("reads the endpoint, defaulting the login host to the URL's host", () => {
    expect(endpointFrom(ok)).toEqual({
      url: ok.LOADGEN_RELAY_URL,
      origin: ok.LOADGEN_ORIGIN,
      relayHost: "relay.example.in",
    });
    expect(endpointFrom({ ...ok, LOADGEN_RELAY_HOST: "x.example.in" }).relayHost).toBe("x.example.in");
  });

  it("refuses missing or malformed settings", () => {
    expect(() => endpointFrom({ LOADGEN_ORIGIN: ok.LOADGEN_ORIGIN })).toThrow(/LOADGEN_RELAY_URL/);
    expect(() => endpointFrom({ ...ok, LOADGEN_RELAY_URL: "https://relay" })).toThrow(/LOADGEN_RELAY_URL/);
    expect(() => endpointFrom({ ...ok, LOADGEN_ORIGIN: "app.example.in" })).toThrow(/LOADGEN_ORIGIN/);
  });
});
