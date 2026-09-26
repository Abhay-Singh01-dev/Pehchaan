// Checks the performance budget (spec B15): the family app's initial JavaScript — the entry
// script plus every chunk index.html preloads — must be under 250 KB gzipped.
// Run after a build: npm run budget
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const html = readFileSync(join(dist, "index.html"), "utf8");
const files = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
].map((m) => m[1].replace(/^\//, ""));

const LIMIT = 250 * 1024;
let total = 0;
for (const f of [...new Set(files)]) {
  const gz = gzipSync(readFileSync(join(dist, f))).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total initial JS (gzipped), budget 250 KB`);
process.exit(total > LIMIT ? 1 : 0);
