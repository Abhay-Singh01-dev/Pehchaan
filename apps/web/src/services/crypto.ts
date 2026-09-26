// Small crypto and encoding helpers. They live inside the service layer on purpose:
// screens never call crypto APIs directly (spec B16).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8ToBase64Url = (text: string) => toBase64Url(enc.encode(text));
export const base64UrlToUtf8 = (s: string) => dec.decode(fromBase64Url(s));

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === "string" ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(digest);
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await sha256(input));
}

/** URL-safe random id, e.g. "req_3fZq…". */
export function randomId(prefix = "", bytes = 12): string {
  return (prefix ? prefix + "_" : "") + toBase64Url(randomBytes(bytes));
}
