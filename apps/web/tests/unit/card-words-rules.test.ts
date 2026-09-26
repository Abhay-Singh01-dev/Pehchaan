import { describe, expect, it } from "vitest";
import { createCardService, myCard } from "@/services/card";
import { CardError, type FamilyCard } from "@/services/types";
import { utf8ToBase64Url } from "@/services/crypto";
import { WORDS, confirmationWordsFor, safetyWordsFor } from "@/services/words";
import { accumulate, analyzeLine, parseAmount, SCRIPTED_CALL } from "@/services/guard/rules";
import type { GuardSignals } from "@/services/types";

const arjunCard: FamilyCard = myCard({
  deviceId: "sim-arjun",
  name: "Arjun Sharma",
  phone: "+91 98765 43210",
  color: "indigo",
  role: "can_be_verified",
  keyId: "key_arjun",
  publicKey: "pk_arjun",
  safetyWords: ["TIGER", "MANGO", "RIVER", "LAMP"],
});

describe("CardService (family links)", () => {
  const cards = createCardService(() => "sim-maa");

  it("round-trips a card through a /join#c= link", () => {
    const link = cards.toLink(arjunCard);
    expect(link).toMatch(/^https:\/\/pehchaan\.test\/join#c=[A-Za-z0-9_-]+$/);
    expect(cards.fromLink(link)).toEqual(arjunCard);
  });

  it("accepts pasted text that contains the link, and Devanagari names", () => {
    const hindi = { ...arjunCard, name: "अर्जुन शर्मा" };
    expect(cards.fromLink(`Here's my code: ${cards.toLink(hindi)} thanks`).name).toBe("अर्जुन शर्मा");
  });

  it("also accepts the long (plain FamilyCard) form", () => {
    const code = utf8ToBase64Url(JSON.stringify(arjunCard));
    expect(cards.fromLink(`https://x/join#c=${code}`)).toEqual(arjunCard);
  });

  it("throws not_pehchaan / corrupt / own_card", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as CardError).code;
      }
      return null;
    };
    expect(code(() => cards.fromLink("hello"))).toBe("not_pehchaan");
    expect(code(() => cards.fromLink("https://x/join#c=bm90LWpzb24"))).toBe("corrupt");
    expect(code(() => cards.fromLink(`https://x/join#c=${utf8ToBase64Url('{"v":1}')}`))).toBe("corrupt");
    expect(code(() => createCardService(() => "sim-arjun").fromLink(cards.toLink(arjunCard)))).toBe("own_card");
  });
});

describe("words", () => {
  it("has exactly 256 unique words (one per hash byte)", () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS).size).toBe(256);
  });

  it("derives stable safety and confirmation words", async () => {
    expect(await safetyWordsFor("pk_arjun")).toEqual(await safetyWordsFor("pk_arjun"));
    const w = await confirmationWordsFor({ signature: "abc", nonce: "n1" });
    expect(w).toHaveLength(2);
    expect(w[0]).not.toBe(w[1]);
  });
});

describe("Call Guard rules", () => {
  it("parses rupee amounts in Indian styles", () => {
    expect(parseAmount("Abhi ₹50,000 chahiye")).toBe(50000);
    expect(parseAmount("50 hazaar bhejo")).toBe(50000);
    expect(parseAmount("2 lakh chahiye")).toBe(200000);
    expect(parseAmount("२० हज़ार भेजो")).toBe(20000);
    expect(parseAmount("kal milte hain")).toBeUndefined();
  });

  it("follows the scripted call: claim → pressure → secrecy → money, never backwards", () => {
    let s: GuardSignals = { tactics: [], stage: 0 };
    const stages: number[] = [];
    for (const line of SCRIPTED_CALL) {
      s = accumulate(s, analyzeLine(line, ["Arjun", "Priya"]));
      stages.push(s.stage);
    }
    expect(s.claimedLabel).toBe("Arjun");
    expect(s.amountInr).toBe(50000);
    expect(s.tactics).toEqual(expect.arrayContaining(["identity", "money", "urgency", "secrecy"]));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(s.stage).toBe(4);
  });

  it("recognises a claimed name it has never seen, and Devanagari", () => {
    expect(analyzeLine("Maa, main Rohit bol raha hoon", []).claimedLabel).toBe("Rohit");
    expect(analyzeLine("मैं अर्जुन बोल रहा हूँ, पैसे भेजो", []).tactics).toEqual(expect.arrayContaining(["identity", "money"]));
  });

  it("matches ED only as a word (not inside English words)", () => {
    expect(analyzeLine("I finished it", []).tactics).not.toContain("authority");
    expect(analyzeLine("This is ED calling", []).tactics).toContain("authority");
  });
});
