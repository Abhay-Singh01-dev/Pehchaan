// The software authenticator produces answers in the passkey wire format that the verifier accepts.
import { describe, expect, it } from "vitest";
import { b64urlDecode } from "../src/bytes";
import { parseAuthData } from "../src/authdata";
import { createSoftCredential, softAnswer, softAssert } from "../src/soft-authenticator";
import { verifyAnswer } from "../src/verifier";
import vectors from "./vectors.json";

describe("software authenticator", () => {
  it("creates a credential with a 16-byte ID and a raw P-256 public key", async () => {
    const c = await createSoftCredential();
    expect(b64urlDecode(c.credId)).toHaveLength(16);
    const pub = b64urlDecode(c.publicKey);
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(4);
    expect(c.privateKey.extractable).toBe(false);
  });

  it("signs an answer that passes all 7 checks", async () => {
    const c = await createSoftCredential();
    const ans = await softAnswer({
      req: vectors.requestA,
      decision: "NOT_ME",
      credId: c.credId,
      privateKey: c.privateKey,
      rpId: "app.yourdomain.in",
      origin: "https://app.yourdomain.in",
      answeredAt: 5,
    });
    expect(ans.answeredAt).toBe(5);
    const r = await verifyAnswer({
      req: vectors.requestA,
      ans,
      envFrom: vectors.requestA.toDeviceId,
      member: { deviceId: vectors.requestA.toDeviceId, credId: c.credId, passkeyPub: c.publicKey },
      expected: { origin: "https://app.yourdomain.in", rpId: "app.yourdomain.in" },
      receivedAt: vectors.requestA.createdAt + 5000,
      isNonceUsed: async () => false,
    });
    expect(r.verdict).toBe("DENIED");
  });

  it("honours flags, type and crossOrigin overrides", async () => {
    const c = await createSoftCredential();
    const a = await softAssert({
      privateKey: c.privateKey,
      rpId: "x.test",
      origin: "https://x.test",
      challenge: new Uint8Array(32),
      flags: 0x01,
      type: "webauthn.create",
      crossOrigin: true,
    });
    expect(parseAuthData(b64urlDecode(a.authenticatorData)).uv).toBe(false);
    const cd = JSON.parse(new TextDecoder().decode(b64urlDecode(a.clientDataJSON)));
    expect(cd).toMatchObject({ type: "webauthn.create", crossOrigin: true, origin: "https://x.test" });
    const noUv = await softAnswer({
      req: vectors.requestA,
      decision: "ME",
      credId: c.credId,
      privateKey: c.privateKey,
      rpId: "x.test",
      origin: "https://x.test",
      flags: 0x01,
    });
    expect(parseAuthData(b64urlDecode(noUv.authenticatorData)).uv).toBe(false);
    expect(noUv.answeredAt).toBeGreaterThan(0);
  });
});
