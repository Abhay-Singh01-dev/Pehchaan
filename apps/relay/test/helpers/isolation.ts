// Test isolation (D-018): each integration test file gets
//   - its own KEY_PREFIX, used by the relay for every Valkey key AND every pub/sub channel, and
//   - its own Postgres schema, which the relay reaches through `search_path`.
// So test files run in parallel against one Valkey and one Postgres without seeing each other.
import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import pg from "pg";
import { DATABASE_URL, REDIS_URL } from "./env";

export interface Isolation {
  keyPrefix: string;
  schema: string;
  redisUrl: string;
  databaseUrl: string;
  redis: Redis;
  pool: pg.Pool;
  /** Every key under this file's prefix. */
  keys(): Promise<string[]>;
  /** Tables in this file's schema. */
  tables(): Promise<string[]>;
  /** Removes every key under the prefix and drops the schema. */
  cleanup(): Promise<void>;
}

export async function isolate(name: string): Promise<Isolation> {
  const id = `${name
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 20)}_${randomBytes(4).toString("hex")}`;
  const keyPrefix = `t:${id}:`;
  const schema = `t_${id}`;

  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await admin.query(`create schema "${schema}"`);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, options: `-c search_path="${schema}"` });

  const keys = async () => {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", `${keyPrefix}*`, "COUNT", 500);
      cursor = next;
      out.push(...batch);
    } while (cursor !== "0");
    return out;
  };

  return {
    keyPrefix,
    schema,
    redisUrl: REDIS_URL,
    databaseUrl: withSearchPath(DATABASE_URL, schema),
    redis,
    pool,
    keys,
    async tables() {
      const r = await admin.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = $1 order by table_name",
        [schema],
      );
      return r.rows.map((row) => row.table_name);
    },
    async cleanup() {
      const all = await keys();
      for (let i = 0; i < all.length; i += 500) await redis.del(...all.slice(i, i + 500));
      await pool.end();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
      redis.disconnect();
    },
  };
}

/** A DATABASE_URL whose connections use the given schema first. */
export function withSearchPath(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  return u.toString();
}
