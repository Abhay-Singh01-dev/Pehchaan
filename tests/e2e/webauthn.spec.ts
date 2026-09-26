// Phase 1: the virtual authenticator registers a passkey and signs a challenge, and the signature
// verifies (ES256 over authenticatorData ‖ SHA-256(clientDataJSON)) with the returned public key.
import { createHash, createPublicKey, verify } from "node:crypto";
import { expect, test } from "@playwright/test";
import { newPhone } from "./fixtures/webauthn";

test("virtual authenticator: passkey created with UV, challenge signed and verifiable", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const { page, authenticator } = await newPhone(contexts[0]!, "/");
    const result = await page.evaluate(async () => {
      const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { id: "localhost", name: "Pehchaan" },
          user: { id: new TextEncoder().encode("device-under-test"), name: "Arjun · Pehchaan", displayName: "Arjun" },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
          attestation: "none",
        },
      })) as PublicKeyCredential;
      const att = cred.response as AuthenticatorAttestationResponse;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const got = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: "localhost",
          allowCredentials: [{ type: "public-key", id: cred.rawId, transports: ["internal"] }],
          userVerification: "required",
        },
      })) as PublicKeyCredential;
      const a = got.response as AuthenticatorAssertionResponse;
      return {
        alg: att.getPublicKeyAlgorithm(),
        spki: b64(att.getPublicKey()!),
        createFlags: new Uint8Array(att.getAuthenticatorData())[32]!,
        authenticatorData: b64(a.authenticatorData),
        clientDataJSON: b64(a.clientDataJSON),
        signature: b64(a.signature),
        challenge: b64(challenge.buffer),
      };
    });

    expect(result.alg).toBe(-7);
    expect(result.createFlags & 0x04).toBe(0x04); // UV at creation
    const authData = Buffer.from(result.authenticatorData, "base64");
    expect(authData[32]! & 0x05).toBe(0x05); // UP and UV on the assertion
    expect(authData.subarray(0, 32)).toEqual(createHash("sha256").update("localhost").digest());
    const clientData = JSON.parse(Buffer.from(result.clientDataJSON, "base64").toString("utf8"));
    expect(clientData.type).toBe("webauthn.get");
    expect(Buffer.from(clientData.challenge, "base64url")).toEqual(Buffer.from(result.challenge, "base64"));

    const key = createPublicKey({ key: Buffer.from(result.spki, "base64"), format: "der", type: "spki" });
    const signed = Buffer.concat([
      authData,
      createHash("sha256").update(Buffer.from(result.clientDataJSON, "base64")).digest(),
    ]);
    expect(verify("sha256", signed, { key, dsaEncoding: "der" }, Buffer.from(result.signature, "base64"))).toBe(true);
    expect(await authenticator.credentials()).toHaveLength(1);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
