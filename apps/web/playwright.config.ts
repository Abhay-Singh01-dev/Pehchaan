import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the Part D walkthrough, in simulation mode, against the dev server.
// Each test gets a fresh browser context (fresh IndexedDB), so the seeded tabs start clean.
//   npm run e2e                     (bundled Chromium: run `npx playwright install chromium` once)
//   PW_CHANNEL=msedge npm run e2e   (use an installed Edge / Chrome instead)
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5180",
    channel: process.env.PW_CHANNEL || undefined,
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --port 5180 --strictPort",
    url: "http://localhost:5180",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
