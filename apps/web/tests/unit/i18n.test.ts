// FC-26 / APP-11: every string exists in English and Hindi, with the same placeholders, including every state the
// backend added. (scripts/i18n-check.mjs also checks that every key the code uses exists; the banned-words
// check covers the text itself.)
import { describe, expect, it } from "vitest";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";

type Tree = { [k: string]: string | Tree };

/** Keys starting with "_" are notes for translators (hi.json's `_review`), not UI text. */
function flatten(t: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string") out.set(prefix + k, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}

// Hindi adds gendered variants (key_m / key_f) for verb endings; English has none.
const base = (k: string) => k.replace(/_(m|f)$/, "");
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

const EN = flatten(en as Tree);
const HI = flatten(hi as Tree);

describe("strings (FC-26)", () => {
  it("English and Hindi have the same keys", () => {
    const hiBase = new Set([...HI.keys()].map(base));
    expect([...EN.keys()].filter((k) => !hiBase.has(k))).toEqual([]);
    expect([...hiBase].filter((k) => !EN.has(k))).toEqual([]);
  });

  it("every Hindi string uses exactly the English placeholders", () => {
    const wrong = [...HI].filter(([k, v]) => {
      const e = EN.get(base(k));
      return e !== undefined && placeholders(e).join() !== placeholders(v).join();
    });
    expect(wrong.map(([k]) => k)).toEqual([]);
  });

  it("no string is empty", () => {
    expect([...EN, ...HI].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it.each([
    "wait.status.seen",
    "v.none.notAllowed",
    "v.none.late",
    "v.denied.late",
    "ask.stoppedWaiting",
    "ask.answeredElsewhere",
    "verify.mayNotGet",
    "checks.skipped",
    "checks.fail.late",
    "checks.fail.sealed_changed",
    "cardGuard.impostorTitle",
    "cardGuard.alteredTitle",
    "join.onlyMet",
    "member.resetCodeToo",
    "settings.resetCode",
    "settings.whoCanReach",
    "privacy.title",
    "pwa.updateRequired",
    "labBanner.text",
    "key.noPasskey",
  ])("has the new state %s in both languages", (key) => {
    expect(EN.get(key)).toBeTruthy();
    expect(HI.get(key) ?? HI.get(`${key}_m`)).toBeTruthy();
  });
});
