// Canonical JSON and the challenge (spec 10.1, 10.2).
// "Canonical" means one exact string for a given object, so both phones hash identical bytes. The rules
// match RFC 8785 (JCS) for the value types Pehchaan uses: keys sorted by UTF-16 code units, recursively;
// no whitespace; undefined fields omitted; strings exactly as JSON.stringify writes them; safe integers only.
import { sha256, utf8 } from "./bytes";
import type { CanonicalRequestFields, Decision } from "./types";

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") {
    // Amounts are whole rupees and times are integer milliseconds: anything else is refused.
    if (typeof v === "number" && !Number.isSafeInteger(v)) throw new Error("canonical: integers only");
    if (v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") {
      throw new Error("canonical: unsupported value");
    }
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

/** The exact bytes both phones sign over: the request's signed fields plus the format version (10.2). */
export const canonicalRequest = (r: CanonicalRequestFields): string =>
  canonical({
    v: 1,
    requestId: r.requestId,
    nonce: r.nonce,
    fromDeviceId: r.fromDeviceId,
    toDeviceId: r.toDeviceId,
    claimedLabel: r.claimedLabel,
    reason: r.reason,
    amountInr: r.amountInr,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  });

/** challenge = SHA-256( UTF-8( canonicalRequest + "|" + decision ) ) */
export const challengeFor = async (r: CanonicalRequestFields, decision: Decision): Promise<Uint8Array<ArrayBuffer>> =>
  sha256(utf8(canonicalRequest(r) + "|" + decision));
