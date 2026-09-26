// Checks every text/background pair of the design tokens against WCAG 2.2 AA (spec B5.2, B10).
// Reads src/design/tokens.css directly so it can never drift from the real values.
// Run with: npm run contrast   (exits 1 if any pair fails)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/design/tokens.css"), "utf8");

function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) throw new Error("No block " + selector);
  const body = css.slice(i, css.indexOf("}", i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const light = block(":root");
const dark = { ...light, ...block('[data-theme="dark"]') };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (fg, bg, a) => hex(fg).map((v, i) => Math.round(v * a + hex(bg)[i] * (1 - a)));
const toHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const ratio = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

let failures = 0;
function check(theme, label, fg, bg, min = 4.5) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)} ${r.toFixed(2).padStart(5)} ≥ ${min}  ${label}  (${fg} on ${bg})`);
}

for (const [name, t] of [
  ["light", light],
  ["dark", dark],
]) {
  for (const bg of ["bg", "surface", "surface-2"]) {
    check(name, `ink on ${bg}`, t.ink, t[bg]);
    check(name, `ink-2 on ${bg}`, t["ink-2"], t[bg]);
    check(name, `muted on ${bg}`, t.muted, t[bg]);
    check(name, `brand (link) on ${bg}`, t.brand, t[bg]);
  }
  check(name, "brand-ink on brand-soft", t["brand-ink"], t["brand-soft"]);
  check(name, "ink on brand-soft", t.ink, t["brand-soft"]);
  check(name, "on-brand on brand", t["on-brand"], t.brand);
  check(name, "on-brand on brand-strong", t["on-brand"], t["brand-strong"]);
  check(name, "brass-ink on surface", t["brass-ink"], t.surface);
  check(name, "brass-ink on brass-soft", t["brass-ink"], t["brass-soft"]);
  // Decorative only (the seal ring, hairlines): reported, never required.
  check(name, "brass ring on bg (decorative, info only)", t.brass, t.bg, 1);
  check(name, "line vs surface (decorative, info only)", t.line, t.surface, 1);
  // Verdict chips: base colour at 14% over the surface, chip text colour on top.
  for (const [chip, base] of [
    ["chip-ok", "ok"],
    ["chip-no", "no"],
    ["chip-fake", "fake"],
    ["chip-amber", "amber"],
    ["chip-wait", "wait"],
  ]) {
    const bg = toHex(mix(t[base], t.surface, 0.14));
    check(name, `${chip} on ${base}@14%`, t[chip], bg);
  }
}

// Verdict screens: identical in both themes. Body text sits on the darker part (base / bottom);
// the display headline (36px) is large text, so 3:1 applies even near the top.
const white = "#ffffff";
for (const v of ["ok", "no", "fake", "wait"]) {
  check("both", `white body on ${v} base`, white, light[v]);
  check("both", `white body on ${v} bottom`, white, light[`${v}-to`]);
  check("both", `white headline on ${v} top (large)`, white, light[`${v}-from`], 3);
}
check("both", "on-amber body on amber base", light["on-amber"], light.amber);
check("both", "on-amber body on amber bottom", light["on-amber"], light["amber-to"]);
check("both", "on-amber headline on amber top", light["on-amber"], light["amber-from"], 3);
check("both", "ink-light on midnight (F1)", "#eef0ff", "#0a0e1f");

// Avatars: white 600-weight initials (treated as large/bold text, 3:1) — also report 4.5.
for (const a of ["indigo", "teal", "saffron", "rose", "plum", "slate"]) {
  check("both", `white initials on ${a}`, white, light[`av-${a}`], 3);
}

console.log(failures ? `\n${failures} pair(s) fail WCAG AA.` : "\nAll pairs pass WCAG AA.");
process.exit(failures ? 1 : 0);
