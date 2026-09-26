// C-10.9a · "Reset used request numbers" is hidden in production (backend spec 10.9, FC-20). The Test environment's
// Diagnostics screen shows it (tests/e2e/states.spec.ts › FC-20 runs with VITE_ENV=test).
import { describe, expect, it } from "vitest";
import { mayResetUsedNonces } from "@/screens/diagnostics/rules";

describe("Diagnostics tools", () => {
  it("never offers resetting used request numbers in production", () => {
    expect(mayResetUsedNonces("production")).toBe(false);
  });

  it("offers it in development and the Test environment, where replays are staged on purpose", () => {
    expect(mayResetUsedNonces("development")).toBe(true);
    expect(mayResetUsedNonces("test")).toBe(true);
    expect(mayResetUsedNonces("staging")).toBe(true);
  });
});
