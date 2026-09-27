// scripts/check-test-matrix.mjs (spec Phase 11): the final gate fails while any row of docs/TEST_MATRIX.md is not
// ✅ or `manual`, and a `manual` row must name the E4 real-phone step that covers it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "check-test-matrix.mjs");

function check(markdown: string) {
  const file = join(mkdtempSync(join(tmpdir(), "matrix-")), "TEST_MATRIX.md");
  writeFileSync(file, markdown);
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const table = (...rows: string[]) =>
  ["| ID | Spec § | Rule | Test | Type | Phase | Status |", "|---|---|---|---|---|---|---|", ...rows].join("\n");

describe("check-test-matrix", () => {
  it("passes when every row is ✅ or manual with its E4 step", () => {
    const md = [
      "Status: ✅ passing · ⏳ planned",
      table("| REL-01 | 7.1 | rule | relay/a.test.ts | integration | 3 | ✅ |"),
      "| F-03 | Battery saver | manual: E4 step 12 | 6 | manual |",
      "| E4-01 | Install | 1 | manual |",
    ].join("\n");
    const r = check(md);
    expect(r.out).toMatch(/3 rows/);
    expect(r.code).toBe(0);
  });

  it("fails on a planned row, naming it", () => {
    const r = check(table("| OPS-03 | 18.8 | rolling deploy | ops/x.test.ts | ops | 10 | ⏳ |"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("OPS-03");
  });

  it("fails on a manual row that names no E4 step", () => {
    const r = check(table("| APP-99 | 5 | rule | someone checks it | e2e | 5 | manual |"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("APP-99");
  });

  it("fails on a duplicated ID", () => {
    const row = "| CRY-01 | 10.1 | rule | crypto/a.test.ts | unit | 2 | ✅ |";
    const r = check(table(row, row));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CRY-01.*twice|duplicate/i);
  });

  it("fails on a matrix with no rows at all (a broken file must not pass)", () => {
    expect(check("# Test matrix\n").code).toBe(1);
  });
});
