// The load generator CLI (spec 21.4). Run it against staging (or the local production stack) with
// RATE_LIMIT_PROFILE=relaxed on the relay:
//   short     1,000 sockets, 2 checks/s for 60 s; zero failed checks (`pnpm test:load:short`)
//   hold      --sockets --pairs --rate --ramp --workers --duration (0 = until "stop" on stdin)
//             --max-error-rate (default 0) --max-recover-ms (default 0 = no limit)
//   capacity  --start --step --max --step-sec --rate --ramp --workers --pairs --limit-ms (default 150)
// Settings (environment): LOADGEN_RELAY_URL (wss://…/v1/ws), LOADGEN_ORIGIN (an allowed app origin),
// LOADGEN_RELAY_HOST (defaults to the URL's host), LOADGEN_CA_FILE (an extra trusted root, e.g. Caddy's local CA).
// Prints JSON lines; exits 0 when the scenario passed, 1 otherwise.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Endpoint } from "@pehchaan/canary/client";
import { capacity, emit, hold } from "./scenarios";

/** Reads and checks the endpoint settings (pure: the environment is passed in). */
export function endpointFrom(env: Record<string, string | undefined>): Endpoint {
  const url = env.LOADGEN_RELAY_URL;
  const origin = env.LOADGEN_ORIGIN;
  if (!url || !/^wss?:\/\//.test(url)) throw new Error("LOADGEN_RELAY_URL must be the relay's ws(s):// URL");
  if (!origin || !/^https?:\/\//.test(origin)) throw new Error("LOADGEN_ORIGIN must be an allowed app origin");
  return {
    url,
    origin,
    relayHost: env.LOADGEN_RELAY_HOST ?? new URL(url).host,
    ...(env.LOADGEN_CA_FILE ? { ca: readFileSync(env.LOADGEN_CA_FILE, "utf8") } : {}),
  };
}

const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: a } = parseArgs({
    args: rest,
    options: Object.fromEntries(
      [
        "sockets",
        "pairs",
        "rate",
        "ramp",
        "workers",
        "duration",
        "max-error-rate",
        "max-recover-ms",
        "start",
        "step",
        "max",
        "step-sec",
        "limit-ms",
      ].map((k) => [k, { type: "string" as const }]),
    ),
  });
  const ep = endpointFrom(process.env);
  if (cmd === "short" || cmd === "hold") {
    const short = cmd === "short";
    return (await hold(ep, {
      sockets: num(a.sockets, 1000),
      pairs: num(a.pairs, 20),
      checksPerSec: num(a.rate, 2),
      rampPerSec: num(a.ramp, 150),
      workers: num(a.workers, 2),
      durationSec: short ? num(a.duration, 60) : num(a.duration, 0),
      maxErrorRate: num(a["max-error-rate"], 0),
      maxRecoverMs: num(a["max-recover-ms"], 0),
    }))
      ? 0
      : 1;
  }
  if (cmd === "capacity") {
    return (await capacity(ep, {
      start: num(a.start, 1000),
      step: num(a.step, 1000),
      max: num(a.max, 20_000),
      stepSec: num(a["step-sec"], 30),
      checksPerSec: num(a.rate, 5),
      rampPerSec: num(a.ramp, 150),
      workers: num(a.workers, 4),
      pairs: num(a.pairs, 20),
      limitMs: num(a["limit-ms"], 150),
    }))
      ? 0
      : 1;
  }
  console.error("usage: cli.ts short | hold [options] | capacity [options]");
  return 2;
}

// Run only as a program (tests import the functions above).
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      // exitCode, not exit(): the sockets finish closing first (exiting mid-close crashes Node on Windows).
      process.exitCode = code;
      process.stdin.destroy();
    },
    (e: Error) => {
      emit("report", { ok: false, error: e.message });
      process.exitCode = 1;
      process.stdin.destroy();
    },
  );
}
