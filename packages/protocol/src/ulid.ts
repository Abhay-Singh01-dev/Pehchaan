// ULIDs for message and request IDs (16.2, D-009, D-019): 48 bits of millisecond time + 80 random bits,
// in Crockford base32 (26 characters, sortable by time).

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now: number = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b & 31]!;
  return time + rand;
}

/** The millisecond timestamp a ULID was made at. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}
