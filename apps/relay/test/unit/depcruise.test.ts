// Phase 1: dependency-cruiser enforces the section 4 boundaries. A fixture that imports the verifier from
// the relay must make it fail; the real source tree must pass.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const bin = join(repo, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs");

function cruise(paths: string[], extraArgs: string[] = []): { ok: boolean; out: string } {
  try {
    const out = execFileSync(process.execPath, [bin, ...paths, "--config", ".dependency-cruiser.cjs", ...extraArgs], {
      cwd: repo,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("code boundaries (depcruise)", () => {
  it("fails when the relay imports packages/crypto/verifier", () => {
    // The fixtures folder is excluded from normal runs; lift the exclusion for this one file.
    const r = cruise(["apps/relay/test/fixtures/depcruise/forbidden.ts"], ["--exclude", "^$"]);
    expect(r.ok).toBe(false);
    expect(r.out).toContain("relay-no-verifier-or-e2e");
  }, 60_000);
});
