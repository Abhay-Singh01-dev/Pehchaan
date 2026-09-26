import { describe, expect, it } from "vitest";
import { CRYPTO_VERSION } from "../src/index";

describe("crypto package", () => {
  it("exports its version", () => {
    expect(CRYPTO_VERSION).toBe(1);
  });
});
