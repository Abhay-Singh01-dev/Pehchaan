// Call Guard's keyword rules (frontend spec J2): amounts, claimed names, tactics and the stage order.
import { describe, expect, it } from "vitest";
import { accumulate, analyzeLine, parseAmount, SCRIPTED_CALL } from "@/services/guard/rules";
import type { GuardSignals } from "@/services/types";

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
    expect(analyzeLine("मैं अर्जुन बोल रहा हूँ, पैसे भेजो", []).tactics).toEqual(
      expect.arrayContaining(["identity", "money"]),
    );
  });

  it("matches ED only as a word (not inside English words)", () => {
    expect(analyzeLine("I finished it", []).tactics).not.toContain("authority");
    expect(analyzeLine("This is ED calling", []).tactics).toContain("authority");
  });
});
