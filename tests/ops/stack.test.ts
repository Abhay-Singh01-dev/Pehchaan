// The production stack on this machine (spec Phase 10, Part E group OPS): the real infra/vm files and images
// built from this checkout, deployed with the real deploy.sh, reached through Caddy over HTTPS (its internal CA).
// One stack for the whole file; the tests run in order and each leaves the stack healthy for the next.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Endpoint } from "@pehchaan/canary/client";
import { buildImages, PROBE_TABLE, relayImage } from "./lib/images";
import { LoadRun } from "./lib/loadrun";
import { phone, realCheck, relogged } from "./lib/realcheck";
import { docker, ok, run, sleep } from "./lib/sh";
import {
  ageKeyPair,
  caddyRoot,
  compose,
  containerOf,
  deploy,
  destroyStack,
  httpsGet,
  NETWORK,
  ORIGIN,
  psql,
  RELAY_URL,
  REPO,
  SERVICES,
  STACK_DIR,
  stackEnv,
  TAG_A,
  TAG_B,
  waitHealthy,
  writeStack,
} from "./lib/stack";

let ca = "";
let caFile = "";
let ep: Endpoint;
let identity = "";

beforeAll(async () => {
  await buildImages();
  const age = await ageKeyPair();
  identity = age.identity;
  await destroyStack().catch(() => {});
  writeStack(await stackEnv(age.recipient));
  await deploy(TAG_A);
  await waitHealthy(SERVICES, 120_000);
  ca = await caddyRoot();
  caFile = join(STACK_DIR, "caddy-root.crt");
  writeFileSync(caFile, ca);
  ep = { url: RELAY_URL, origin: ORIGIN, relayHost: "localhost", ca };
});

afterAll(async () => {
  await destroyStack();
});

describe("OPS-02 · the full production stack runs locally behind Caddy (internal CA)", () => {
  it("serves /healthz and /readyz over HTTPS with Caddy's certificate, and redirects HTTP", async () => {
    expect(await httpsGet("/healthz", ca)).toMatchObject({ status: 200 });
    expect(await httpsGet("/readyz", ca)).toMatchObject({ status: 200 });
    const plain = await fetch("http://localhost/healthz", { redirect: "manual" });
    expect([301, 308]).toContain(plain.status);
    expect(plain.headers.get("location")).toBe("https://localhost/healthz");
  });

  it("refuses a certificate it can't trust (no silent downgrade to an unverified connection)", async () => {
    await expect(httpsGet("/healthz", "")).rejects.toThrow(/certificate|self.signed|unable to verify/i);
  });

  it("runs the runbooks' admin commands inside the relay image (stats, retention: 16.8, 24)", async () => {
    const admin = (cmd: string) =>
      run("docker", ["compose", "exec", "-T", "relay-a", "node", "dist/admin.js", cmd], { cwd: STACK_DIR });
    const stats = await admin("stats");
    expect(stats.code, stats.stderr).toBe(0);
    expect(JSON.parse(stats.stderr)).toHaveProperty("devicesActive");
    const retention = await admin("retention");
    expect(retention.code, retention.stderr).toBe(0);
    expect(retention.stderr).toContain("retention applied");
  });

  it("runs every service: two relays, Valkey, Postgres, backups and Alloy", async () => {
    const services = (await compose(["ps", "--format", "{{.Service}}"])).trim().split("\n").sort();
    expect(services).toEqual([...SERVICES].sort());
  });
});

describe("OPS-09 · only ports 80 and 443 are published (running stack)", () => {
  it("publishes 80 and 443 on Caddy and nothing else anywhere", async () => {
    const rows = (await compose(["ps", "--format", "{{.Service}}\t{{.Publishers}}"])).trim().split("\n");
    const published = rows.flatMap((row) => {
      const [svc, pubs] = row.split("\t");
      return [...(pubs ?? "").matchAll(/PublishedPort:(\d+)|(\d+)\s+(?:tcp|udp)/g)]
        .map((m) => Number(m[1] ?? m[2]))
        .filter((p) => p > 0)
        .map((p) => `${svc}:${p}`);
    });
    expect([...new Set(published)].sort()).toEqual(["caddy:443", "caddy:80"]);
  });
});

describe("OPS-10 · the canary passes against the local stack", () => {
  it("logs in, sends a sealed request, gets a sealed answer and the receipts (smoke: health first)", async () => {
    const r = await run(process.execPath, ["--import", "tsx", "src/cli.ts", "smoke"], {
      cwd: join(REPO, "apps", "canary"),
      env: { CANARY_RELAY_URL: RELAY_URL, CANARY_ORIGIN: ORIGIN, NODE_EXTRA_CA_CERTS: caFile },
      timeoutMs: 60_000,
    });
    const line = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { ok: boolean; error?: string };
    expect(line, r.stderr).toMatchObject({ ok: true });
    expect(r.code).toBe(0);
  });
});

