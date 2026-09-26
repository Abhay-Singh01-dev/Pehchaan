// Starts real relay processes (in this test process, D-016) against real Valkey and Postgres, each test file
// isolated by its own key prefix and schema (D-018).
import { Writable } from "node:stream";
import { loadConfig } from "../../src/config";
import { createRelay, type Relay, type RelayOptions } from "../../src/relay";
import { createStore, runMigrations } from "../../src/store/db";
import { DATABASE_URL, REDIS_URL } from "./env";
import { isolate, type Isolation } from "./isolation";

export const ORIGIN = "http://app.test";
export const RELAY_HOST = "relay.test";

export interface Env {
  iso: Isolation;
  relays: Relay[];
  /** Every log line written by every relay (REL-22). */
  logs: string[];
  env: Record<string, string>;
  start(extra?: Record<string, string>, o?: RelayOptions): Promise<Relay>;
  cleanup(): Promise<void>;
}

export async function setupRelays(
  name: string,
  opts: { count?: number; env?: Record<string, string>; options?: RelayOptions } = {},
): Promise<Env> {
  const iso = await isolate(name);
  const migrator = createStore({ url: DATABASE_URL, schema: iso.schema, max: 1 });
  await runMigrations(migrator, iso.schema);
  await migrator.close();
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const env: Record<string, string> = {
    ENV_NAME: "test",
    PORT: "0",
    METRICS_PORT: "0",
    BIND_HOST: "127.0.0.1",
    RELAY_HOST,
    PUBLIC_ORIGINS: ORIGIN,
    REDIS_URL,
    DATABASE_URL,
    PG_SCHEMA: iso.schema,
    KEY_PREFIX: iso.keyPrefix,
    LOG_LEVEL: "debug",
    DRAIN_SETTLE_MS: "200",
    DRAIN_TIMEOUT_MS: "1500",
    ...opts.env,
  };
  const relays: Relay[] = [];
  const start = async (extra: Record<string, string> = {}, o: RelayOptions = opts.options ?? {}) => {
    const r = await createRelay(loadConfig({ ...env, ...extra }), { logDestination: sink, ...o });
    relays.push(r);
    return r;
  };
  for (let i = 0; i < (opts.count ?? 1); i++) await start();
  return {
    iso,
    relays,
    logs,
    env,
    start,
    async cleanup() {
      await Promise.allSettled(relays.map((r) => r.stop()));
      await iso.cleanup();
    },
  };
}

export { REDIS_URL };
