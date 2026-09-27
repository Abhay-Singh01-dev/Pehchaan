// pnpm test:security: the security tests SEC-01 … SEC-12 (spec 21.7, Part E group SEC) in one command.
// Needs Valkey and Postgres (pnpm db:up) and Docker (gitleaks and Trivy run as pinned images).
// Every step runs even if an earlier one fails; the summary lists each, and the exit code is 1 if any failed.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GITLEAKS = "zricethezav/gitleaks:v8.30.1";
const TRIVY = "aquasec/trivy:0.74.0";

// Trivy only needs the lockfile; scanning a copy avoids crawling node_modules through a Docker mount.
const lockDir = mkdtempSync(join(tmpdir(), "pehchaan-trivy-"));
copyFileSync(join(ROOT, "pnpm-lock.yaml"), join(lockDir, "pnpm-lock.yaml"));

const relayTests = [
  "fuzz.int.test.ts", // SEC-01 live
  "login.int.test.ts", // SEC-02 replayed login
  "requests.int.test.ts", // SEC-03 answer from a non-target
  "contacts.int.test.ts", // SEC-04 binding bypass
  "upgrade.int.test.ts", // SEC-06 oversized and binary frames, SEC-07 slowloris
  "push.int.test.ts", // SEC-08 SSRF subscriptions
  "lab.int.test.ts", // SEC-09 the Lab never touches real traffic
  "data.int.test.ts", // SEC-12 presence never reveals strangers
  "e2e-required.int.test.ts", // REL-18 readable envelopes refused
  "log-leak.int.test.ts", // REL-22 no personal data in logs
].map((f) => `test/${f}`);

const steps = [
  ["SEC-01 · parser fuzzing", "pnpm", ["--filter", "@pehchaan/protocol", "exec", "vitest", "run", "test/fuzz.test.ts"]],
  [
    "SEC-01 (live), 02, 03, 04, 06, 07, 08, 09, 12 · relay against real Valkey and Postgres",
    "pnpm",
    ["--filter", "@pehchaan/relay", "exec", "vitest", "run", "-c", "vitest.integration.config.ts", ...relayTests],
  ],
  [
    "SEC-05 · a downgraded (readable) envelope is refused by the app",
    "pnpm",
    [
      "--filter",
      "@pehchaan/web",
      "exec",
      "vitest",
      "run",
      "tests/unit/envelope.test.ts",
      "tests/unit/real-relay.test.ts",
    ],
  ],
  [
    "SEC-10 · gitleaks: no secrets in the repository's history",
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${ROOT}:/repo`,
      GITLEAKS,
      "git",
      "--no-banner",
      "--redact",
      "--config",
      "/repo/.gitleaks.toml",
      "/repo",
    ],
  ],
  ["SEC-11 · pnpm audit: no high or critical advisories", "pnpm", ["audit", "--audit-level", "high"]],
  [
    "SEC-11 · Trivy: no high or critical vulnerabilities (runtime and dev dependencies)",
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${lockDir}:/scan`,
      TRIVY,
      "fs",
      "--scanners",
      "vuln",
      "--severity",
      "HIGH,CRITICAL",
      "--include-dev-deps",
      "--no-progress",
      "--exit-code",
      "1",
      "/scan",
    ],
  ],
];

/** Windows runs pnpm through a shell (pnpm.cmd): pass one quoted command line there, never an argument list. */
const quote = (a) => (/^[\w@./:=,+-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const run = (cmd, args) =>
  process.platform === "win32"
    ? spawnSync([cmd, ...args].map(quote).join(" "), { cwd: ROOT, stdio: "inherit", shell: true })
    : spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

const results = [];
for (const [name, cmd, args] of steps) {
  console.log(`\n── ${name}`);
  results.push([name, run(cmd, args).status === 0]);
}

console.log("\nSecurity tests (SEC-01 … SEC-12):");
for (const [name, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
