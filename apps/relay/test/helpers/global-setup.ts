// Fails fast, with a clear message, when Valkey or Postgres isn't running (instead of 60 s timeouts in
// every test). Integration tests never fall back to fakes (CLAUDE.md).
import { Redis } from "ioredis";
import pg from "pg";
import { DATABASE_URL, REDIS_URL } from "./env";

export default async function setup() {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000 });
  try {
    await redis.connect();
    await redis.ping();
  } catch (e) {
    throw new Error(`Valkey is not reachable at ${REDIS_URL}. Start it with \`pnpm db:up\`.`, { cause: e });
  } finally {
    redis.disconnect();
  }
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (e) {
    throw new Error(`Postgres is not reachable at ${DATABASE_URL}. Start it with \`pnpm db:up\`.`, { cause: e });
  } finally {
    await client.end().catch(() => {});
  }
}
