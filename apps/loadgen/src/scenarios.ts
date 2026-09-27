// The load scenarios (spec 21.4). Each prints JSON lines (`event`: holding, progress, step, report) and returns
// whether it passed.
//   hold      N sockets logged in, checks at a fixed rate, for a time (or until "stop" on stdin). Used for the
//             rolling-deploy test (OPS-03), the reconnect storm (LOAD-02) and the soak (LOAD-03).
//   capacity  adds sockets step by step while running checks; the capacity is the last step whose p95 routing
//             latency stayed under the limit (LOAD-01). MAX_SOCKETS is then set at about 75% of the breaking point.
import type { Endpoint } from "@pehchaan/canary/client";
import { Load } from "./load";

export const emit = (event: string, data: object) => console.log(JSON.stringify({ event, ...data }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface HoldOptions {
  sockets: number;
  pairs: number;
  checksPerSec: number;
  rampPerSec: number;
  workers: number;
  /** 0: until a line "stop" arrives on stdin (or stdin closes). */
  durationSec: number;
  /** Largest acceptable share of failed checks (0 for a deploy: zero failures). */
  maxErrorRate: number;
  /** Longest acceptable time for every socket to be back after a drop (LOAD-02: 30 s); 0 = no limit. */
  maxRecoverMs: number;
}

async function stopSignal(durationSec: number): Promise<void> {
  if (durationSec > 0) return void (await sleep(durationSec * 1000));
  return new Promise<void>((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d: string) => d.includes("stop") && resolve());
    process.stdin.on("end", () => resolve());
  });
}

export async function hold(ep: Endpoint, o: HoldOptions): Promise<boolean> {
  const load = await Load.start(ep, { workers: o.workers, pairs: o.pairs });
  const progress = setInterval(
    () =>
      emit("progress", {
        s: Math.round(load.elapsedMs / 1000),
        ready: load.ready,
        total: load.total,
        checks: load.checks,
      }),
    5000,
  );
  try {
    load.grow(o.sockets - o.pairs * 2, o.rampPerSec);
    const rampMs = (o.sockets / o.rampPerSec) * 1000 + 60_000;
    if (!(await load.waitReady(o.sockets, rampMs))) {
      emit("report", { ok: false, error: `only ${load.ready} of ${o.sockets} sockets logged in` });
      return false;
    }
    emit("holding", { sockets: load.ready, afterMs: load.elapsedMs });
    load.watchOutages();
    load.startChecks(o.checksPerSec);
    await stopSignal(o.durationSec);
    await load.stopChecks();
    // Every socket must be back (a deploy or a kill may have just happened).
    const allBack = await load.waitReady(o.sockets, 60_000);
    const c = load.checks;
    const errorRate = c.started === 0 ? 0 : c.failed / c.started;
    const worstRecovery = Math.max(0, ...load.outages.map((x) => x.ms ?? Infinity));
    const problems = [
      ...(c.started === 0 ? ["no checks ran"] : []),
      ...(errorRate > o.maxErrorRate ? [`${c.failed} of ${c.started} checks failed`] : []),
      ...(allBack ? [] : [`only ${load.ready} of ${o.sockets} sockets came back`]),
      ...(o.maxRecoverMs > 0 && worstRecovery > o.maxRecoverMs
        ? [`sockets took ${worstRecovery} ms to come back (limit ${o.maxRecoverMs})`]
        : []),
    ];
    emit("report", {
      ok: problems.length === 0,
      problems,
      sockets: { target: o.sockets, ready: load.ready, relogins: load.relogins },
      checks: c,
      errorRate,
      latencyMs: {
        accepted: load.latency.accepted.summary(),
        routed: load.latency.routed.summary(),
        roundTrip: load.latency.roundTrip.summary(),
      },
      outages: load.outages,
      memory: { loadgenRssMb: Math.round(process.memoryUsage().rss / 1e6) },
    });
    return problems.length === 0;
  } finally {
    clearInterval(progress);
    await load.stop();
  }
}

export interface CapacityOptions {
  start: number;
  step: number;
  max: number;
  stepSec: number;
  checksPerSec: number;
  rampPerSec: number;
  workers: number;
  pairs: number;
  /** 21.4: p95 routing latency must stay below 150 ms. */
  limitMs: number;
}

export async function capacity(ep: Endpoint, o: CapacityOptions): Promise<boolean> {
  const load = await Load.start(ep, { workers: o.workers, pairs: o.pairs });
  const steps: Array<{ sockets: number; p95: number; checks: number; failed: number }> = [];
  let capacityAt = 0;
  let brokeAt: number | null = null;
  let reason = "reached the configured maximum";
  try {
    load.startChecks(o.checksPerSec);
    for (let target = o.start; target <= o.max; target += o.step) {
      load.grow(target - load.total, o.rampPerSec);
      const rampMs = ((target - load.total) / o.rampPerSec) * 1000 + 30_000;
      if (!(await load.waitReady(target, Math.max(rampMs, 30_000)))) {
        brokeAt = target;
        reason = `the relay stopped accepting sockets (${load.ready} of ${target} logged in)`;
        break;
      }
      load.window(); // start this step's window only once every socket is in
      const failedBefore = load.checks.failed;
      await sleep(o.stepSec * 1000);
      const w = load.window();
      const step = { sockets: target, p95: w.routed.p95, checks: w.routed.count, failed: w.failed - failedBefore };
      steps.push(step);
      emit("step", step);
      if (step.p95 >= o.limitMs || step.failed > 0) {
        brokeAt = target;
        reason = step.failed > 0 ? `${step.failed} checks failed` : `p95 routing ${step.p95} ms`;
        break;
      }
      capacityAt = target;
    }
    const breaking = brokeAt ?? capacityAt;
    emit("report", {
      ok: capacityAt > 0,
      capacity: capacityAt,
      brokeAt,
      reason,
      recommendedMaxSockets: Math.floor((breaking * 0.75) / 100) * 100,
      limitMs: o.limitMs,
      steps,
    });
    return capacityAt > 0;
  } finally {
    await load.stop();
  }
}
