// Confirmation words (spec 10.8): after a VERIFIED answer both phones show the same two words, and Maa asks
// the caller to read them out. A scammer doesn't have Arjun's phone and can't know them.
//
//   bits  = SHA-256( UTF-8("pehchaan-confirm-v1|" + nonce + "|") ‖ authenticatorData ‖ clientDataJSON )
//   words = [ BIP39[bits 0–10], BIP39[bits 11–21] ]
//
// The signature is deliberately left out: an ECDSA signature can be rewritten into a second valid form
// (r, n−s), which would make the two phones show different words.
import { b64urlDecode, concat, sha256, utf8 } from "./bytes";
import { wordAt } from "./words";

export async function confirmationWords(
  nonce: string,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Promise<[string, string]> {
  const bits = await sha256(concat(utf8(`pehchaan-confirm-v1|${nonce}|`), authenticatorData, clientDataJSON));
  return [wordAt(bits, 0), wordAt(bits, 11)];
}

/** The same, from a wire answer (base64url fields). */
export const confirmationWordsFor = (ans: {
  nonce: string;
  authenticatorData: string;
  clientDataJSON: string;
}): Promise<[string, string]> =>
  confirmationWords(ans.nonce, b64urlDecode(ans.authenticatorData), b64urlDecode(ans.clientDataJSON));
