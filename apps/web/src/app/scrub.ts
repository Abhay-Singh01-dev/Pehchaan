// The error-report scrubber (spec 16.7). Error reports leave the VM, so before any event is sent every field whose
// name could hold a payload or personal data is removed, at any depth. Names are matched case-insensitively.
export const SCRUBBED_FIELDS = ["e2e", "plain", "nonce", "signature", "grant", "endpoint", "phone", "name", "label"];

const DROP = new Set(SCRUBBED_FIELDS);

/** A scrubbed deep copy (the original is not changed). */
export function scrub<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[cycle]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.has(k.toLowerCase())) out[k] = walk(x);
    return out;
  };
  return walk(value) as T;
}
