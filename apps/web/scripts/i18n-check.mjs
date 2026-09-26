// i18n checks (spec Phase 9 #3):
//   1. en.json and hi.json have the same keys (Hindi may add _m/_f gender variants).
//   2. Every literal key used in the code (t("…"), g("…"), i18nKey) exists in both files.
//   3. Dynamic keys (t(`relation.${r}`)) must point at an existing group.
// Run with: npm run i18n   (exits 1 on any problem)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const en = JSON.parse(readFileSync(join(root, "src/i18n/en.json"), "utf8"));
const hi = JSON.parse(readFileSync(join(root, "src/i18n/hi.json"), "utf8"));

const flatten = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
const enKeys = new Set(flatten(en).filter((k) => !k.startsWith("_")));
const hiKeys = new Set(flatten(hi).filter((k) => !k.startsWith("_")));
const base = (k) => k.replace(/_(m|f|one|other|zero|few|many|two)$/, "");
const enBase = new Set([...enKeys].map(base));
const hiBase = new Set([...hiKeys].map(base));

const problems = [];
for (const k of enBase) if (!hiBase.has(k)) problems.push(`missing in hi.json: ${k}`);
for (const k of hiBase) if (!enBase.has(k)) problems.push(`missing in en.json: ${k}`);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(f)) files.push(p);
  }
};
walk(join(root, "src"));

const has = (k) => enBase.has(k) || [...enKeys].some((x) => x.startsWith(k + "_"));
const isGroup = (prefix) => [...enKeys].some((x) => x.startsWith(prefix));
let used = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\b(?:t|g)\(\s*"([a-zA-Z0-9_.]+)"/g)) {
    used++;
    if (!has(m[1])) problems.push(`${f.replace(root, "")}: unknown key "${m[1]}"`);
  }
  for (const m of src.matchAll(/\b(?:t|g)\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
    if (!isGroup(m[1] + ".")) problems.push(`${f.replace(root, "")}: unknown key group "${m[1]}.*"`);
  }
}

console.log(`${enBase.size} keys in en.json, ${hiBase.size} in hi.json, ${used} literal uses checked.`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("i18n OK");
