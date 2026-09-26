// i18next setup (spec B3, B8). Only the active language is loaded at startup (keeps the first
// load small, spec B15); the other is fetched on switch, and prefetched when the app is idle,
// so the language switch still feels instant.
//
// Hindi verb endings follow the person addressed (रहा / रही / रहे). Gendered strings have
// `_m` / `_f` variants; the base key is the respectful plural used for "prefer not to say".
// Use `useG()` for any string addressed to the reader so the right form is picked.
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import type { HindiForm, Lang } from "@/services/types";
import { readDisplayCache } from "./theme";

const loaders: Record<Lang, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("@/i18n/en.json"),
  hi: () => import("@/i18n/hi.json"),
};

void i18n.use(initReactI18next).init({
  resources: {},
  lng: readDisplayCache()?.lang ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

export async function loadLanguage(lang: Lang): Promise<void> {
  if (i18n.hasResourceBundle(lang, "translation")) return;
  const res = await loaders[lang]();
  i18n.addResourceBundle(lang, "translation", res.default, true, true);
}

/** Loads the language's strings, then switches to it. */
export async function switchLanguage(lang: Lang): Promise<void> {
  await loadLanguage(lang);
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

/** Called before the first render. */
export async function initI18n(): Promise<void> {
  const lang = (i18n.language as Lang) || "en";
  await loadLanguage(lang);
  // English is the fallback: make sure it's present too (after first paint).
  if (lang !== "en") window.setTimeout(() => void loadLanguage("en"), 1500);
}

/** Prefetch the other language when idle, so switching is instant. */
export function prefetchOtherLanguage() {
  const other: Lang = i18n.language === "hi" ? "en" : "hi";
  void loadLanguage(other).catch(() => {});
}

export default i18n;

let currentForm: HindiForm = "n";
export function setHindiForm(form: HindiForm) {
  currentForm = form;
}

/** `t` with the reader's Hindi form applied as i18next context. */
export function useG() {
  const { t, i18n: inst } = useTranslation();
  const lang = (inst.language as Lang) ?? "en";
  const g = (key: string, opts: Record<string, unknown> = {}) =>
    t(key, lang === "hi" && currentForm !== "n" ? { ...opts, context: currentForm } : opts);
  return { t, g, lang };
}
