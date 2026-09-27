import { defineConfig } from "vitest/config";

// `pnpm test:ops` (spec Part E, group OPS): Docker images, the production compose stack on this machine, the linters
// and Grafana's own validation. One file at a time: the stack owns ports 80 and 443 and one Docker project.
export default defineConfig({
  test: {
    name: "ops",
    root: import.meta.dirname,
    include: ["**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 45 * 60_000,
    // Failures print the command output; never retry an ops test into a pass.
    retry: 0,
  },
});