describe("J-14 · relay-a is killed while a request is pending (through Caddy)", () => {
  const killRelayA = async () => docker(["kill", await containerOf("relay-a")]);
  const restoreRelayA = async () => {
    await compose(["start", "relay-a"]);
    await waitHealthy(["relay-a"], 90_000);
  };

  it("the answerer's relay dies before it answers: relay-b takes over and the verdict is VERIFIED", async () => {
    const asker = await phone(ep, "relay-b");
    const answerer = await phone(ep, "relay-a");
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        beforeAnswer: async () => {
          await killRelayA();
          await relogged(answerer, "relay-b");
        },
      });
      expect(outcome).toMatchObject({ verdict: "VERIFIED", request: "accepted" });
    } finally {
      asker.session.stop();
      answerer.session.stop();
      await restoreRelayA();
    }
  });

  it("the asker's relay dies while it waits: the answer reaches it on relay-b, and NOT ME stays DENIED", async () => {
    const asker = await phone(ep, "relay-a");
    const answerer = await phone(ep, "relay-b");
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "NOT_ME",
        // The answer leaves while the asker has no socket at all: it must wait in the asker's inbox (Valkey) and
        // arrive when the asker logs in again, on relay-b.
        beforeAnswer: async () => void (await killRelayA()),
      });
      expect(outcome).toMatchObject({ verdict: "DENIED", request: "accepted" });
      // The inbox drain can deliver the answer before the new login's grant step finishes: wait for that first.
      await relogged(asker, "relay-b");
      expect(asker.session.logins).toBe(2);
    } finally {
      asker.session.stop();
      answerer.session.stop();
      await restoreRelayA();
    }
  });
});

describe("OPS-03 / OPS-04 · rolling deploys under load, with a migration and a rollback", () => {
  it("deploys ops-b (one new migration) and rolls back to ops-a while 1,000 sockets run 2 checks/s: zero failures", async () => {
    const load = LoadRun.start(["hold", "--sockets", "1000", "--rate", "2", "--pairs", "20", "--duration", "0"], {
      LOADGEN_RELAY_URL: RELAY_URL,
      LOADGEN_ORIGIN: ORIGIN,
      LOADGEN_CA_FILE: caFile,
    });
    await load.waitFor("holding", 5 * 60_000);

    // OPS-04: the deploy runs ops-b's migration before the new containers start.
    await deploy(TAG_B);
    for (const svc of ["relay-a", "relay-b"]) {
      expect(await ok("docker", ["inspect", "-f", "{{.Config.Image}}", await containerOf(svc)])).toContain(
        relayImage(TAG_B),
      );
    }
    expect((await psql(`select to_regclass('${PROBE_TABLE}')`)).trim()).toBe(PROBE_TABLE);

    // Rollback (24.2): the previous tag, from deploy.log. Expand-only migrations: no database rollback needed.
    const log = readFileSync(join(STACK_DIR, "deploy.log"), "utf8").trim().split("\n");
    expect(log.map((l) => l.split(" ")[1])).toEqual([TAG_A, TAG_B]);
    await deploy(TAG_A);
    for (const svc of ["relay-a", "relay-b"]) {
      expect(await ok("docker", ["inspect", "-f", "{{.Config.Image}}", await containerOf(svc)])).toContain(
        relayImage(TAG_A),
      );
    }
    expect((await psql(`select to_regclass('${PROBE_TABLE}')`)).trim()).toBe(PROBE_TABLE);

    const { code, report } = await load.stop();
    const checks = report.checks as { started: number; passed: number; failed: number; errors: string[] };
    expect(report.problems, JSON.stringify(report)).toEqual([]);
    expect(checks.failed, checks.errors.join("; ")).toBe(0);
    expect(checks.started).toBeGreaterThan(100);
    // Both deploys drained both containers: every socket moved at least twice.
    expect((report.sockets as { relogins: number }).relogins).toBeGreaterThanOrEqual(1000);
    expect(code).toBe(0);
  });
});

/** Row counts of every table the relay keeps (and its migration record), as one JSON object. */
const COUNTS_SQL = `select json_build_object(
  'devices', (select count(*) from devices),
  'bindings', (select count(*) from contact_bindings),
  'revokedBindings', (select count(*) from contact_bindings where revoked_at is not null),
  'grants', (select count(*) from contact_grants),
  'subscriptions', (select count(*) from push_subscriptions),
  'auditEvents', (select count(*) from audit_events),
  'labAttacks', (select count(*) from lab_attacks),
  'migrations', (select count(*) from public.__drizzle_migrations))`;

