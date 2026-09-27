// The relay process. Configuration is validated first; an invalid value stops the relay before it listens
// (REL-20). SIGTERM drains (18.9): `docker compose up -d` waits up to 40 s, the drain takes at most 26 s.
import { ConfigError, loadConfig, type Config } from "./config";
import { createRelay } from "./relay";
import { initSentry } from "./sentry";
import { createStore, runMigrations } from "./store/db";

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

// Deploys run migrations as their own step before a new version starts (15.2, deploy.sh). On a laptop the
// relay applies them itself, so `pnpm dev` just works.
if (config.ENV_NAME === "development" || config.ENV_NAME === "test") {
  const store = createStore({ url: config.DATABASE_URL, schema: config.PG_SCHEMA, max: 1 });
  try {
    await runMigrations(store, config.PG_SCHEMA);
  } finally {
    await store.close();
  }
}

// Error reports first, so a failure while starting is reported too (scrubbed, 16.7).
await initSentry({ dsn: config.SENTRY_DSN, env: config.ENV_NAME, release: config.RELEASE });

const relay = await createRelay(config);

let draining = false;
const shutdown = (signal: string) => {
  if (draining) return;
  draining = true;
  relay.hub.log.info({ signal }, "shutdown requested");
  relay
    .drain()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
