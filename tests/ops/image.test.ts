// OPS-07 (spec 18.5): the relay and backup images are built for linux/arm64 (the Oracle VMs) and linux/amd64 from
// the same Dockerfiles, and the arm64 relay really boots: under QEMU, it runs its migrations against Postgres,
// connects to Valkey and reports ready. The arm64 backup image has working pg_dump, age, rclone and supercronic.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docker, ok, run, sleep } from "./lib/sh";
import { REPO } from "./lib/stack";

const PLATFORMS = ["linux/amd64", "linux/arm64"];
const RELAY = "local/pehchaan-relay:ops-multi";
const BACKUP = "local/pehchaan-backup:ops-multi";
const DEV_COMPOSE = join(REPO, "infra", "compose", "docker-compose.dev.yml");
const DEV_NETWORK = "pehchaan-dev_default";
const SCHEMA = "ops_arm64";
const BOOTED = "pehchaan-ops-arm64";

const buildMulti = (dockerfile: string, tag: string) =>
  docker(
    [
      "buildx",
      "build",
      "--platform",
      PLATFORMS.join(","),
      "--file",
      join(REPO, "infra", "docker", dockerfile),
      "--tag",
      tag,
      "--load",
      REPO,
    ],
    { timeoutMs: 45 * 60_000 },
  );

const devPsql = (sql: string) =>
  docker([
    "compose",
    "-f",
    DEV_COMPOSE,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "pehchaan",
    "-d",
    "pehchaan",
    "-c",
    sql,
  ]);

beforeAll(async () => {
  // QEMU for arm64 in Docker's VM (what docker/setup-qemu-action does in CI). Idempotent.
  await docker(["run", "--privileged", "--rm", "tonistiigi/binfmt:qemu-v10.0.4", "--install", "arm64"]);
  await docker(["compose", "-f", DEV_COMPOSE, "up", "-d", "--wait"], { timeoutMs: 5 * 60_000 });
  await Promise.all([buildMulti("Dockerfile.relay", RELAY), buildMulti("Dockerfile.backup", BACKUP)]);
});

afterAll(async () => {
  await run("docker", ["rm", "-f", BOOTED]);
  await devPsql(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
});

describe("OPS-07 · multi-arch images", () => {
  it.each([RELAY, BACKUP])("%s has a linux/amd64 and a linux/arm64 image", async (image) => {
    for (const platform of PLATFORMS) {
      const arch = await ok("docker", [
        "image",
        "inspect",
        "--platform",
        platform,
        "--format",
        "{{.Os}}/{{.Architecture}}",
        image,
      ]);
      expect(arch.trim()).toBe(platform);
    }
  });

  it("the relay image runs as the unprivileged node user, with its migrations, Lua scripts and retention SQL", async () => {
    expect(
      (
        await ok("docker", ["image", "inspect", "--platform", "linux/amd64", "--format", "{{.Config.User}}", RELAY])
      ).trim(),
    ).toBe("node");
    const files = await ok("docker", [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--entrypoint",
      "sh",
      RELAY,
      "-c",
      "ls dist/main.js dist/admin.js dist/migrate.js retention.sql && ls lua | head -n 1 && ls migrations/meta",
    ]);
    expect(files).toContain("retention.sql");
    expect(files).toContain("_journal.json");
  });

  it("the arm64 backup image has working pg_dump, age, rclone and supercronic", async () => {
    const out = await ok(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        "linux/arm64",
        BACKUP,
        "sh",
        "-c",
        "uname -m && pg_dump --version && age --version && rclone version | head -n 1 && supercronic -version 2>&1 | head -n 1",
      ],
      { timeoutMs: 5 * 60_000 },
    );
    expect(out).toMatch(/^aarch64/);
    expect(out).toMatch(/pg_dump \(PostgreSQL\) 16\./);
    expect(out).toMatch(/rclone v1\./);
  });

  it("the arm64 relay boots under QEMU: migrations, Valkey, Postgres, ready", async () => {
    await devPsql(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`);
    const hex = () => randomBytes(32).toString("hex");
    const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const env = {
      ENV_NAME: "staging",
      RELAY_HOST: "relay.pehchaan.test",
      PUBLIC_ORIGINS: "https://app.pehchaan.test",
      REDIS_URL: "redis://valkey:6379",
      DATABASE_URL: "postgres://pehchaan:pehchaan-dev@postgres:5432/pehchaan",
      PG_SCHEMA: SCHEMA,
      KEY_PREFIX: "ops-arm64:",
      AUDIT_KEY: hex(),
      IP_HASH_KEY: hex(),
      VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url"),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d!,
    };
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
    const arm = ["--platform", "linux/arm64", "--network", DEV_NETWORK, ...envArgs];

    const migrated = await run("docker", ["run", "--rm", ...arm, RELAY, "node", "dist/migrate.js"], {
      timeoutMs: 5 * 60_000,
    });
    expect(migrated.code, migrated.stderr).toBe(0);
    expect(migrated.stderr).toContain(`migrations applied (schema ${SCHEMA})`);

    await run("docker", ["rm", "-f", BOOTED]);
    await docker(["run", "-d", "--name", BOOTED, ...arm, RELAY]);
    const ready = "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))";
    let isReady = false;
    for (let i = 0; i < 120 && !isReady; i++) {
      isReady = (await run("docker", ["exec", BOOTED, "node", "-e", ready])).code === 0;
      if (!isReady) await sleep(1000);
    }
    const logs = await run("docker", ["logs", "--tail", "20", BOOTED]);
    expect(isReady, `${logs.stdout}\n${logs.stderr}`).toBe(true);
    expect((await ok("docker", ["exec", BOOTED, "uname", "-m"])).trim()).toBe("aarch64");
  });
});
