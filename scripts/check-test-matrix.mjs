// The final gate on docs/TEST_MATRIX.md (spec Phase 11): every row must be ✅ (a passing test) or `manual` (covered by
// a named E4 real-phone step). It fails, listing each open row, on anything else: ⏳, ❌, an empty status, a `manual`
// row that doesn't name its E4 step, or an ID that appears twice.
// Usage: node scripts/check-test-matrix.mjs [path]   (default: docs/TEST_MATRIX.md)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Row IDs: REL-07, E4-01, F-08, C-14.3a, LOAD-01… */
const ID = /^[A-Z][A-Z0-9]*-[A-Za-z0-9.]+$/;

/** Problems in a matrix (one string per open row), and how many rows it has. */
export function checkMatrix(markdown) {
  const problems = [];
  const seen = new Set();
  let rows = 0;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const id = cells[0] ?? "";
    if (!ID.test(id)) continue; // header and separator rows
    rows++;
    if (seen.has(id)) problems.push(`${id}: appears twice (duplicate ID)`);
    seen.add(id);
    const status = cells.at(-1).replaceAll("`", "");
    if (status === "✅") continue;
    if (status === "manual") {
      // E4 rows are the steps themselves; any other manual row must say which step covers it.
      if (!id.startsWith("E4-") && !cells.some((c) => /\bE4\b/.test(c))) {
        problems.push(`${id}: manual, but names no E4 step`);
      }
      continue;
    }
    problems.push(`${id}: ${status || "no status"}`);
  }
  if (rows === 0) problems.push("no rows found");
  return { rows, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? fileURLToPath(new URL("../docs/TEST_MATRIX.md", import.meta.url));
  const { rows, problems } = checkMatrix(readFileSync(path, "utf8"));
  if (problems.length > 0) {
    console.error(`TEST_MATRIX: ${problems.length} open of ${rows} rows\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`TEST_MATRIX: ${rows} rows, all ✅ or manual`);
}
