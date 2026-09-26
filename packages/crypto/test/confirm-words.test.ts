// CRY-13: confirmation words (10.8).
import { describe, expect, it } from "vitest";
import { BIP39_ENGLISH } from "../src/bip39-english";
import { b64url, b64urlDecode, concat, sha256, utf8 } from "../src/bytes";
import { confirmationWords, confirmationWordsFor } from "../src/confirm-words";
import { derToRaw, rawToDer } from "../src/der";
import { createSoftCredential, softAnswer } from "../src/soft-authenticator";
import { read11 } from "../src/words";
import vectors from "./vectors.json";

// The P-256 group order n.
const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const toBig = (b: Uint8Array) => BigInt("0x" + Buffer.from(b).toString("hex"));
const toBytes32 = (n: bigint) => Uint8Array.from(Buffer.from(n.toString(16).padStart(64, "0"), "hex"));

async function genuineYes() {
  const cred = await createSoftCredential();
  const ans = await softAnswer({
    req: vectors.requestA,
    decision: "ME",
    credId: cred.credId,
    privateKey: cred.privateKey,
    rpId: "app.yourdomain.in",
    origin: "https://app.yourdomain.in",
  });
  return { cred, ans };
}

describe("CRY-13 · confirmation words", () => {
  it("are identical on both sides (the answerer's bytes and the asker's received copy)", async () => {
    const { ans } = await genuineYes();
    const answerer = await confirmationWords(
      ans.nonce,
      b64urlDecode(ans.authenticatorData),
      b64urlDecode(ans.clientDataJSON),
    );
    const asker = await confirmationWordsFor(JSON.parse(JSON.stringify(ans)));
    expect(asker).toEqual(answerer);
    expect(answerer).toHaveLength(2);
    for (const w of answerer) expect(BIP39_ENGLISH).toContain(w.toLowerCase());
  });

  it("are the first two 11-bit indexes of SHA-256('pehchaan-confirm-v1|' + nonce + '|' ‖ authData ‖ clientDataJSON)", async () => {
    const { ans } = await genuineYes();
    const h = await sha256(
      concat(
        utf8(`pehchaan-confirm-v1|${ans.nonce}|`),
        b64urlDecode(ans.authenticatorData),
        b64urlDecode(ans.clientDataJSON),
      ),
    );
    expect(await confirmationWordsFor(ans)).toEqual([
      BIP39_ENGLISH[read11(h, 0)]!.toUpperCase(),
      BIP39_ENGLISH[read11(h, 11)]!.toUpperCase(),
    ]);
  });

  it("don't change when the signature is rewritten to (r, n − s)", async () => {
    const { ans } = await genuineYes();
    const raw = derToRaw(b64urlDecode(ans.signature));
    const s = toBig(raw.subarray(32));
    const malleated = b64url(rawToDer(concat(raw.subarray(0, 32), toBytes32(N - s))));
    expect(malleated).not.toBe(ans.signature);
    expect(await confirmationWordsFor({ ...ans, signature: malleated } as typeof ans)).toEqual(
      await confirmationWordsFor(ans),
    );
  });

  it("differ between requests (they bind the nonce and the signed challenge)", async () => {
    const { cred, ans } = await genuineYes();
    const other = await softAnswer({
      req: { ...vectors.requestA, requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E3G", nonce: b64url(new Uint8Array(32).fill(7)) },
      decision: "ME",
      credId: cred.credId,
      privateKey: cred.privateKey,
      rpId: "app.yourdomain.in",
      origin: "https://app.yourdomain.in",
    });
    expect(await confirmationWordsFor(other)).not.toEqual(await confirmationWordsFor(ans));
  });

  it("depend only on the nonce, authenticatorData and clientDataJSON, never on the signing key", async () => {
    // Two passkeys answering the same request produce the same words: the words prove the caller can see
    // the answering phone's screen; which key signed is checks 2 and 6's job.
    const a = await genuineYes();
    const b = await genuineYes();
    expect(await confirmationWordsFor(a.ans)).toEqual(await confirmationWordsFor(b.ans));
  });
});
