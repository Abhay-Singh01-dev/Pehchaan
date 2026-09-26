// infra/scripts/lab-password-hash.ts (spec 14.1 layer 2, 18.7): the Argon2id hash the relay checks Lab
// passwords against. The password is piped on stdin here, as it would be typed at the hidden prompt.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { argon2Verify } from "hash-wasm";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const run = (input: string) =>
  spawnSync(process.execPath, ["--import", "tsx", "infra/scripts/lab-password-hash.ts"], {
    cwd: ROOT,
    input,
    encoding: "utf8",
  });

describe("lab-password-hash", () => {
  it("prints only an Argon2id hash that verifies the password, and nothing else", async () => {
    const r = run("judging session 2026\n");
    expect(r.status).toBe(0);
    const hash = r.stdout.trim();
    expect(hash.split("\n")).toHaveLength(1);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await argon2Verify({ password: "judging session 2026", hash })).toBe(true);
    expect(await argon2Verify({ password: "judging session 2027", hash })).toBe(false);
    // The password itself is never printed.
    expect(r.stdout + r.stderr).not.toContain("judging session 2026");
  });

  it("uses a new salt every time", () => {
    expect(run("same password here\n").stdout).not.toBe(run("same password here\n").stdout);
  });

  it("refuses a password shorter than 12 characters", () => {
    const r = run("short\n");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });
});
