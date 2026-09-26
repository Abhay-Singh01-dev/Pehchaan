// Prometheus metrics (spec 19.1), served on METRICS_PORT and scraped by Grafana Alloy.
// Labels are low-cardinality only: never a device ID, request ID or IP (18.11, REL-23).
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const MS_BUCKETS = [5, 10, 25, 50, 100, 150, 250, 500, 800, 1000, 2500, 5000, 10000];

export function createMetrics() {
  const registry = new Registry();
  // Node defaults under their standard names (event-loop lag, heap, GC, CPU), so stock dashboards work.
  collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });

  const m = {
    registry,
    wsConnections: new Gauge({
      name: "pehchaan_ws_connections",
      help: "Open WebSockets",
      labelNames: ["platform"],
      registers: [registry],
    }),
    wsAuth: new Counter({
      name: "pehchaan_ws_auth_total",
      help: "Login results",
      labelNames: ["result"],
      registers: [registry],
    }),
    messages: new Counter({
      name: "pehchaan_messages_total",
      help: "Messages by type, kind and result",
      labelNames: ["t", "kind", "result"],
      registers: [registry],
    }),
    routeLatency: new Histogram({
      name: "pehchaan_route_latency_ms",
      help: "accepted → written to the recipient's socket",
      buckets: MS_BUCKETS,
      registers: [registry],
    }),
    receipts: new Counter({
      name: "pehchaan_receipts_total",
      help: "Receipts sent, by state",
      labelNames: ["state"],
      registers: [registry],
    }),
    push: new Counter({
      name: "pehchaan_push_total",
      help: "Web Push sends",
      labelNames: ["service", "result"],
      registers: [registry],
    }),
    pushLatency: new Histogram({
      name: "pehchaan_push_latency_ms",
      help: "Push service response time",
      labelNames: ["service"],
      buckets: MS_BUCKETS,
      registers: [registry],
    }),
    requests: new Counter({
      name: "pehchaan_requests_total",
      help: "Request outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    answerTime: new Histogram({
      name: "pehchaan_answer_time_ms",
      help: "request accepted → answer accepted (the human part)",
      buckets: [1000, 2000, 5000, 10000, 20000, 30000, 45000, 60000, 90000],
      registers: [registry],
    }),
    rateLimited: new Counter({
      name: "pehchaan_rate_limited_total",
      help: "Refused by a rate limit",
      labelNames: ["scope"],
      registers: [registry],
    }),
    inboxPut: new Counter({
      name: "pehchaan_inbox_put_total",
      help: "Frames stored in an inbox",
      registers: [registry],
    }),
    inboxFull: new Counter({
      name: "pehchaan_inbox_full_total",
      help: "Inbox puts refused because the inbox was full",
      registers: [registry],
    }),
    redisLatency: new Histogram({
      name: "pehchaan_redis_latency_ms",
      help: "Valkey command latency",
      labelNames: ["op"],
      buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250],
      registers: [registry],
    }),
    pgLatency: new Histogram({
      name: "pehchaan_pg_latency_ms",
      help: "Postgres query latency",
      labelNames: ["op"],
      buckets: [1, 2, 5, 10, 25, 50, 100, 250, 1000],
      registers: [registry],
    }),
    labAttacks: new Counter({
      name: "pehchaan_lab_attacks_total",
      help: "Security Lab attacks by type and verdict",
      labelNames: ["attack", "verdict"],
      registers: [registry],
    }),
    labFalseGreens: new Counter({
      name: "pehchaan_lab_false_greens_total",
      help: "Lab attacks that produced VERIFIED. Must always be 0.",
      registers: [registry],
    }),
  };
  return m;
}

export type Metrics = ReturnType<typeof createMetrics>;

/** Times an async operation into a millisecond latency histogram (prom-client's startTimer measures seconds). */
export async function timed<T>(h: Histogram<string>, op: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    h.observe({ op }, performance.now() - t0);
  }
}
