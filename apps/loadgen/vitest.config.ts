import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "loadgen", include: ["test/**/*.test.ts"], passWithNoTests: true },
});
