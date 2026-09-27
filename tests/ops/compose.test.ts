// The production compose file and its settings (spec 18.6, 18.7), checked with Docker Compose itself:
//   OPS-01  `docker compose config` accepts the production and the staging .env built from env.example; the
//           "ha" profile adds relay-b; a missing image tag stops compose instead of starting something unknown
//   OPS-09  only Caddy publishes ports, and only 80 and 443
//   C-18.6a Valkey runs with a password, no persistence, 768mb and noeviction
//   C-18.7a env.example holds names only: no value that could be a secret
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./lib/sh";
import { REPO } from "./lib/stack";

const VM = join(REPO, "infra", "vm");
const read = (f: string) => readFileSync(join(VM, f), "utf8");
const envExample = read("env.example");

/** env.example as KEY → value (quotes kept, like the file). */
const exampleVars = new Map(
  envExample
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const),
);

/** A VM .env as the team would fill it in (test values), for one environment. */
function filledEnv(envName: "production" | "staging", overrides: Record<string, string> = {}): string {
  const fill: Record<string, string> = {
    ENV_NAME: envName,
    RELAY_HOST: envName === "production" ? "relay.yourdomain.in" : "staging-relay.yourdomain.in",
    IMAGE_REGISTRY: "ghcr.io/pehchaan-team",
    RELAY_TAG: "0123456789abcdef0123456789abcdef01234567",
    VALKEY_PASSWORD: "a".repeat(64),
    POSTGRES_PASSWORD: "b".repeat(64),
    ...overrides,
  };
  return [...exampleVars].map(([k, v]) => `${k}=${fill[k] ?? v}`).join("\n") + "\n";
}

interface Config {
  services: Record<
    string,
    {
      image: string;
      restart?: string;
      command?: string[];
      ports?: Array<{ target: number; published: string; host_ip?: string }>;
      network_mode?: string;
      stop_grace_period?: string;
      networks?: Record<string, { ipv4_address?: string } | null>;
    }
  >;
  networks: Record<string, { ipam?: { config?: Array<{ subnet?: string; ip_range?: string }> } }>;
}

/** An IPv4 address as a number, and whether it falls inside a CIDR block. */
const ip4 = (a: string) => a.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
const inCidr = (addr: string, cidr: string) => {
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  return Math.floor(ip4(addr) / size) === Math.floor(ip4(base!) / size);
};

/** `docker compose config` in a copy of /opt/pehchaan: compose.yml next to its .env, as on a VM. */
async function composeConfig(env: string, extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "pehchaan-compose-"));
  for (const f of ["compose.yml", "Caddyfile", "config.alloy"]) copyFileSync(join(VM, f), join(dir, f));
  writeFileSync(join(dir, ".env"), env);
  return run("docker", ["compose", "config", ...extra], { cwd: dir });
}

