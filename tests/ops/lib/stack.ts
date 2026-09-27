// The production stack on this machine (spec Phase 10): the real infra/vm files (compose.yml, Caddyfile,
// config.alloy, deploy.sh) in a scratch directory, with a .env like a VM's, except:
//   - IMAGE_REGISTRY=local and locally built tags (deploy.sh runs with SKIP_PULL=1);
//   - RELAY_HOST=localhost with CADDY_LOCAL_CERTS=local_certs: Caddy's internal certificate authority;
//   - ENV_NAME=staging with RATE_LIMIT_PROFILE=relaxed (load tests; production refuses relaxed);
//   - backups go to a directory inside the backup container (an rclone "local" remote), not a bucket;
//   - Alloy's Grafana Cloud endpoints point at a closed local port (it runs and retries; nothing leaves).
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bashPath, docker, ok, posix, run, sleep, type RunOptions } from "./sh";

export const REPO = resolve(import.meta.dirname, "..", "..", "..");
export const STACK_DIR = join(tmpdir(), "pehchaan-ops-stack");
export const PROJECT = "pehchaan-ops";
export const NETWORK = `${PROJECT}_internal`;
export const REGISTRY = "local";
export const ORIGIN = "https://app.pehchaan.test";
export const RELAY_URL = "wss://localhost/v1/ws";
export const TAG_A = "ops-a";
export const TAG_B = "ops-b";

const hex = () => randomBytes(32).toString("hex");

/** A VAPID key pair in web-push's format (raw public point and private scalar, base64url). */
async function vapidPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: Buffer.from(pub).toString("base64url"), privateKey: jwk.d! };
}

/** age key pair made by the backup image's own age-keygen: [recipient (public), identity file (private)]. */
export async function ageKeyPair(): Promise<{ recipient: string; identity: string }> {
  const out = await docker(["run", "--rm", `${REGISTRY}/pehchaan-backup:${TAG_A}`, "age-keygen"]);
  const recipient = /public key: (age1[0-9a-z]+)/.exec(out)?.[1];
  if (!recipient) throw new Error(`age-keygen printed no public key:\n${out}`);
  return { recipient, identity: out };
}

export async function stackEnv(ageRecipient: string): Promise<Record<string, string>> {
  const valkey = hex();
  const pg = hex();
  const vapid = await vapidPair();
  return {
    COMPOSE_PROJECT_NAME: PROJECT,
    ENV_NAME: "staging",
    PORT: "8080",
    METRICS_PORT: "9091",
    RELAY_HOST: "localhost",
    RELAY_UPSTREAMS: '"relay-a:8080 relay-b:8080"',
    COMPOSE_PROFILES: "ha",
    CADDY_LOCAL_CERTS: "local_certs",
    CADDY_EMAIL: "ops@pehchaan.test",
    IMAGE_REGISTRY: REGISTRY,
    RELAY_TAG: TAG_A,
    PUBLIC_ORIGINS: ORIGIN,
    TRUST_PROXY: "172.30.0.2/32",
    MIN_CLIENT_VERSION: "1.0.0",
    MAX_SOCKETS: "15000",
    DRAIN_TIMEOUT_MS: "20000",
    RATE_LIMIT_PROFILE: "relaxed",
    LOG_LEVEL: "info",
    RELEASE: "ops-test",
    VALKEY_PASSWORD: valkey,
    POSTGRES_PASSWORD: pg,
    REDIS_URL: `redis://:${valkey}@valkey:6379`,
    DATABASE_URL: `postgres://pehchaan:${pg}@postgres:5432/pehchaan`,
    AUDIT_KEY: hex(),
    IP_HASH_KEY: hex(),
    VAPID_KEY_ID: "ops1",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:ops@pehchaan.test",
    E2E_REQUIRED: "true",
    LAB_ENABLED: "false",
    BACKUP_AGE_RECIPIENT: ageRecipient,
    BACKUP_REMOTE: "backup:/tmp/backups",
    RCLONE_CONFIG_BACKUP_TYPE: "local",
    GRAFANA_CLOUD_PROM_URL: "http://127.0.0.1:9/api/prom/push",
    GRAFANA_CLOUD_PROM_USER: "ops",
    GRAFANA_CLOUD_LOKI_URL: "http://127.0.0.1:9/loki/api/v1/push",
    GRAFANA_CLOUD_LOKI_USER: "ops",
    GRAFANA_CLOUD_TOKEN: "ops",
  };
}

