import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the Part D walkthrough, in simulation mode, against the dev server.
// Each test gets a fresh browser context (fresh IndexedDB), so the seeded tabs start clean.
//   npm run e2e                     (bundled Chromium: run `npx playwright install chromium` once)
//   PW_CHANNEL=msedge npm run e2e   (use an installed Edge / Chrome instead)
// It starts its own server on its own port, fully simulated whatever .env.local says, so it can never test a
// different app that happens to be running on the usual dev port. The real-backend journeys are tests/e2e.
const PORT = Number(process.env.SIM_E2E_PORT ?? 5190);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SIM_RELAY: "true",
      VITE_SIM_KEY: "true",
      VITE_SIM_VERIFIER: "true",
      VITE_ENABLE_LAB: "true",
      VITE_ENABLE_GUARD: "true",
    },
  },
});
