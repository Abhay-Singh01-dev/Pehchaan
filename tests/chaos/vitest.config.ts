import { defineConfig } from "vitest/config";

// `pnpm test:chaos` (spec 21.5, Part E group CHAOS): failures injected into the production stack on this machine while
// checks are in progress. It shares the ops stack's Docker project and ports, so never run it alongside `test:ops`.
export default defineConfig({
  test: {
    name: "chaos",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 45 * 60_000,
    retry: 0,
  },
});
