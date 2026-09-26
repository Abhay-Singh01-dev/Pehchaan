// Every migration is expand-then-contract (spec 15.2): old and new relay versions run side by side during a
// rolling deploy, and a rollback never needs a database rollback. So a migration may only ADD, unless the file
// is explicitly marked as the "contract" step of an earlier expansion:
//   -- pehchaan:contract-step (<why this is now safe>)
// Usage: node scripts/check-migrations.mjs [dir]   (exits 1 listing each destructive statement)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_MARKER = /^--\s*pehchaan:contract-step\b/m;

const DESTRUCTIVE = [
  [/\bdrop\s+(table|column|index|constraint|schema|type|view|function|trigger)\b/i, "drops something"],
  [/\balter\s+column\b[^;]*\b(type|set\s+data\s+type)\b/i, "changes a column's type"],
  [/\balter\s+column\b[^;]*\bset\s+not\s+null\b/i, "makes an existing column NOT NULL"],
  [/\brename\s+(to|column)\b/i, "renames something"],
  [/\btruncate\b/i, "empties a table"],
  [/\bdelete\s+from\b/i, "deletes rows"],
];

/** Problems in the migrations of `dir` (one string per destructive statement in an unmarked file). */
export function checkMigrations(dir = join(root, "apps", "relay", "migrations")) {
  const problems = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    if (CONTRACT_MARKER.test(sql)) continue;
    // Comments never count.
    const code = sql.replace(/--[^\n]*/g, "");
    for (const stmt of code.split(/;|-->\s*statement-breakpoint/)) {
      for (const [re, what] of DESTRUCTIVE) {
        if (re.test(stmt)) problems.push(`${relative(root, join(dir, f))}: ${what}: ${stmt.trim().split("\n")[0]}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkMigrations(process.argv[2]);
  if (problems.length) {
    console.error(
      `Destructive migration statements (mark the file "-- pehchaan:contract-step (why)" only when the ` +
        `previous release no longer uses what it removes):\n${problems.join("\n")}`,
    );
    process.exit(1);
  }
  console.log("migrations OK (expand-only)");
}