async function config(env: string): Promise<Config> {
  const r = await composeConfig(env, ["--format", "json"]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Config;
}

describe("OPS-01 · docker compose config", () => {
  it.each(["production", "staging"] as const)("is valid for the %s .env, with both relays (profile ha)", async (e) => {
    const c = await config(filledEnv(e));
    expect(Object.keys(c.services).sort()).toEqual([
      "alloy",
      "backup",
      "caddy",
      "postgres",
      "relay-a",
      "relay-b",
      "valkey",
    ]);
    expect(c.services["relay-a"]!.image).toBe(
      `ghcr.io/pehchaan-team/pehchaan-relay:${"0123456789abcdef".repeat(2)}01234567`,
    );
    expect(c.services.backup!.image).toBe(c.services["relay-a"]!.image.replace("pehchaan-relay", "pehchaan-backup"));
  });

  it("leaves relay-b out without the ha profile (a single relay on a laptop)", async () => {
    const c = await config(filledEnv("staging", { COMPOSE_PROFILES: "" }));
    expect(Object.keys(c.services)).not.toContain("relay-b");
    expect(Object.keys(c.services)).toContain("relay-a");
  });

  it("refuses to run without an image tag or the store passwords (never an unknown image or an open store)", async () => {
    for (const missing of ["RELAY_TAG", "IMAGE_REGISTRY", "VALKEY_PASSWORD", "POSTGRES_PASSWORD"]) {
      const r = await composeConfig(filledEnv("production", { [missing]: "" }));
      expect(r.code, missing).not.toBe(0);
      expect(r.stderr).toContain(missing);
    }
  });

  it("env.example names every variable the stack reads (compose, Caddy, Alloy, the relay's production settings)", () => {
    const used = new Set([
      ...[...read("compose.yml").matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]!),
      ...[...read("Caddyfile").matchAll(/\{\$([A-Z0-9_]+)/g)].map((m) => m[1]!),
      ...[...read("config.alloy").matchAll(/sys\.env\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]!),
      ...[...readFileSync(join(REPO, "infra", "backup", "backup.sh"), "utf8").matchAll(/\$\{([A-Z][A-Z0-9_]+)[:}]/g)]
        .map((m) => m[1]!)
        .filter((v) => v !== "METRICS_DIR"),
      // Required by the relay in staging and production (apps/relay/src/config.ts).
      "ENV_NAME",
      "RELAY_HOST",
      "PUBLIC_ORIGINS",
      "REDIS_URL",
      "DATABASE_URL",
      "AUDIT_KEY",
      "IP_HASH_KEY",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "TRUST_PROXY",
    ]);
    const missing = [...used].filter((v) => !exampleVars.has(v));
    expect(missing).toEqual([]);
  });

  it("pins every third-party image by digest (the relay and backup images are pinned by their commit tag)", async () => {
    const c = await config(filledEnv("production"));
    for (const [name, s] of Object.entries(c.services)) {
      if (name.startsWith("relay-") || name === "backup") continue;
      expect(s.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });

  it("restarts every service by itself after a reboot, and gives the relays time to drain (18.9)", async () => {
    const c = await config(filledEnv("production"));
    for (const [name, s] of Object.entries(c.services)) expect(s.restart, name).toBe("unless-stopped");
    // 6 s settle + 20 s drain < 40 s before Docker sends SIGKILL.
    for (const relay of ["relay-a", "relay-b"]) expect(c.services[relay]!.stop_grace_period).toBe("40s");
  });

  it("gives Caddy the fixed address the relays trust as their proxy", async () => {
    const c = await config(filledEnv("production"));
    const ip = c.services.caddy!.networks!.internal!.ipv4_address;
    expect(`${ip}/32`).toBe(exampleVars.get("TRUST_PROXY"));
  });

  it("keeps Caddy's fixed address out of the range Docker hands to the other containers", async () => {
    // Without a separate ip_range, a container started just before Caddy can be given Caddy's address, and Caddy
    // then fails to start ("Address already in use") on a VM's first deploy.
    const c = await config(filledEnv("production"));
    const ip = c.services.caddy!.networks!.internal!.ipv4_address!;
    const ipam = c.networks.internal!.ipam!.config![0]!;
    expect(inCidr(ip, ipam.subnet!)).toBe(true);
    expect(ipam.ip_range, "the network needs an ip_range for dynamic addresses").toBeDefined();
    expect(inCidr(ip, ipam.ip_range!)).toBe(false);
  });
});

describe("OPS-09 · only ports 80 and 443 are published", () => {
  it("Caddy publishes 80 and 443; no other service publishes anything or uses the host network", async () => {
    const c = await config(filledEnv("production"));
    for (const [name, s] of Object.entries(c.services)) {
      expect(s.network_mode, name).toBeUndefined();
      if (name !== "caddy") expect(s.ports ?? [], name).toEqual([]);
    }
    const caddy = (c.services.caddy!.ports ?? []).map((p) => `${p.published}:${p.target}`).sort();
    expect(caddy).toEqual(["443:443", "80:80"]);
  });
});

describe("C-18.6a · Valkey", () => {
  it("requires a password, keeps nothing on disk, and refuses writes at 768mb instead of evicting", async () => {
    const cmd = (await config(filledEnv("production"))).services.valkey!.command!;
    const arg = (flag: string) => cmd[cmd.indexOf(flag) + 1];
    expect(arg("--requirepass")).toBe("a".repeat(64));
    expect(arg("--save")).toBe("");
    expect(arg("--appendonly")).toBe("no");
    expect(arg("--maxmemory")).toBe("768mb");
    expect(arg("--maxmemory-policy")).toBe("noeviction");
  });
});

describe("C-18.7a · env.example", () => {
  const SECRETS = [
    "VALKEY_PASSWORD",
    "POSTGRES_PASSWORD",
    "AUDIT_KEY",
    "IP_HASH_KEY",
    "VAPID_PRIVATE_KEY",
    "LAB_PASSWORD_HASH",
    "SENTRY_DSN",
    "RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID",
    "RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY",
    "GRAFANA_CLOUD_TOKEN",
  ];

  it("leaves every secret empty", () => {
    for (const k of SECRETS) expect([...["", "''"]], k).toContain(exampleVars.get(k));
  });

  it("holds no value that looks like a key, token or password", () => {
    for (const [k, v] of exampleVars) {
      expect(v, k).not.toMatch(/[0-9a-f]{32,}|[A-Za-z0-9_-]{40,}|\$argon2|AGE-SECRET-KEY|BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });
});
