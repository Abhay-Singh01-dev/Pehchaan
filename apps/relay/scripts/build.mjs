// Builds the relay into dist/ with esbuild. The workspace packages (@pehchaan/protocol, @pehchaan/crypto)
// are bundled in from source; every npm dependency stays external and is installed in the image by
// `pnpm deploy --prod` (infra/docker/Dockerfile.relay).
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const external = Object.keys(pkg.dependencies ?? {});

const entries = ["main", "admin", "migrate"].map((n) => join(root, "src", `${n}.ts`)).filter((p) => existsSync(p));

rmSync(join(root, "dist"), { recursive: true, force: true });
await build({
  entryPoints: entries,
  outdir: join(root, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  // Lua scripts and SQL migrations are read from disk at runtime; they're copied next to dist/ by the Dockerfile.
  logLevel: "warning",
  banner: {
    // ESM bundles have no require(); a few CommonJS dependencies expect it.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log(`relay built: ${entries.length} entry point(s)`);
