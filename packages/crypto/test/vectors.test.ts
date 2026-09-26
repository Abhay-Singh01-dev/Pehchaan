// CRY-02: the spec 10.2 test vectors reproduce exactly.
import { describe, expect, it } from "vitest";
import { b64url, sha256, utf8 } from "../src/bytes";
import { canonicalRequest, challengeFor } from "../src/canonical";
import vectors from "./vectors.json";

describe("CRY-02 · spec 10.2 vectors", () => {
  it("canonical(A) and both challenges for A", async () => {
    expect(canonicalRequest(vectors.requestA)).toBe(vectors.canonicalA);
    expect(b64url(await challengeFor(vectors.requestA, "ME"))).toBe(vectors.challengeA_ME);
    expect(b64url(await challengeFor(vectors.requestA, "NOT_ME"))).toBe(vectors.challengeA_NOT_ME);
  });

  it("canonical(B) (Devanagari label, no reason, no amount) and both challenges for B", async () => {
    expect(canonicalRequest(vectors.requestB)).toBe(vectors.canonicalB);
    expect(b64url(await challengeFor(vectors.requestB, "ME"))).toBe(vectors.challengeB_ME);
    expect(b64url(await challengeFor(vectors.requestB, "NOT_ME"))).toBe(vectors.challengeB_NOT_ME);
  });

  it("rpIdHash of app.yourdomain.in", async () => {
    expect(b64url(await sha256(utf8(vectors.rpId)))).toBe(vectors.rpIdHash);
  });
});
