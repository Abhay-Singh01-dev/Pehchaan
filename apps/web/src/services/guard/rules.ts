// Call Guard keyword rules (spec B12 J2). Case-insensitive; Devanagari and Latin
// transliteration. These rules are shown verbatim in the Guard's "Rules" drawer, so the
// detection is fully transparent. They stay the same if a better speech engine replaces
// the Web Speech API later (Part E).
import type { GuardSignals, Tactic } from "../types";

export interface TacticRule {
  tactic: Exclude<Tactic, "identity">;
  /** Latin phrases, matched on word boundaries. */
  latin: string[];
  /** Devanagari phrases, matched as substrings. */
  devanagari: string[];
  /** Case-sensitive words (e.g. "ED", which would otherwise match inside English words). */
  exact?: string[];
}

export const TACTIC_RULES: TacticRule[] = [
  {
    tactic: "money",
    latin: [
      "rupaye",
      "rupaiye",
      "rupees",
      "rupee",
      "paise",
      "paisa",
      "upi",
      "transfer",
      "bhejo",
      "bhej do",
      "send money",
    ],
    devanagari: ["₹", "पैसे", "पैसा", "रुपये", "भेजो", "भेज दो", "यूपीआई"],
  },
  {
    tactic: "urgency",
    latin: ["abhi", "jaldi", "turant", "urgent", "emergency", "right now", "immediately"],
    devanagari: ["अभी", "जल्दी", "तुरंत", "इमरजेंसी"],
  },
  {
    tactic: "secrecy",
    latin: ["mat batana", "kisi ko", "don't tell", "dont tell", "phone mat rakhna", "keep it secret"],
    devanagari: ["मत बताना", "किसी को", "फ़ोन मत रखना", "फोन मत रखना"],
  },
  {
    tactic: "otp",
    latin: ["otp", "code", "number batao", "pin batao"],
    devanagari: ["ओटीपी", "कोड", "नंबर बताओ"],
  },
  {
    tactic: "authority",
    latin: ["police", "cbi", "customs", "arrest", "digital arrest", "officer", "court"],
    devanagari: ["पुलिस", "सीबीआई", "गिरफ़्तार", "गिरफ्तार", "कस्टम"],
    exact: ["ED"],
  },
];

/** Identity-claim patterns; {name} is replaced by every family label and first name. */
export const IDENTITY_PATTERNS = {
  latin: ["main {name}", "{name} bol raha", "{name} bol rahi", "{name} bol rahe", "{name} here", "it's {name}"],
  devanagari: ["मैं {name}", "{name} बोल रहा", "{name} बोल रही"],
  generic: ["it's me", "its me", "maa main", "main hi hoon", "मैं ही हूँ", "माँ मैं"],
  /** Any capitalised name in a self-introduction, for callers the laptop doesn't know. */
  anyName: ["main <Name> bol raha / bol rahi", "it's <Name> / this is <Name>", "मैं <नाम> बोल रहा / बोल रही"],
};

