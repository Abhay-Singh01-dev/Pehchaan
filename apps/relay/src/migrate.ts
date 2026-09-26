// Runs the committed migrations, then exits. Deploys run this BEFORE the new relay version starts (15.2):
//   docker compose run --rm --no-deps relay-a node dist/migrate.js
import { loadConfig } from "./config";
import { createStore, runMigrations } from "./store/db";

const config = loadConfig();
const store = createStore({ url: config.DATABASE_URL, schema: config.PG_SCHEMA, max: 1 });
try {
  await runMigrations(store, config.PG_SCHEMA);
  console.error(`migrations applied (schema ${config.PG_SCHEMA})`);
} finally {
  await store.close();
}
