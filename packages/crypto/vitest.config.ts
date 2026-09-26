import { defineConfig } from "vitest/config";

// packages/crypto: 100% line and branch coverage (spec B1). Runs on Node's built-in WebCrypto;
// nothing here is ever mocked (CLAUDE.md).
export default defineConfig({
  test: {
    name: "crypto",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bip39-english.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
