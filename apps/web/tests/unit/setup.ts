// Test environment: an in-memory IndexedDB and a stable origin for the "address" check.
import "fake-indexeddb/auto";

Object.defineProperty(globalThis, "location", {
  value: new URL("https://pehchaan.test/"),
  configurable: true,
});
