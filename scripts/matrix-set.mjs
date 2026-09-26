// Sets the test column (and marks ✅) for TEST_MATRIX.md rows: node scripts/matrix-set.mjs rows.json
// rows.json: { "REL-01": "relay/upgrade.int.test.ts › REL-01 · accepting a WebSocket", … }
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../docs/TEST_MATRIX.md", import.meta.url);
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
let n = 0;
const out = readFileSync(path, "utf8")
  .split("\n")
  .map((line) => {
    const cells = line.split("|");
    const id = cells[1]?.trim();
    if (!id || !(id in rows)) return line;
    n++;
    // | ID | spec | rule | test | type | phase | status |  → cells[4] is the test, the last cell before "" is status
    cells[4] = ` ${rows[id]} `;
    cells[cells.length - 2] = " ✅ ";
    return cells.join("|");
  })
  .join("\n");
writeFileSync(path, out);
console.log(`updated ${n} of ${Object.keys(rows).length} rows`);
