// Formatting helpers (spec B8 "Numbers"): Indian rupee grouping, Latin digits in both
// languages, short dates, clock times and relative times.
import type { Lang } from "@/services/types";

const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹50,000 · ₹1,00,000 */
export const formatINR = (n: number) => inrFmt.format(n);

/** Indian digit grouping without the symbol: 1,00,000 */
export const groupIN = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const locale = (lang: Lang) => (lang === "hi" ? "hi-IN-u-nu-latn" : "en-IN");

/** "12 Sep" */
export function formatDateShort(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short" }).format(ts);
}

/** "12 Sep 2026" */
export function formatDateLong(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", year: "numeric" }).format(ts);
}

/** "10:41:02" (24-hour for precision on timelines) */
export function formatClock(ts: number, withSeconds = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  }).format(ts);
}

/** "10:41 am" */
export function formatTime(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: "numeric", minute: "2-digit" }).format(ts);
}

/** "4 s ago", "3 min ago", "2 days ago" */
export function relativeTime(ts: number, lang: Lang, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto", style: "short" });
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, "minute");
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, "hour");
  const d = Math.round(h / 24);
  return rtf.format(d, "day");
}

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Day buckets for History: "today" | "yesterday" | a short date. */
export function dayKey(ts: number, now = Date.now()): "today" | "yesterday" | number {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return startOfDay(ts);
}

/** "m:ss" for countdowns. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Initials for avatars: "Sunita Sharma" → "SS", "Maa" → "M", "अर्जुन" → "अ". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0]!)[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Stored phone format: "+91 98765 43210". Accepts 10 digits with or without +91 / 0. */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** tel: link for a stored phone string. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Joins names naturally: "Priya", "Priya and Ramesh", "Priya, Ramesh and Maa". */
export function joinNames(names: string[], lang: Lang): string {
  if (names.length <= 1) return names[0] ?? "";
  const and = lang === "hi" ? " और " : " and ";
  return names.slice(0, -1).join(", ") + and + names[names.length - 1];
}
