// Postgres access: one pool per relay process, Drizzle on top. Postgres is off the hot path, behind
// 10-minute caches (15.5), and most of what it holds rebuilds itself from phones (15.4).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface Store {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

/** The migrations folder: apps/relay/migrations, reached from src/store/ in development and from dist/ in the
 *  image (the bundle flattens everything into dist/). */
const migrationsDir = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith("store") ? join(here, "..", "..", "migrations") : join(here, "..", "migrations");
};

export function createStore(opts: { url: string; schema: string; max?: number }): Store {
  const pool = new pg.Pool({
    connectionString: opts.url,
    max: opts.max ?? 10,
    // Tables live in PG_SCHEMA (tests give each file its own, D-018).
    options: `-c search_path=${opts.schema}`,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
  });
  // A connection that errors while idle must not crash the process; the next query reconnects.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}

/** Applies every committed migration, in order, recording them in PG_SCHEMA.__drizzle_migrations. */
export async function runMigrations(store: Store, pgSchema: string): Promise<void> {
  await migrate(store.db, { migrationsFolder: migrationsDir(), migrationsSchema: pgSchema });
}
