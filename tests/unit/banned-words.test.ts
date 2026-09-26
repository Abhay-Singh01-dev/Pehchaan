// scripts/check-banned-words.mjs (CLAUDE.md "Never"; Part E APP-11), run against throwaway git repositories.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "check-banned-words.mjs");
const dirs: string[] = [];

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pehchaan-bw-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

function check(dir: string) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", dir], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("check-banned-words", () => {
  it("passes a clean repository", () => {
    expect(check(repo({ "a.md": "Pehchaan checks who is calling." })).code).toBe(0);
  });

  it("finds a banned word as a whole word, case-insensitively, and names file and line", () => {
    const r = check(repo({ "docs/a.md": "line one\nThis is a Guaranteed result.\n" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/a.md:2: "guaranteed"');
  });

  it("ignores the word inside another word", () => {
    expect(check(repo({ "a.md": "demonstrate, undemocratic" })).code).toBe(0);
  });

  it("skips test files", () => {
    expect(check(repo({ "src/x.test.ts": "// a demo value" })).code).toBe(0);
  });

  it("keeps family-screen words off family screens, but not off the tool screens (D-004)", () => {
    const strings = (o: object) => JSON.stringify(o);
    const clean = repo({
      "apps/web/src/i18n/en.json": strings({ diag: { sendTestAlert: "Send test alert" }, lab: { a: "test phone" } }),
      "apps/web/src/i18n/hi.json": strings({}),
    });
    expect(check(clean).code).toBe(0);
    const dirty = repo({
      "apps/web/src/i18n/en.json": strings({ home: { hint: "a test alert" } }),
      "apps/web/src/i18n/hi.json": strings({}),
    });
    const r = check(dirty);
    expect(r.code).toBe(1);
    expect(r.out).toContain('en.json home.hint: "test"');
  });

  it("does not crash on a tracked file deleted from the working tree (regression)", () => {
    const dir = repo({ "gone.ts": "export {};\n", "kept.md": "fine\n" });
    unlinkSync(join(dir, "gone.ts"));
    writeFileSync(join(dir, "new.md"), "an unhackable claim\n");
    const r = check(dir);
    expect(r.out).not.toContain("ENOENT");
    expect(r.code).toBe(1);
    expect(r.out).toContain('new.md:1: "unhackable"');
  });
});
