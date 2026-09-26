// Marks TEST_MATRIX.md rows as passing: `node scripts/matrix-mark.mjs CRY-01 CRY-02 …`.
// Used at the end of a phase, after the gate is green (the check itself is scripts/check-test-matrix.mjs).
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../docs/TEST_MATRIX.md", import.meta.url);
const ids = new Set(process.argv.slice(2));
let marked = 0;
const out = readFileSync(path, "utf8")
  .split("\n")
  .map((line) => {
    const id = line.match(/^\|\s*([A-Z0-9][A-Za-z0-9.-]*)\s*\|/)?.[1];
    if (!id || !ids.has(id)) return line;
    marked++;
    return line.replace(/\|\s*(⏳|✅)\s*\|\s*$/, "| ✅ |");
  })
  .join("\n");
writeFileSync(path, out);
console.log(`marked ${marked} of ${ids.size} rows`);
