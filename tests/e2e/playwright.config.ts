import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end journeys against the REAL relay (spec 21.3, Part E group J). Each phone is its own browser context
// with its own virtual WebAuthn authenticator (fixtures/webauthn.ts): real passkeys, the real verifier, real
// end-to-end sealing, through a relay backed by the dev Valkey and Postgres.
//   pnpm db:up && pnpm test:e2e:real
//   PW_CHANNEL=msedge pnpm test:e2e:real      (use an installed Edge/Chrome instead of Playwright's Chromium)
// The app runs with real keys at rpId "localhost" (a secure context). Ports differ from the simulated
// walkthrough (apps/web, :5180) so the two setups can never be mixed up. The relay keeps its data in its own
// Postgres schema and Valkey key prefix (e2e), apart from `pnpm dev`.
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5181);
export const RELAY_PORT = Number(process.env.E2E_RELAY_PORT ?? 8081);
/** The local stand-in push service (apps/relay/test/helpers/mock-push.ts) that J-06 starts; the relay sends every
 *  push there (PUSH_TEST_TARGET, allowed only with ENV_NAME=test). */
export const MOCK_PUSH_PORT = Number(process.env.E2E_MOCK_PUSH_PORT ?? 8095);
const WEB = `http://localhost:${WEB_PORT}`;
const E2E_REQUIRED = process.env.E2E_REQUIRED === "true";

/** A throwaway VAPID key pair for this run (never a real environment's): P-256, raw public point + private scalar. */
function vapidPair() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d! };
}
const VAPID = vapidPair();

/** The Security Lab password of this local test environment only (never a real one). The relay gets its Argon2id
 *  hash, made by the same script the team uses (infra/scripts/lab-password-hash.ts). */
export const LAB_PASSWORD = "e2e security lab password";
const LAB_PASSWORD_HASH = execFileSync(process.execPath, ["--import", "tsx", "infra/scripts/lab-password-hash.ts"], {
  cwd: join(import.meta.dirname, "..", ".."),
  input: `${LAB_PASSWORD}\n`,
  encoding: "utf8",
}).trim();

/** Every WebSocket frame the test relay receives and sends (J-16: tests/e2e/privacy.spec.ts scans them). */
export const FRAMES_FILE = join(tmpdir(), "pehchaan-e2e-frames.jsonl");

/** The relay's settings, also used by the tests that run its admin CLI (`admin lab on`). */
export const RELAY_ENV = {
  ENV_NAME: "test",
  PORT: String(RELAY_PORT),
  METRICS_PORT: String(RELAY_PORT + 1011),
  BIND_HOST: "127.0.0.1",
  RELAY_HOST: `localhost:${RELAY_PORT}`,
  PUBLIC_ORIGINS: WEB,
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://pehchaan:pehchaan-dev@127.0.0.1:5432/pehchaan",
  PG_SCHEMA: "e2e",
  KEY_PREFIX: "e2e:",
  E2E_REQUIRED: String(E2E_REQUIRED),
  // E2E_RELAY_LOG=info shows the relay's log (e.g. the Security Lab's steps) in the Playwright output.
  LOG_LEVEL: process.env.E2E_RELAY_LOG ?? "warn",
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
  VAPID_KEY_ID: "v1",
  PUSH_TEST_TARGET: `http://127.0.0.1:${MOCK_PUSH_PORT}`,
  // The Security Lab module is loaded (it stays off until `admin lab on`, 14.1), for J-12.
  LAB_ENABLED: "true",
  LAB_PASSWORD_HASH,
  // J-12 runs 50 checks between the same two phones in a few minutes; the per-pair limit (3 a minute) would
  // stop it. Every limit is still enforced, at 100 times the rate (never allowed in production).
  RATE_LIMIT_PROFILE: "relaxed",
  FRAME_CAPTURE_FILE: FRAMES_FILE,
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./warm-up.ts",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    channel: process.env.PW_CHANNEL || undefined,
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
    // Every "phone" here is a window on one machine, and only one is in front. After 5 minutes Chrome slows the
    // timers of the others to once a minute (intensive wake-up throttling), which real phones, each its own
    // foreground app, never see; long journeys (J-12) then crawl. Switched off for the test browsers only.
    launchOptions: {
      args: ["--disable-features=IntensiveWakeUpThrottling", "--disable-background-timer-throttling"],
    },
  },
  webServer: [
    {
      command: "pnpm --filter @pehchaan/relay exec tsx src/main.ts",
      url: `http://127.0.0.1:${RELAY_PORT}/readyz`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 120_000,
      stdout: process.env.E2E_RELAY_LOG ? "pipe" : "ignore",
      stderr: "pipe",
      env: RELAY_ENV,
    },
    {
      command: `pnpm --filter @pehchaan/web exec vite --port ${WEB_PORT} --strictPort --mode e2e`,
      url: WEB,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        VITE_SIM_RELAY: "false",
        VITE_SIM_KEY: "false",
        VITE_SIM_VERIFIER: "false",
        VITE_ENV: "test",
        VITE_ORIGIN: WEB,
        VITE_RP_ID: "localhost",
        VITE_RELAY_URL: `ws://localhost:${RELAY_PORT}/v1/ws`,
        VITE_ENABLE_LAB: "true",
        VITE_ENABLE_GUARD: "true",
        VITE_VAPID_PUBLIC_KEY: VAPID.publicKey,
        VITE_VAPID_KEY_ID: "v1",
      },
    },
  ],
});
