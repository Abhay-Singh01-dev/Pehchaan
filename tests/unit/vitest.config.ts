import { defineConfig } from "vitest/config";

// Unit tests for the repository's own check scripts (scripts/*.mjs): they guard the gate, so they are tested
// like any other code. They run the scripts as child processes against throwaway git repositories.
export default defineConfig({
  test: {
    name: "scripts",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    testTimeout: 30_000,
  },
});
