// The images the ops tests deploy, built from this checkout with the real Dockerfiles:
//   ops-a  the relay and backup images as CI builds them;
//   ops-b  the same relay plus one extra expand-only migration (a table only ops-b knows), so a deploy from a to b
//          proves migrations run during a deploy, and a deploy back to a proves the rollback works (OPS-04).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker } from "./sh";
import { REGISTRY, REPO, STACK_DIR, TAG_A, TAG_B } from "./stack";

export const relayImage = (tag: string) => `${REGISTRY}/pehchaan-relay:${tag}`;
export const backupImage = (tag: string) => `${REGISTRY}/pehchaan-backup:${tag}`;
/** The table ops-b's migration adds. */
export const PROBE_TABLE = "ops_probe";

const build = (dockerfile: string, tag: string) =>
  docker(["build", "--file", join(REPO, "infra", "docker", dockerfile), "--tag", tag, REPO], {
    timeoutMs: 30 * 60_000,
  });

export async function buildImages(): Promise<void> {
  await Promise.all([build("Dockerfile.relay", relayImage(TAG_A)), build("Dockerfile.backup", backupImage(TAG_A))]);

  // ops-b: one more migration, added to the journal the way drizzle-kit would add it.
  const dir = join(STACK_DIR, "..", "pehchaan-ops-image-b");
  mkdirSync(dir, { recursive: true });
  const journal = JSON.parse(readFileSync(join(REPO, "apps", "relay", "migrations", "meta", "_journal.json"), "utf8"));
  const last = journal.entries.at(-1);
  const tag = `${String(last.idx + 1).padStart(4, "0")}_ops_probe`;
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: Date.now(), tag, breakpoints: true });
  writeFileSync(join(dir, "_journal.json"), JSON.stringify(journal, null, 2));
  writeFileSync(join(dir, `${tag}.sql`), `CREATE TABLE IF NOT EXISTS "${PROBE_TABLE}" ("id" integer PRIMARY KEY);\n`);
  writeFileSync(
    join(dir, "Dockerfile"),
    [
      `FROM ${relayImage(TAG_A)}`,
      `COPY --chown=node:node ${tag}.sql /app/migrations/`,
      `COPY --chown=node:node _journal.json /app/migrations/meta/`,
      "",
    ].join("\n"),
  );
  await docker(["build", "--tag", relayImage(TAG_B), dir], { timeoutMs: 5 * 60_000 });
  await docker(["tag", backupImage(TAG_A), backupImage(TAG_B)]);
}
