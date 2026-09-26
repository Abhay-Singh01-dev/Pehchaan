// ECDSA signature encodings. WebAuthn ES256 signatures are ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }.
// WebCrypto wants raw r‖s (64 bytes). The parser is strict: anything unexpected throws, so check 6 fails.
import { concat } from "./bytes";

export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 0;
  const fail = (): never => {
    throw new Error("bad DER signature");
  };
  if (der[i++] !== 0x30) fail();
  const seqLen = der[i++]!;
  if (seqLen & 0x80 || seqLen !== der.length - 2) fail();
  const int = () => {
    if (der[i++] !== 0x02) fail();
    const len = der[i++]!;
    if (len === 0 || len > 33) fail();
    if (i + len > der.length) fail();
    let v = der.subarray(i, i + len);
    i += len;
    if (v.length === 33) {
      if (v[0] !== 0) fail();
      v = v.subarray(1);
    }
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = int();
  const s = int();
  if (i !== der.length) fail();
  return concat(r, s);
}

/** raw r‖s (64 bytes) → minimal DER, as an authenticator would produce it. */
export function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  if (raw.length !== 64) throw new Error("raw ECDSA signature must be 64 bytes");
  const int = (b: Uint8Array) => {
    let v = b;
    while (v.length > 1 && v[0] === 0 && v[1]! < 0x80) v = v.subarray(1); // minimal: strip leading zeros
    if (v[0]! >= 0x80) v = concat(new Uint8Array([0]), v); // positive: add a zero if the top bit is set
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}
