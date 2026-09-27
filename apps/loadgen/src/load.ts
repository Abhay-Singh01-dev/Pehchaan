// A load run (spec 21.4): worker threads hold the idle sockets; the main thread runs checks between dedicated
// pairs at a fixed rate and records their latencies; a watcher records every period in which some sockets were
// disconnected (a deploy, a killed container) and how long it took until all of them were back.
import { Worker } from "node:worker_threads";
import type { Endpoint } from "@pehchaan/canary/client";
import { Pair, type CheckResult } from "./check";
import { newSession } from "./fleet";
import { Samples } from "./stats";

export interface Outage {
  /** When the first socket dropped (ms since the run started). */
  at: number;
  /** How long until every socket was logged in again; null while still recovering. */
  ms: number | null;
  /** The fewest sockets logged in during the outage. */
  lowest: number;
}

interface WorkerCount {
  ready: number;
  logins: number;
  total: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Load {
  readonly latency = { accepted: new Samples(), routed: new Samples(), roundTrip: new Samples() };
  readonly checks = { started: 0, passed: 0, failed: 0, errors: [] as string[] };
  readonly outages: Outage[] = [];
  private readonly t0 = Date.now();
  private workers: Worker[] = [];
  private counts: WorkerCount[] = [];
  private pairs: Pair[] = [];
  private next = 0;
  private inflight = new Set<Promise<void>>();
  private checkTimer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private watching = false;

  private constructor() {}

  /** Starts `workers` holder threads and `pairs` check pairs (logged in before this resolves). */
  static async start(ep: Endpoint, o: { workers: number; pairs: number }): Promise<Load> {
    const load = new Load();
    for (let i = 0; i < o.workers; i++) {
      const w = new Worker(new URL("./holder.ts", import.meta.url), { workerData: ep, execArgv: ["--import", "tsx"] });
      load.counts.push({ ready: 0, logins: 0, total: 0 });
      w.on("message", (c: WorkerCount) => (load.counts[i] = c));
      load.workers.push(w);
    }
    for (let i = 0; i < o.pairs; i++) {
      const [a, b] = await Promise.all([newSession(ep), newSession(ep)]);
      load.pairs.push(new Pair(a, b));
    }
    await Promise.all(load.pairs.flatMap((p) => [p.asker.start(), p.answerer.start()]));
    load.watchTimer = setInterval(() => load.watch(), 250);
    return load;
  }

  /** Adds idle sockets, spread over the workers, at `perSec` in total. */
  grow(count: number, perSec: number): void {
    const n = this.workers.length;
    this.workers.forEach((w, i) => {
      const share = Math.floor(count / n) + (i < count % n ? 1 : 0);
      if (share > 0) w.postMessage({ grow: { count: share, perSec: perSec / n } });
    });
  }

  /** Every socket, including the check pairs. */
  get total(): number {
    return this.counts.reduce((s, c) => s + c.total, 0) + this.pairs.length * 2;
  }

  get ready(): number {
    let pairsReady = 0;
    for (const p of this.pairs) pairsReady += Number(p.asker.ready) + Number(p.answerer.ready);
    return this.counts.reduce((s, c) => s + c.ready, 0) + pairsReady;
  }

  /** Logins beyond the first one per socket: how many reconnections happened. */
  get relogins(): number {
    let pairLogins = 0;
    for (const p of this.pairs) pairLogins += p.asker.logins + p.answerer.logins;
    return this.counts.reduce((s, c) => s + c.logins, 0) + pairLogins - this.total;
  }

  /** Waits until `target` sockets are logged in. False on timeout. */
  async waitReady(target: number, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (this.total >= target && this.ready >= target) return true;
      await sleep(250);
    }
    return false;
  }

  /** From now on, any drop in logged-in sockets is recorded as an outage. */
  watchOutages(): void {
    this.watching = true;
  }

  startChecks(perSec: number): void {
    this.checkTimer = setInterval(() => this.runOne(), 1000 / perSec);
  }

  /** Stops starting checks and waits for the ones in flight (each ends within its 60 s). */
  async stopChecks(): Promise<void> {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    await Promise.all([...this.inflight]);
  }

  /** Checks and routing latency for the window since the last call (the capacity ramp's steps). */
  window(): { routed: ReturnType<Samples["summary"]>; failed: number } {
    return { routed: this.latency.routed.summary(true), failed: this.checks.failed };
  }

  async stop(): Promise<void> {
    if (this.watchTimer) clearInterval(this.watchTimer);
    await this.stopChecks();
    for (const p of this.pairs) {
      p.asker.stop();
      p.answerer.stop();
    }
    for (const w of this.workers) w.postMessage({ stop: true });
    await Promise.all(this.workers.map((w) => new Promise((r) => w.once("exit", r))));
  }

  get elapsedMs(): number {
    return Date.now() - this.t0;
  }

  private runOne(): void {
    const pair = this.pairs[this.next++ % this.pairs.length]!;
    this.checks.started++;
    const p = pair
      .check()
      .catch((e: Error): CheckResult => ({
        ok: false,
        acceptedMs: -1,
        routedMs: -1,
        roundTripMs: -1,
        error: e.message,
      }))
      .then((r) => {
        if (r.ok) {
          this.checks.passed++;
          this.latency.accepted.add(r.acceptedMs);
          this.latency.routed.add(r.routedMs);
          this.latency.roundTrip.add(r.roundTripMs);
        } else {
          this.checks.failed++;
          if (this.checks.errors.length < 20) this.checks.errors.push(r.error ?? "failed");
        }
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  private watch(): void {
    if (!this.watching) return;
    const total = this.total;
    const ready = this.ready;
    const open = this.outages.at(-1);
    if (ready < total) {
      if (!open || open.ms !== null) this.outages.push({ at: this.elapsedMs, ms: null, lowest: ready });
      else open.lowest = Math.min(open.lowest, ready);
    } else if (open && open.ms === null) {
      open.ms = this.elapsedMs - open.at;
    }
  }
}