/** Copies the real infra/vm files into a fresh scratch directory and writes the .env (LF, like on a VM). */
export function writeStack(env: Record<string, string>, extraFiles: Record<string, string> = {}): void {
  rmSync(STACK_DIR, { recursive: true, force: true });
  mkdirSync(STACK_DIR, { recursive: true });
  for (const f of ["compose.yml", "Caddyfile", "config.alloy", "deploy.sh"]) {
    copyFileSync(join(REPO, "infra", "vm", f), join(STACK_DIR, f));
  }
  const text = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(join(STACK_DIR, ".env"), `${text}\n`);
  for (const [name, content] of Object.entries(extraFiles)) writeFileSync(join(STACK_DIR, name), content);
}

export const compose = (args: string[], o: RunOptions = {}) =>
  docker(["compose", ...args], { cwd: STACK_DIR, timeoutMs: 15 * 60_000, ...o });

/** infra/vm/deploy.sh <tag>, exactly as CI runs it on the VM, with local images. */
export function deploy(tag: string, o: RunOptions = {}) {
  return ok(bashPath(), [posix(join(STACK_DIR, "deploy.sh")), tag], {
    cwd: STACK_DIR,
    env: { PEHCHAAN_DIR: posix(STACK_DIR), SKIP_PULL: "1" },
    timeoutMs: 15 * 60_000,
    ...o,
  });
}

/** Removes the stack, its volumes and anything a test started on its network. */
export async function destroyStack(): Promise<void> {
  await run("docker", ["rm", "-f", "pehchaan-ops-restore", "pehchaan-ops-arm64"]);
  await run("docker", ["compose", "down", "--volumes", "--remove-orphans", "--timeout", "5"], {
    cwd: STACK_DIR,
    timeoutMs: 5 * 60_000,
  });
}

/** The container ID of a compose service, running or not ('' when it has none). */
export const containerOf = async (svc: string) => (await compose(["ps", "--all", "-q", svc])).trim();

/** A running container's health (healthy, starting, unhealthy, or "running" without a healthcheck); otherwise its
 *  state (exited, restarting…). A stopped container keeps its last health status, so the state is checked first. */
export async function healthOf(svc: string): Promise<string> {
  const id = await containerOf(svc);
  if (!id) return "missing";
  const r = await run("docker", [
    "inspect",
    "-f",
    '{{if ne .State.Status "running"}}{{.State.Status}} (exit {{.State.ExitCode}}){{else if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}',
    id,
  ]);
  return r.stdout.trim();
}

/** Waits until every service is healthy (or running, without a healthcheck). Returns the ms it took. */
export async function waitHealthy(services: string[], timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const states = await Promise.all(services.map(healthOf));
    if (states.every((s) => s === "healthy" || s === "running")) return Date.now() - t0;
    await sleep(1000);
  }
  const states = await Promise.all(services.map(async (s) => `${s}=${await healthOf(s)}`));
  const logs = await run("docker", ["compose", "logs", "--tail", "15", ...services], { cwd: STACK_DIR });
  throw new Error(`not healthy within ${timeoutMs} ms: ${states.join(", ")}\n${logs.stdout.slice(-6000)}`);
}

export const SERVICES = ["caddy", "relay-a", "relay-b", "valkey", "postgres", "backup", "alloy"];

/** Caddy's internal root certificate (PEM), which clients on this machine must trust. */
export const caddyRoot = () => compose(["exec", "-T", "caddy", "cat", "/data/caddy/pki/authorities/local/root.crt"]);

/** An HTTPS GET to the stack through Caddy, trusting its local root. */
export function httpsGet(path: string, ca: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveGet, reject) => {
    const req = request({ host: "localhost", port: 443, path, ca, method: "GET", timeout: 10_000 }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolveGet({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** psql inside the stack's Postgres (as the relay's user): tuples only, unaligned. */
export const psql = (sql: string) =>
  compose(["exec", "-T", "postgres", "psql", "-U", "pehchaan", "-d", "pehchaan", "-v", "ON_ERROR_STOP=1", "-tAc", sql]);