describe("OPS-05 · backup → restore into an empty Postgres", () => {
  const RESTORE = "pehchaan-ops-restore";
  const backupSh = (script: string, input?: string) =>
    compose(["exec", "-T", "backup", "sh", "-c", script], input === undefined ? {} : { input });

  it("restores identical row counts, including revoked bindings; the dump is unreadable without the age key", async () => {
    // Revoked bindings must survive a restore: a block that disappears would let a blocked device back in.
    await psql(
      `update contact_bindings set revoked_at = now() where ctid in (select ctid from contact_bindings limit 3);
       insert into push_subscriptions (device_id, endpoint, p256dh, auth, vapid_key_id)
         select device_id, 'https://push.pehchaan.test/ops/' || device_id, 'p256dh', 'auth', 'ops1'
           from devices limit 2;`,
    );
    const before = JSON.parse(await psql(COUNTS_SQL)) as Record<string, number>;
    expect(before.devices).toBeGreaterThan(1000);
    expect(before.revokedBindings).toBe(3);
    expect(before.subscriptions).toBe(2);

    // The nightly job, run now: pg_dump → age → rclone (a local remote here) → retention → heartbeat.
    expect(await compose(["exec", "-T", "backup", "/opt/backup/backup.sh"])).toMatch(
      /backup ok: pehchaan-\d{8}T\d{6}Z\.dump\.age/,
    );
    expect(await backupSh("cat /metrics/backup.prom")).toMatch(
      /^pehchaan_backup_last_success_timestamp_seconds \d{10}$/m,
    );
    const files = (await backupSh("ls /tmp/backups")).trim().split("\n");
    expect(files).toHaveLength(1);
    const dump = `/tmp/backups/${files[0]}`;

    // Unreadable without the key: an age file, no pg_dump header and no device ID in the clear, and a different
    // age key can't open it.
    expect(await backupSh(`head -c 21 ${dump}`)).toBe("age-encryption.org/v1");
    const someDevice = (await psql("select device_id from devices limit 1")).trim();
    expect((await backupSh(`grep -a -c -e PGDMP -e '${someDevice}' ${dump} || true`)).trim()).toBe("0");
    const wrong = await run(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "backup",
        "sh",
        "-c",
        `age-keygen -o /tmp/wrong.key 2>/dev/null; age --decrypt --identity /tmp/wrong.key ${dump} > /dev/null`,
      ],
      { cwd: STACK_DIR },
    );
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toMatch(/no identity matched/i);

    // A fresh, empty Postgres (the same pinned image) on the stack's network.
    const image = (await ok("docker", ["inspect", "-f", "{{.Config.Image}}", await containerOf("postgres")])).trim();
    await run("docker", ["rm", "-f", RESTORE]);
    await docker([
      "run",
      "-d",
      "--name",
      RESTORE,
      "--network",
      NETWORK,
      "-e",
      "POSTGRES_USER=pehchaan",
      "-e",
      "POSTGRES_DB=pehchaan",
      "-e",
      "POSTGRES_PASSWORD=restore-test",
      image,
    ]);
    try {
      for (let i = 0; ; i++) {
        const r = await run("docker", ["exec", RESTORE, "pg_isready", "-h", "127.0.0.1", "-U", "pehchaan"]);
        if (r.code === 0) break;
        if (i > 60) throw new Error("the restore target never became ready");
        await sleep(1000);
      }
      const restoreSql = (sql: string) =>
        docker(["exec", RESTORE, "psql", "-U", "pehchaan", "-d", "pehchaan", "-v", "ON_ERROR_STOP=1", "-tAc", sql]);
      expect((await restoreSql("select count(*) from pg_tables where schemaname = 'public'")).trim()).toBe("0");

      // restore.sh with the private key, which exists only for this step (never on a VM).
      await backupSh("umask 077; cat > /tmp/restore.key", identity);
      const target = `postgres://pehchaan:restore-test@${RESTORE}:5432/pehchaan`;
      expect(await backupSh(`/opt/backup/restore.sh ${dump} /tmp/restore.key ${target}`)).toMatch(/restored pehchaan-/);
      const after = JSON.parse(await restoreSql(COUNTS_SQL)) as Record<string, number>;
      expect(after).toEqual(before);
    } finally {
      await backupSh("rm -f /tmp/restore.key /tmp/wrong.key");
      await run("docker", ["rm", "-f", RESTORE]);
    }
  });
});

describe("OPS-06 · restarting the whole stack (a VM reboot)", () => {
  it("every service is healthy again within 60 s, and checks work again", async () => {
    await compose(["stop", "--timeout", "40"]); // a clean shutdown: the relays drain
    const t0 = Date.now();
    await compose(["start"]); // what the Docker daemon does at boot for `restart: unless-stopped`
    await waitHealthy(SERVICES, 60_000);
    expect(Date.now() - t0).toBeLessThan(60_000);

    const asker = await phone(ep);
    const answerer = await phone(ep);
    try {
      expect(await realCheck({ asker, answerer, decision: "ME" })).toMatchObject({
        verdict: "VERIFIED",
        request: "accepted",
      });
    } finally {
      asker.session.stop();
      answerer.session.stop();
    }
  });
});
