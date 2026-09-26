// REL-16: every row of the 16.1 table (limit, burst, retryAfterMs), the GCRA script over time, and many
// devices behind one IP (CGNAT) at realistic numbers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD, type Scope } from "../src/core/ratelimit";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("ratelimit");
});
afterAll(() => env.cleanup());

const hub = () => env.relays[0]!.hub;

describe("REL-16 · the 16.1 table", () => {
  it("matches the spec row by row", () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    expect(STANDARD).toEqual({
      upgrade_ip: { limit: 120, windowMs: MIN, burst: 30 },
      login_fail_ip: { limit: 30, windowMs: 10 * MIN, burst: 10 },
      frame_socket: { limit: 20, windowMs: 1000, burst: 40 },
      request_device_min: { limit: 10, windowMs: MIN, burst: 5 },
      request_device_hour: { limit: 60, windowMs: HOUR, burst: 5 },
      request_pair: { limit: 3, windowMs: MIN, burst: 2 },
      answer_device: { limit: 20, windowMs: MIN, burst: 10 },
      alert_device: { limit: 100, windowMs: HOUR, burst: 20 },
      prompt_device: { limit: 12, windowMs: MIN, burst: 4 },
      presence_device: { limit: 30, windowMs: MIN, burst: 10 },
      push_subscribe_device: { limit: 10, windowMs: HOUR, burst: 3 },
      grant_rotate_device: { limit: 10, windowMs: DAY, burst: 3 },
      binding_target: { limit: 20, windowMs: DAY, burst: 5 },
      binding_sender: { limit: 20, windowMs: DAY, burst: 5 },
      push_target: { limit: 60, windowMs: HOUR, burst: 20 },
      lab_password_ip: { limit: 5, windowMs: 10 * MIN, burst: 3 },
      push_test_device: { limit: 3, windowMs: HOUR, burst: 1 },
      http_fetch_device: { limit: 30, windowMs: MIN, burst: 10 },
    });
  });

  it("each row allows exactly its burst at once, then refuses with retryAfterMs = one interval", async () => {
    // A fixed synthetic clock: some rows refill every 50 ms, faster than the test's own round trips.
    const now = 5_000_000_000;
    for (const [scope, l] of Object.entries(STANDARD) as Array<[Scope, (typeof STANDARD)[Scope]]>) {
      const key = `${env.iso.keyPrefix}rl:${scope}:row-${Date.now()}`;
      const T = l.windowMs / l.limit;
      for (let i = 0; i < l.burst; i++)
        expect(await hub().redis.gcra(key, now, T, l.burst), `${scope} #${i + 1}`).toBe(0);
      expect(await hub().redis.gcra(key, now, T, l.burst), scope).toBe(Math.ceil(T));
    }
  });

  it("the limiter applies each row's interval and burst", async () => {
    const key = `live-${Date.now()}`;
    for (let i = 0; i < STANDARD.grant_rotate_device.burst; i++)
      expect(await hub().limiter.check("grant_rotate_device", key)).toBe(0);
    const wait = await hub().limiter.check("grant_rotate_device", key);
    const T = STANDARD.grant_rotate_device.windowMs / STANDARD.grant_rotate_device.limit;
    expect(wait).toBeGreaterThan(T - 1000);
    expect(wait).toBeLessThanOrEqual(Math.ceil(T));
  });

  it("take() throws rate_limited with the wait", async () => {
    const key = `take-${Date.now()}`;
    await hub().limiter.take("push_test_device", key);
    await expect(hub().limiter.take("push_test_device", key)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("REL-16 · GCRA over time (synthetic clock)", () => {
  const gcra = (key: string, now: number, T: number, burst: number) =>
    hub().redis.gcra(`${env.iso.keyPrefix}rl:gcra:${key}`, now, T, burst);

  it("a burst, then one per interval", async () => {
    const key = `steady-${Date.now()}`;
    const t0 = 1_000_000_000;
    // T = 1000 ms, burst 3: three at once…
    for (let i = 0; i < 3; i++) expect(await gcra(key, t0, 1000, 3)).toBe(0);
    // …the fourth must wait exactly one interval…
    expect(await gcra(key, t0, 1000, 3)).toBe(1000);
    // …and then one more is allowed per second.
    expect(await gcra(key, t0 + 1000, 1000, 3)).toBe(0);
    expect(await gcra(key, t0 + 1000, 1000, 3)).toBe(1000);
    expect(await gcra(key, t0 + 2500, 1000, 3)).toBe(0);
  });

  it("an idle key recovers its full burst", async () => {
    const key = `idle-${Date.now()}`;
    const t0 = 2_000_000_000;
    for (let i = 0; i < 3; i++) await gcra(key, t0, 1000, 3);
    for (let i = 0; i < 3; i++) expect(await gcra(key, t0 + 10_000, 1000, 3)).toBe(0);
  });

  it("CGNAT: 1,000 phones behind one IP connecting over 10 minutes are never blocked", async () => {
    const key = `cgnat-${Date.now()}`;
    const { windowMs, limit, burst } = STANDARD.upgrade_ip;
    const t0 = 3_000_000_000;
    let blocked = 0;
    // 1,000 connections spread evenly over 10 minutes (1.67/s, under the 2/s steady rate).
    for (let i = 0; i < 1000; i++) {
      if ((await gcra(key, t0 + i * 600, windowMs / limit, burst)) > 0) blocked++;
    }
    expect(blocked).toBe(0);
  });
});
