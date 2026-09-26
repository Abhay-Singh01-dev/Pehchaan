import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes a new SQL migration into ./migrations from src/store/schema.ts.
// Migrations are committed and expand-only between releases (15.2); scripts/check-migrations.mjs rejects
// destructive statements unless the file is marked as a contract step.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/store/schema.ts",
  out: "./migrations",
});
