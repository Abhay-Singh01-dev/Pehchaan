import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "canary", include: ["test/**/*.test.ts"], passWithNoTests: true },
});
