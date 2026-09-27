// LOAD-01 … LOAD-03 (spec 21.4), shortened, against the production stack on this machine with each relay container
// limited to 1 CPU (a compose override: the laptop is faster than the VM's single OCPU). apps/loadgen runs as a
// separate process. The final MAX_SOCKETS number and the 12-hour soak come from staging once it is live; these runs
// prove the scenarios and give a local number for the report.
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildImages } from "../ops/lib/images";
import { LoadRun } from "../ops/lib/loadrun";
import { docker, ok, sleep } from "../ops/lib/sh";
import {
  ageKeyPair,
  caddyRoot,
  compose,
  containerOf,
  deploy,
  destroyStack,
  ORIGIN,
  RELAY_URL,
  SERVICES,
  STACK_DIR,
  stackEnv,
  TAG_A,
  waitHealthy,
  writeStack,
} from "../ops/lib/stack";

const OVERRIDE = `# Load tests only (tests/load): one CPU per relay container, like the VM's single OCPU.
services:
  relay-a: { cpus: 1 }
  relay-b: { cpus: 1 }
`;

let env: Record<string, string>;
const loadgen = (args: string[]) => LoadRun.start(args, env);

/** Resident memory of a container in MB (docker stats). */
async function memoryMb(svc: string): Promise<number> {
  const out = await ok("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}}", await containerOf(svc)]);
  const m = /([\d.]+)\s*(KiB|MiB|GiB)/.exec(out);
  if (!m) throw new Error(`unreadable docker stats: ${out}`);
  return Number(m[1]) * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024 } as const)[m[2] as "KiB" | "MiB" | "GiB"];
}

/** Every run's measured numbers, one JSON line per scenario (vitest hides console output of passing tests). */
const RESULTS = join(tmpdir(), "pehchaan-load-results.jsonl");
const record = (id: string, data: unknown) => {
  console.log(`${id} ${JSON.stringify(data)}`);
  appendFileSync(RESULTS, JSON.stringify({ id, at: new Date().toISOString(), data }) + "\n");
};

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

beforeAll(async () => {
  await buildImages();
  const age = await ageKeyPair();
  await destroyStack().catch(() => {});
  writeStack(await stackEnv(age.recipient), { "compose.override.yml": OVERRIDE });
  await deploy(TAG_A);
  await waitHealthy(SERVICES, 120_000);
  const caFile = join(STACK_DIR, "caddy-root.crt");
  writeFileSync(caFile, await caddyRoot());
  env = { LOADGEN_RELAY_URL: RELAY_URL, LOADGEN_ORIGIN: ORIGIN, LOADGEN_CA_FILE: caFile };
});

afterAll(async () => {
  await destroyStack();
});

describe("LOAD-01 · capacity of one relay container (1 CPU) at p95 routing < 150 ms", () => {
  it("ramps sockets in steps with 5 checks/s and reports where p95 crosses 150 ms", async () => {
    await compose(["stop", "relay-b"]); // every socket on relay-a: the number is per container
    try {
      const run = loadgen([
        "capacity",
        ...["--start", "500", "--step", "500", "--max", "1500", "--step-sec", "20", "--rate", "5", "--workers", "4"],
      ]);
      const { report } = await run.finish();
      record("LOAD-01", report);
      const r = report as unknown as {
        capacity: number;
        steps: Array<{ sockets: number; p95: number; failed: number }>;
      };
      expect(r.steps.length).toBeGreaterThan(0);
      // Docker Desktop's port forwarding from Windows into containers stops at about 2,000 connections (every run hit
      // exactly 1,973), so on a laptop this proves p95 < 150 ms up to 1,500 sockets: a lower bound. The real number
      // per container, and MAX_SOCKETS, come from LOAD-01 on staging (21.4, D-071).
      expect(r.capacity).toBe(1500);
      for (const s of r.steps) expect(s.p95).toBeLessThan(150);
    } finally {
      await compose(["start", "relay-b"]);
      await waitHealthy(["relay-b"], 90_000);
    }
  });
});

describe("LOAD-02 · reconnect storm: one relay container killed under load", () => {
  it("every socket is back within 30 s and fewer than 1% of checks fail", async () => {
    const run = loadgen(
      ["hold", "--sockets", "1500", "--rate", "5", "--pairs", "20", "--duration", "0"].concat([
        "--max-error-rate",
        "0.01",
        "--max-recover-ms",
        "30000",
      ]),
    );
    await run.waitFor("holding", 5 * 60_000);
    await sleep(10_000);
    await docker(["kill", await containerOf("relay-a")]);
    await sleep(45_000);
    const { code, report } = await run.stop();
    record("LOAD-02", { ...report, latencyMs: undefined });
    await compose(["start", "relay-a"]);
    await waitHealthy(["relay-a"], 90_000);
    const outages = report.outages as Array<{ ms: number | null; lowest: number }>;
    expect(outages.length).toBeGreaterThan(0); // the kill really dropped sockets
    expect(Math.max(...outages.map((o) => o.ms ?? Infinity))).toBeLessThanOrEqual(30_000);
    expect(report.problems).toEqual([]);
    expect(code).toBe(0);
  });
});

describe("LOAD-03 · soak (shortened): no memory growth", () => {
  it("holds 1,500 sockets with 5 checks/s for 8 minutes: zero failures, relay memory flat", async () => {
    const run = loadgen(["hold", "--sockets", "1500", "--rate", "5", "--pairs", "20", "--duration", "480"]);
    await run.waitFor("holding", 5 * 60_000);
    await sleep(60_000); // warm-up: caches, JIT, socket buffers
    const samples: Array<{ a: number; b: number }> = [];
    for (let i = 0; i < 12; i++) {
      samples.push({ a: await memoryMb("relay-a"), b: await memoryMb("relay-b") });
      await sleep(30_000);
    }
    const { code, report } = await run.finish();
    const third = Math.floor(samples.length / 3);
    const growth = (k: "a" | "b") =>
      median(samples.slice(-third).map((s) => s[k])) / median(samples.slice(0, third).map((s) => s[k]));
    record("LOAD-03", { samples, growthA: growth("a"), growthB: growth("b"), checks: report.checks });
    expect(report.problems).toEqual([]);
    expect(code).toBe(0);
    expect(growth("a")).toBeLessThan(1.15);
    expect(growth("b")).toBeLessThan(1.15);
  });
});
