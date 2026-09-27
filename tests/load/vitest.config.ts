import { defineConfig } from "vitest/config";

// `pnpm test:load:short` (spec 21.4, LOAD-01 … LOAD-03 shortened) against the local production stack, each relay
// limited to 1 CPU. It shares the ops stack's Docker project and ports: never run it alongside test:ops or test:chaos.
export default defineConfig({
  test: {
    name: "load",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 45 * 60_000,
    retry: 0,
  },
});
