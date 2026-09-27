// Phase 9: REL-23 (spec 19.1, 18.11). After a real request → answer flow, /metrics on the metrics port exposes every
// metric of the 19.1 table with samples, plus Node's defaults, and no label ever carries a device ID (or its HMAC).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("metrics");
});
afterAll(() => env.cleanup());

const METRICS_19_1 = [
  "pehchaan_ws_connections",
  "pehchaan_ws_auth_total",
  "pehchaan_messages_total",
  "pehchaan_route_latency_ms",
  "pehchaan_receipts_total",
  "pehchaan_push_total",
  "pehchaan_push_latency_ms",
  "pehchaan_requests_total",
  "pehchaan_answer_time_ms",
  "pehchaan_rate_limited_total",
  "pehchaan_inbox_put_total",
  "pehchaan_inbox_full_total",
  "pehchaan_redis_latency_ms",
  "pehchaan_pg_latency_ms",
  "pehchaan_lab_attacks_total",
  "pehchaan_lab_false_greens_total",
];

describe("REL-23 · /metrics", () => {
  it("exposes every 19.1 metric, records the flow's timings, and never labels by device", async () => {
    const relay = env.relays[0]!;
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const m = await maa.login(relay);
    const a = await arjun.login(relay);
    const r = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", r.body, r.id);
    await a.type("deliver", (f) => f.body.re === r.id);
    const ans = await arjun.plainSend("verify.answer", maa, { re: r.id });
    a.send("send", ans.body, ans.id);
    await m.type("deliver", (f) => f.body.kind === "verify.answer" && f.body.re === r.id);

    const text = await (await fetch(`http://127.0.0.1:${relay.metricsPort}/metrics`)).text();
    for (const name of METRICS_19_1) expect(text, name).toContain(`# TYPE ${name} `);
    // The flow's own timings were measured.
    for (const h of [
      "pehchaan_answer_time_ms",
      "pehchaan_route_latency_ms",
      "pehchaan_redis_latency_ms",
      "pehchaan_pg_latency_ms",
    ]) {
      const count = Number(text.match(new RegExp(`^${h}_count(?:\\{[^}]*\\})? (\\d+)`, "m"))?.[1] ?? 0);
      expect(count, h).toBeGreaterThan(0);
    }
    // Node's defaults (event-loop lag, heap, GC, CPU).
    for (const d of ["nodejs_eventloop_lag_seconds", "nodejs_heap_size_used_bytes", "process_cpu_seconds_total"]) {
      expect(text, d).toContain(d);
    }
    // No device ID, in any form, as a label value (cardinality and privacy, 18.11).
    for (const id of [maa.deviceId, arjun.deviceId]) {
      expect(text).not.toContain(id);
      expect(text).not.toContain(relay.hub.hmac(id));
    }
  });
});
