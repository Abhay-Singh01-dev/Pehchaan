// CRY-12 safety words (6.3) and C-6.3a the vendored BIP-39 list.
import { describe, expect, it } from "vitest";
import { BIP39_ENGLISH, BIP39_ENGLISH_SHA256 } from "../src/bip39-english";
import { b64url, sha256, utf8 } from "../src/bytes";
import { canonical } from "../src/canonical";
import {
  cardFingerprint,
  SAFETY_WORDS_ITERATIONS,
  SAFETY_WORDS_SALT,
  safetyWords,
  type CardKeys,
} from "../src/safety-words";
import { read11 } from "../src/words";
import { makeDevice } from "./helpers";

async function keys(canBeVerified = true): Promise<CardKeys> {
  const d = await makeDevice();
  const k: CardKeys = { d: d.deviceId, dk: d.dk, ek: d.ek };
  if (canBeVerified) {
    k.kt = "pk";
    k.ki = b64url(crypto.getRandomValues(new Uint8Array(16)));
    k.pk = (await makeDevice()).dk;
  }
  return k;
}

describe("C-6.3a · the BIP-39 English wordlist", () => {
  it("has 2048 unique words and matches the published file's SHA-256", async () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH).size).toBe(2048);
    const file = BIP39_ENGLISH.join("\n") + "\n";
    expect(Buffer.from(await sha256(utf8(file))).toString("hex")).toBe(BIP39_ENGLISH_SHA256);
    expect(BIP39_ENGLISH[0]).toBe("abandon");
    expect(BIP39_ENGLISH[2047]).toBe("zoo");
  });
});

describe("CRY-12 · safety words", () => {
  it("are four upper-case BIP-39 words, the same every time", async () => {
    const k = await keys();
    const a = await safetyWords(k);
    expect(a).toHaveLength(4);
    for (const w of a) {
      expect(w).toBe(w.toUpperCase());
      expect(BIP39_ENGLISH).toContain(w.toLowerCase());
    }
    expect(await safetyWords({ ...k })).toEqual(a);
  });

  it("are PBKDF2-HMAC-SHA-256 over the card fingerprint, 600,000 iterations, 64 bits (recomputed independently)", async () => {
    expect(SAFETY_WORDS_ITERATIONS).toBe(600_000);
    expect(SAFETY_WORDS_SALT).toBe("pehchaan-safety-words-v2");
    const k = await keys();
    const fp = await sha256(utf8(canonical({ v: 2, d: k.d, dk: k.dk, ek: k.ek, kt: k.kt, ki: k.ki, pk: k.pk })));
    expect(await cardFingerprint(k)).toEqual(fp);
    const pw = await crypto.subtle.importKey("raw", fp, "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: utf8("pehchaan-safety-words-v2"), iterations: 600_000 },
        pw,
        64,
      ),
    );
    const expected = [0, 11, 22, 33].map((o) => BIP39_ENGLISH[read11(bits, o)]!.toUpperCase());
    expect(await safetyWords(k)).toEqual(expected);
  });

  it("change when any key changes: device ID, device keys, key type, credential or passkey", async () => {
    const k = await keys();
    const base = (await safetyWords(k)).join(" ");
    const other = await keys();
    for (const changed of [
      { ...k, d: other.d },
      { ...k, dk: other.dk },
      { ...k, ek: other.ek },
      { ...k, ki: other.ki },
      { ...k, pk: other.pk },
      { d: k.d, dk: k.dk, ek: k.ek }, // the passkey removed (a checks-only card)
    ]) {
      expect((await safetyWords(changed)).join(" ")).not.toBe(base);
    }
  });

  it("work for checks-only cards (no passkey fields)", async () => {
    expect(await safetyWords(await keys(false))).toHaveLength(4);
  });

  it("never come from the card: the function only takes key material", async () => {
    const k = await keys();
    const withWords = { ...k, w: "TIGER.MANGO.RIVER.LAMP" } as CardKeys;
    expect(await safetyWords(withWords)).toEqual(await safetyWords(k));
  });

  it("read11 reads 11 bits big-endian across byte boundaries", () => {
    const b = new Uint8Array([0b10000000, 0b00100000, 0xff, 0xff, 0xff, 0xff]);
    expect(read11(b, 0)).toBe(0b10000000001);
    expect(read11(new Uint8Array([0xff, 0xff]), 0)).toBe(2047);
    // bytes 00000000 00011111 11111100: bits 11–21 are all ones.
    expect(read11(new Uint8Array([0, 0x1f, 0xfc]), 11)).toBe(2047);
    // bytes 00000000 00010000 00000000: only bit 11 is set → the top bit of the 11-bit number.
    expect(read11(new Uint8Array([0, 0x10, 0]), 11)).toBe(1024);
  });
});
