// Applies display preferences to <html>: theme (resolved from "system"), text size,
// reduced motion and language (spec B5.2, B5.3, B6.6, B10).
//
// A copy of the display prefs is kept in localStorage purely as a per-viewer convenience so
// the first paint uses the right theme and language. It holds no family data; IndexedDB
// remains the source of truth (spec B16).
import type { Lang, TextSize, ThemePref } from "@/services/types";
import { device } from "./device";

export interface DisplayCache {
  theme: ThemePref;
  textSize: TextSize;
  reduceMotion: boolean;
  lang: Lang;
}

const cacheKey = () => `pehchaan:display:${device.dbName}`;

export function readDisplayCache(): DisplayCache | null {
  try {
    const raw = localStorage.getItem(cacheKey()) ?? localStorage.getItem("pehchaan:display:last");
    return raw ? (JSON.parse(raw) as DisplayCache) : null;
  } catch {
    return null;
  }
}

function writeDisplayCache(d: DisplayCache) {
  try {
    const raw = JSON.stringify(d);
    localStorage.setItem(cacheKey(), raw);
    localStorage.setItem("pehchaan:display:last", raw);
  } catch {
    /* storage can be unavailable; the app still works */
  }
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const motionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return darkQuery().matches ? "dark" : "light";
  return pref;
}

export function systemPrefersReducedMotion(): boolean {
  return motionQuery().matches;
}

export function applyDisplay(d: DisplayCache) {
  const root = document.documentElement;
  const theme = resolveTheme(d.theme);
  root.dataset.theme = theme;
  root.dataset.themePref = d.theme;
  root.dataset.textSize = d.textSize;
  root.dataset.reduceMotion = String(d.reduceMotion || systemPrefersReducedMotion());
  root.lang = d.lang;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0A0E1F" : "#F5F6FB");
  writeDisplayCache(d);
}

/** Re-applies when the OS theme or motion preference changes. */
export function watchSystemDisplay(get: () => DisplayCache | null) {
  const onChange = () => {
    const d = get();
    if (d) applyDisplay(d);
  };
  const a = darkQuery();
  const b = motionQuery();
  a.addEventListener("change", onChange);
  b.addEventListener("change", onChange);
  return () => {
    a.removeEventListener("change", onChange);
    b.removeEventListener("change", onChange);
  };
}

/** Called once before React renders, so the first frame has the right theme. */
export function applyBootDisplay() {
  const cached = readDisplayCache();
  applyDisplay(
    cached ?? {
      theme: "system",
      textSize: "normal",
      reduceMotion: false,
      lang: "en",
    },
  );
}
