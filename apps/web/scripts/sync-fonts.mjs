// Copies the self-hosted font files Pehchaan uses from @fontsource into public/fonts.
// Run with: npm run fonts
// The @font-face rules that use them live in src/design/fonts.css.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "fonts");
mkdirSync(out, { recursive: true });

const files = [
  // Headings: Anek Latin (English) + Anek Devanagari (Hindi), 600/700
  ["anek-latin", "anek-latin-latin-600-normal.woff2"],
  ["anek-latin", "anek-latin-latin-700-normal.woff2"],
  ["anek-devanagari", "anek-devanagari-devanagari-600-normal.woff2"],
  ["anek-devanagari", "anek-devanagari-devanagari-700-normal.woff2"],
  // Body: Mukta, Latin + Devanagari, 400/500/700
  ["mukta", "mukta-latin-400-normal.woff2"],
  ["mukta", "mukta-latin-500-normal.woff2"],
  ["mukta", "mukta-latin-700-normal.woff2"],
  ["mukta", "mukta-devanagari-400-normal.woff2"],
  ["mukta", "mukta-devanagari-500-normal.woff2"],
  ["mukta", "mukta-devanagari-700-normal.woff2"],
  // Numbers, codes, timers, safety words: JetBrains Mono 500/600
  ["jetbrains-mono", "jetbrains-mono-latin-500-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-600-normal.woff2"],
];

for (const [pkg, file] of files) {
  copyFileSync(join(root, "node_modules", "@fontsource", pkg, "files", file), join(out, file));
  console.log("fonts/" + file);
}
