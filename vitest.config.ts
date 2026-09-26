// Root Vitest entry: runs every package's unit project together (`pnpm test:watch`, and the
// `vitest related` hook in scripts/claude/test-related.mjs). Each project keeps its own config and
// coverage thresholds; integration suites have separate configs and run with `pnpm test:integration`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
  },
});
