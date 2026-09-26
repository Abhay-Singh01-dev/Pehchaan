import { defineConfig, devices } from "@playwright/test";

// End-to-end journeys against the REAL relay (spec 21.3, Part E group J). Each test opens three browser
// contexts (Maa, Arjun, Papa or the Lab), each with its own virtual WebAuthn authenticator
// (fixtures/webauthn.ts), talking through a relay backed by the dev Valkey and Postgres.
//   pnpm db:up && pnpm test:e2e:real
//   PW_CHANNEL=msedge pnpm test:e2e:real      (use an installed Edge/Chrome instead of Playwright's Chromium)
// The app runs with real keys at rpId "localhost" (a secure context). Ports differ from the simulated
// walkthrough (apps/web, :5180) so the two servers can never be mixed up.
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5181);
export const RELAY_PORT = Number(process.env.E2E_RELAY_PORT ?? 8081);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @pehchaan/web exec vite --port ${WEB_PORT} --strictPort --mode e2e`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
