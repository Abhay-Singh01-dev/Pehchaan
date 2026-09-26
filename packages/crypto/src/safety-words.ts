// Safety words (spec 6.3): the four words both phones show when adding each other in person.
//
//   fingerprint = SHA-256( canonical({ v: 2, d, dk, ek, kt?, ki?, pk? }) )
//   stretched   = PBKDF2-HMAC-SHA-256(password = fingerprint, salt = "pehchaan-safety-words-v2",
//                                     iterations = 600_000, length = 64 bits)
//   words       = 4 × 11-bit indexes into the BIP-39 English list, UPPERCASE
//
// Four words are only 44 bits. Stretching makes grinding a look-alike card cost decades per GPU instead of
// an hour. Every phone derives the words itself: a card never carries words, because it could lie.
import { sha256, utf8 } from "./bytes";
import { canonical } from "./canonical";
import { wordAt } from "./words";

export const SAFETY_WORDS_SALT = "pehchaan-safety-words-v2";
export const SAFETY_WORDS_ITERATIONS = 600_000;

export type SafetyWords = [string, string, string, string];

/** The key material the words vouch for: device ID, device keys and (for "can be verified") the passkey. */
export interface CardKeys {
  d: string;
  dk: string;
  ek: string;
  kt?: "pk" | "pin";
  ki?: string;
  pk?: string;
}

export async function cardFingerprint(k: CardKeys): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(utf8(canonical({ v: 2, d: k.d, dk: k.dk, ek: k.ek, kt: k.kt, ki: k.ki, pk: k.pk })));
}

export async function safetyWords(k: CardKeys): Promise<SafetyWords> {
  const password = await crypto.subtle.importKey("raw", await cardFingerprint(k), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: utf8(SAFETY_WORDS_SALT), iterations: SAFETY_WORDS_ITERATIONS },
      password,
      64,
    ),
  );
  return [wordAt(bits, 0), wordAt(bits, 11), wordAt(bits, 22), wordAt(bits, 33)];
}
