// docs/RUNBOOKS.md (spec 24) is only useful if its commands are right on the night. This checks every command
// against the files it names: compose services, admin commands, scripts and paths, and that every alert's runbook
// link lands on a section. (The commands themselves are exercised by `pnpm test:ops`: deploy.sh, the rollback,
// backup.sh, restore.sh, the admin CLI and infra/grafana/import.mjs.)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const runbooks = read("docs/RUNBOOKS.md");

const services = new Set([...read("infra/vm/compose.yml").matchAll(/^ {2}([a-z][a-z0-9-]*):/gm)].map((m) => m[1]!));
const adminCommands = new Set([...read("apps/relay/src/admin.ts").matchAll(/case "([a-z]+)":/g)].map((m) => m[1]!));

describe("docs/RUNBOOKS.md", () => {
  it("has a section for every alert's runbook link", () => {
    const alerts = JSON.parse(read("infra/grafana/alerts.json")) as {
      groups: Array<{ rules: Array<{ annotations: { runbook: string } }> }>;
    };
    const anchors = new Set([...runbooks.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((m) => m[1]!));
    for (const rule of alerts.groups.flatMap((g) => g.rules)) {
      const [file, anchor] = rule.annotations.runbook.split("#");
      expect(file).toBe("docs/RUNBOOKS.md");
      expect(anchors, anchor).toContain(anchor);
    }
  });

  it("names only services that exist in infra/vm/compose.yml", () => {
    const used = [
      ...runbooks.matchAll(
        /docker compose (?:exec(?: -T)?|logs(?: --tail \d+)?|restart|up -d(?: --wait| --no-deps)*|stop|start|run --rm --no-deps) ([a-z][a-z0-9 -]*?)(?= node| sh| psql| \/opt| rclone| cat|`|$)/gm,
      ),
    ].flatMap((m) => m[1]!.trim().split(/\s+/));
    expect(used.length).toBeGreaterThan(10);
    for (const svc of used) expect(services, svc).toContain(svc);
  });

  it("uses only admin commands the relay has", () => {
    const used = [...runbooks.matchAll(/node dist\/admin\.js ([a-z]+)/g)].map((m) => m[1]!);
    expect(used).toEqual(expect.arrayContaining(["block", "retire", "stats", "lab", "retention"]));
    for (const c of used) expect(adminCommands, c).toContain(c);
  });

  it("points at files that exist", () => {
    const paths = [...runbooks.matchAll(/`((?:infra|docs|apps|scripts)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it("runs the scripts where the images put them", () => {
    for (const s of ["/opt/backup/backup.sh", "/opt/backup/restore.sh", "/opt/pehchaan/deploy.sh"]) {
      expect(runbooks).toContain(s);
    }
    expect(read("infra/docker/Dockerfile.backup")).toContain("/opt/backup/");
  });
});
