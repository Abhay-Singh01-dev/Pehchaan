// Banned-words check (CLAUDE.md "Never"; Part E APP-11).
//
// Rule 1, everywhere: no word or phrase from scripts/banned-words.txt may appear in code, UI text or docs.
//   Whole words, case-insensitive. Skipped: node_modules, build output, test files, binary files, the
//   list itself, and the two vendored specifications (docs/BACKEND_SPEC.md, docs/FRONTEND_SPEC.md), which
//   quote the words only to forbid them (see docs/DECISIONS.md D-004).
// Rule 2, family screens only (frontend spec lines 785 and 1708): "demo", "mock", "test", "sample" and
//   "safe" never appear in family-screen text. The Security Lab, Call Guard, Diagnostics and the
//   simulation panel are exempt (they are test tools). Two sentences dictated word for word by the
//   frontend spec are allowed (lines 833/1155 and 1521).
//
// Usage: node scripts/check-banned-words.mjs   (exits 1 and lists every hit)
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST = join(root, "scripts", "banned-words.txt");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dev-dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".turbo",
  ".git",
  ".vite",
  ".venv",
  "frontend",
  "tests",
  "test",
  "__tests__",
  "__fixtures__",
]);
const SKIP_FILES = new Set([
  "scripts/banned-words.txt",
  "scripts/check-banned-words.mjs", // names the family-screen words in order to find them
  "docs/BACKEND_SPEC.md",
  "docs/FRONTEND_SPEC.md",
  "pnpm-lock.yaml",
  "Pehchaan_Backend_Specification.md",
  "Pehchaan_Frontend_Build_Prompt.md",
]);
const TEXT_EXT =
  /\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|yml|yaml|html|css|lua|sql|sh|txt|alloy|toml|Caddyfile|example)$/i;
const TEST_FILE = /\.(test|spec|int\.test|e2e)\.[cm]?[jt]sx?$/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "Whole word": not preceded or followed by a letter, digit, underscore or hyphen.
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(w)}(?![\\p{L}\\p{N}_-])`, "iu");

/** The repository's files: what git tracks, plus new files it would track (respecting .gitignore and the
 *  local exclude list, so personal documents in the working folder are never scanned). */
function repoFiles() {
  try {
    const out = execSync("git ls-files -co --exclude-standard", {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out
      .split("\n")
      .filter(Boolean)
      .filter((rel) => {
        const parts = rel.split("/");
        const name = parts.at(-1);
        if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false;
        return (TEXT_EXT.test(name) || name === "Caddyfile" || name.startsWith("Dockerfile")) && !TEST_FILE.test(name);
      })
      .map((rel) => join(root, rel));
  } catch {
    return listFiles(root);
  }
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) listFiles(p, out);
    } else if (
      (TEXT_EXT.test(name) || name === "Caddyfile" || name === "Dockerfile" || name.startsWith("Dockerfile.")) &&
      !TEST_FILE.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
}

export function checkEverywhere(
  words = readFileSync(LIST, "utf8")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean),
) {
  const res = words.map((w) => [w, wordRe(w)]);
  const hits = [];
  for (const file of repoFiles()) {
    const rel = relative(root, file).split(sep).join("/");
    if (SKIP_FILES.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [w, re] of res) if (re.test(line)) hits.push(`${rel}:${i + 1}: "${w}"`);
    });
  }
  return hits;
}

// Family-screen rule. Namespaces that belong to the test tools are exempt.
const TOOL_NAMESPACES = ["lab", "guard", "diagnostics", "sim", "dev"];
const FAMILY_WORDS = ["demo", "mock", "test", "sample", "safe", "100% secure", "AI-powered", "hacker-proof"];
const SPEC_DICTATED = new Set(["family.inperson", "limits.closing"]); // frontend spec lines 833/1155, 1521

const flatten = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]],
  );

export function checkFamilyScreens(i18nDir = join(root, "apps", "web", "src", "i18n")) {
  const res = FAMILY_WORDS.map((w) => [w, wordRe(w)]);
  const hits = [];
  for (const lang of ["en", "hi"]) {
    const path = join(i18nDir, `${lang}.json`);
    let json;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    for (const [key, value] of flatten(json)) {
      if (TOOL_NAMESPACES.includes(key.split(".")[0])) continue;
      if (SPEC_DICTATED.has(key.replace(/_(m|f|one|other)$/, ""))) continue;
      for (const [w, re] of res) if (re.test(value)) hits.push(`${lang}.json ${key}: "${w}"`);
    }
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = [...checkEverywhere(), ...checkFamilyScreens()];
  if (hits.length) {
    console.error(`Banned words found (${hits.length}):\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log("Banned-words check OK");
}
