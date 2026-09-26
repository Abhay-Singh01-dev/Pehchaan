import { defineConfig } from "vitest/config";

// packages/protocol: 100% line and branch coverage (spec B1).
export default defineConfig({
  test: {
    name: "protocol",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
