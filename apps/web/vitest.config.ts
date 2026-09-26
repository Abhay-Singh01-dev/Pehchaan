import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the service layer (verifier, cards, relay client, guard rules, words). Runs in Node with an
// in-memory IndexedDB (fake-indexeddb) and Node's built-in WebCrypto, which is never mocked.
// Coverage thresholds for services/real come from spec B1.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/services/real/**/*.ts"],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
