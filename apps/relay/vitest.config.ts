import { defineConfig } from "vitest/config";

// Relay unit tests (pure logic: config parsing, Lua file shape, frame building). The behaviour tests run
// against real Valkey and Postgres in vitest.integration.config.ts.
export default defineConfig({
  test: {
    name: "relay",
    include: ["test/unit/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/config.ts", "src/core/frame.ts"],
      reportsDirectory: "coverage/unit",
    },
  },
});
