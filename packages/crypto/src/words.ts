// Turning hash bits into BIP-39 words: each word is an 11-bit index (0–2047), read big-endian from the
// start of the byte string, shown in capitals.
import { BIP39_ENGLISH } from "./bip39-english";

/** The 11-bit number that starts at `bitOffset` (big-endian). */
export function read11(bytes: Uint8Array, bitOffset: number): number {
  let v = 0;
  for (let b = 0; b < 11; b++) {
    const bit = bitOffset + b;
    v = (v << 1) | ((bytes[bit >> 3]! >> (7 - (bit & 7))) & 1);
  }
  return v;
}

export const wordAt = (bytes: Uint8Array, bitOffset: number): string =>
  BIP39_ENGLISH[read11(bytes, bitOffset)]!.toUpperCase();
