// Where the integration tests find Valkey and Postgres. Locally: `pnpm db:up`
// (infra/compose/docker-compose.dev.yml). In CI: the service containers of .github/workflows/ci.yml.
export const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://pehchaan:pehchaan-dev@127.0.0.1:5432/pehchaan";