const ANY_NAME: RegExp[] = [
  /\b(?:main|mai|mein)\s+([A-Z][A-Za-z]{1,20})\s+(?:bol|baat\s+kar)\s+(?:raha|rahi|rahe)\b/,
  /\b(?:it'?s|this\s+is)\s+([A-Z][A-Za-z]{1,20})\b/,
  /मैं\s+([ऀ-ॿ]{2,20})\s+बोल\s+(?:रहा|रही|रहे)/,
];
const NOT_NAMES = new Set(["Me", "Maa", "Main", "Papa", "Beta", "Ji"]);

export const AMOUNT_PATTERNS = [
  "₹ followed by a number (₹50,000)",
  "a number followed by hazaar / हज़ार / thousand (×1,000)",
  "a number followed by lakh / लाख (×1,00,000)",
];

const STAGE_OF: Record<Tactic, GuardSignals["stage"]> = {
  identity: 1,
  urgency: 2,
  authority: 2,
  secrecy: 3,
  otp: 3,
  money: 4,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function latinMatch(text: string, phrase: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${escape(phrase.toLowerCase())}(?=$|[^a-z0-9])`, "i");
  return re.test(text);
}

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
const normalizeDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));

export function parseAmount(text: string): number | undefined {
  const t = normalizeDigits(text.toLowerCase());
  const rupee = t.match(/₹\s?([\d,]+(?:\.\d+)?)/);
  if (rupee) {
    const n = Number(rupee[1]!.replace(/,/g, ""));
    if (n > 0) return Math.round(n);
  }
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|लाख)/);
  if (lakh) return Math.round(Number(lakh[1]) * 100_000);
  const thousand = t.match(/(\d+(?:\.\d+)?)\s*(hazaar|hazar|hajar|thousand|हज़ार|हजार)/);
  if (thousand) return Math.round(Number(thousand[1]) * 1000);
  const plain = t.match(/(\d{1,3}(?:,\d{2,3})+|\d{4,7})\s*(rupaye|rupees|rs|रुपये)?/);
  if (plain && (plain[2] || /upi|bhejo|transfer|चाहिए|chahiye/.test(t))) {
    const n = Number(plain[1]!.replace(/,/g, ""));
    if (n >= 100) return n;
  }
  return undefined;
}

export interface LineAnalysis {
  tactics: Tactic[];
  claimedLabel?: string;
  amountInr?: number;
  matches: string[];
}

/** Finds the tactics in one transcript line. `names` are family labels and first names. */
export function analyzeLine(line: string, names: string[]): LineAnalysis {
  const text = line.toLowerCase();
  const found = new Set<Tactic>();
  const matches: string[] = [];
  let claimedLabel: string | undefined;

  for (const rule of TACTIC_RULES) {
    for (const p of rule.latin) {
      if (latinMatch(text, p)) {
        found.add(rule.tactic);
        matches.push(p);
      }
    }
    for (const p of rule.devanagari) {
      if (line.includes(p)) {
        found.add(rule.tactic);
        matches.push(p);
      }
    }
    for (const p of rule.exact ?? []) {
      if (new RegExp(`(^|[^A-Za-z])${escape(p)}(?=$|[^A-Za-z])`).test(line)) {
        found.add(rule.tactic);
        matches.push(p);
      }
    }
  }

  const amount = parseAmount(line);
  if (amount) {
    found.add("money");
    const m = line.match(/₹\s?[\d,]+/);
    if (m) matches.push(m[0]);
  }

  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    const lower = n.toLowerCase();
    const hit =
      IDENTITY_PATTERNS.latin.some((p) => latinMatch(text, p.replace("{name}", lower))) ||
      IDENTITY_PATTERNS.devanagari.some((p) => line.includes(p.replace("{name}", n)));
    if (hit) {
      found.add("identity");
      claimedLabel ??= n;
      matches.push(n);
    }
  }
  if (!found.has("identity")) {
    for (const re of ANY_NAME) {
      const m = line.match(re);
      if (m && m[1] && !NOT_NAMES.has(m[1])) {
        found.add("identity");
        claimedLabel = m[1];
        matches.push(m[1]);
        break;
      }
    }
  }
  if (!found.has("identity")) {
    for (const g of IDENTITY_PATTERNS.generic) {
      if (/[ऀ-ॿ]/.test(g) ? line.includes(g) : latinMatch(text, g)) {
        found.add("identity");
        matches.push(g);
      }
    }
  }

  return { tactics: [...found], claimedLabel, amountInr: amount, matches };
}

/** Folds one line into the session's signals. The stage never goes backwards. */
export function accumulate(prev: GuardSignals, line: LineAnalysis): GuardSignals {
  const tactics = new Set(prev.tactics);
  line.tactics.forEach((t) => tactics.add(t));
  let stage = prev.stage;
  for (const t of line.tactics) stage = Math.max(stage, STAGE_OF[t]) as GuardSignals["stage"];
  const next: GuardSignals = {
    tactics: [...tactics],
    stage,
    matches: line.matches,
  };
  const claimed = prev.claimedLabel ?? line.claimedLabel;
  if (claimed) next.claimedLabel = claimed;
  const amount = line.amountInr ?? prev.amountInr;
  if (amount) next.amountInr = amount;
  return next;
}

/** The six scripted call lines (spec J2), played 3–5 s apart. */
export const SCRIPTED_CALL = [
  "Maa, main Arjun bol raha hoon… mera phone toot gaya, dost ke phone se call kar raha hoon.",
  "Accident ho gaya hai, main hospital mein hoon. Abhi ₹50,000 chahiye.",
  "Papa ko mat batana please, woh pareshaan ho jaayenge.",
  "Haan Maa, main hi hoon… jaldi karo please.",
  "Phone mat rakhna, bas UPI kar do.",
  "Please Maa, abhi bhejo.",
];
