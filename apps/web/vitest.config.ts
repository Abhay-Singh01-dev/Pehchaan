import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the service layer (verifier, cards, guard rules, words). Runs in Node with an
// in-memory IndexedDB (fake-indexeddb) and Node's built-in Web Crypto.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
  },
});
