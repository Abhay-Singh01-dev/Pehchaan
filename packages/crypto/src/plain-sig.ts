// The sender signature on readable (`plain`) envelopes (spec 9.5). Plain is only used before E2E ships and
// between two Security-Lab-opted-in devices, and it is still signed:
//   psig = ECDSA-P256-SHA-256(sender device key,
//            "pehchaan-plain-v1" ‖ SHA-256(aad) ‖ SHA-256(UTF-8(canonical(plain))))      aad as in 9.2
// Receivers check it for requests, alerts and prompts. Answers are authenticated by the passkey and the
// 7 checks instead, which is exactly what lets the Lab's altered answers reach the verifier.
import { b64url, b64urlDecode, concat, equalBytes, sha256, utf8 } from "./bytes";
import { canonical } from "./canonical";
import { deviceIdFrom } from "./device-auth";
import { headerAad, type Header } from "./e2e";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG = { name: "ECDSA", hash: "SHA-256" } as const;

const psigInput = async (h: Header, plain: object) =>
  concat(utf8("pehchaan-plain-v1"), await sha256(headerAad(h)), await sha256(utf8(canonical(plain))));

export async function signPlain(plain: object, h: Header, senderSignPriv: CryptoKey): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign(SIG, senderSignPriv, await psigInput(h, plain))));
}

/** True only if the payload's `spk` belongs to the envelope's sender (and to my saved card for them, when
 *  I have one) and `psig` signs this header and this exact payload. */
export async function verifyPlain(
  plain: { spk: string },
  h: Header,
  psig: string,
  knownSenderDk?: string,
): Promise<boolean> {
  try {
    const spk = b64urlDecode(plain.spk);
    if ((await deviceIdFrom(spk)) !== h.from) return false;
    if (knownSenderDk && !equalBytes(spk, b64urlDecode(knownSenderDk))) return false;
    const pub = await crypto.subtle.importKey("raw", spk, ECDSA, false, ["verify"]);
    return await crypto.subtle.verify(SIG, pub, b64urlDecode(psig), await psigInput(h, plain));
  } catch {
    return false;
  }
}
