import { defineConfig } from "vitest/config";

// Relay integration tests: real relay processes against real Valkey 8 and Postgres 16
// (`pnpm db:up`, or the CI service containers). Every test file gets its own Valkey key prefix
// and its own Postgres schema (test/helpers), so files run in parallel without seeing each other.
// Coverage thresholds from spec B1 apply to core, ws, push and lab.
export default defineConfig({
  test: {
    name: "relay-integration",
    include: ["test/**/*.int.test.ts"],
    globalSetup: ["test/helpers/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/ws/**/*.ts", "src/push/**/*.ts", "src/lab/**/*.ts"],
      // Measured from the phase that builds them (the gate counts "the code built so far", Part D).
      exclude: [
        "src/push/**", // Phase 6
        "src/lab/**", // Phase 7
        "src/ws/handlers/push.ts", // Phase 6
        "src/ws/handlers/lab.ts", // Phase 7
        "src/core/retire.ts", // Phase 4
      ],
      reportsDirectory: "coverage/integration",
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
