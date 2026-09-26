// REL-20: invalid configuration → the process exits with a clear message (and never prints a secret).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config";

const base = {
  ENV_NAME: "test",
  RELAY_HOST: "relay.test",
  PUBLIC_ORIGINS: "http://app.test",
  REDIS_URL: "redis://127.0.0.1:6379",
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
};
const SECRET = "a".repeat(64);
const prod = {
  ...base,
  ENV_NAME: "production",
  PUBLIC_ORIGINS: "https://app.yourdomain.in",
  AUDIT_KEY: SECRET,
  IP_HASH_KEY: SECRET,
  VAPID_PUBLIC_KEY: "BPub",
  VAPID_PRIVATE_KEY: "priv",
};

const problems = (env: Record<string, string>) => {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
};

describe("REL-20 · configuration", () => {
  it("a complete test configuration loads, with the spec defaults", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      PORT: 8080,
      METRICS_PORT: 9091,
      E2E_REQUIRED: false,
      LAB_ENABLED: false,
      MAX_SOCKETS: 15000,
    });
    expect(c.PUBLIC_ORIGINS).toEqual(["http://app.test"]);
    expect(c.AUDIT_KEY).toMatch(/^[0-9a-f]{64}$/); // throwaway key outside staging/production
    expect(loadConfig(prod).ENV_NAME).toBe("production");
  });

  it("lists every missing or invalid variable by name", () => {
    const p = problems({ ENV_NAME: "prod", REDIS_URL: "http://x", PUBLIC_ORIGINS: "app.test/" });
    expect(p.join("\n")).toMatch(/ENV_NAME/);
    expect(p.join("\n")).toMatch(/RELAY_HOST/);
    expect(p.join("\n")).toMatch(/REDIS_URL/);
    expect(p.join("\n")).toMatch(/DATABASE_URL/);
    expect(p.join("\n")).toMatch(/PUBLIC_ORIGINS/);
  });

  it("staging and production need their secrets and https origins", () => {
    const p = problems({ ...base, ENV_NAME: "staging" }).join("\n");
    for (const k of ["AUDIT_KEY", "IP_HASH_KEY", "VAPID_PUBLIC_KEY", "PUBLIC_ORIGINS"]) expect(p).toContain(k);
  });

  it("secrets must be 32 random bytes; VAPID keys come as a pair; the Lab needs an Argon2id hash", () => {
    expect(problems({ ...prod, AUDIT_KEY: "short" }).join()).toContain("AUDIT_KEY");
    expect(problems({ ...base, VAPID_PUBLIC_KEY: "x" }).join()).toContain("VAPID");
    expect(problems({ ...base, LAB_ENABLED: "true" }).join()).toContain("LAB_PASSWORD_HASH");
    expect(problems({ ...base, LAB_ENABLED: "true", LAB_PASSWORD_HASH: "$2b$10$bcrypt" }).join()).toContain("Argon2id");
  });

  it("only the test environment may shorten the spec's timings or use a mock push target", () => {
    expect(problems({ ...prod, AUTH_DEADLINE_MS: "500" }).join()).toContain("AUTH_DEADLINE_MS");
    expect(problems({ ...prod, PUSH_TEST_TARGET: "http://127.0.0.1:1" }).join()).toContain("PUSH_TEST_TARGET");
    expect(problems({ ...prod, RATE_LIMIT_PROFILE: "relaxed" }).join()).toContain("RATE_LIMIT_PROFILE");
    expect(problems({ ...base, AUTH_DEADLINE_MS: "500" })).toEqual([]);
  });

  it("never echoes a secret's value in the message", () => {
    const leaky = "super-secret-value-" + "9".repeat(20);
    const p = problems({ ...prod, AUDIT_KEY: leaky, DATABASE_URL: `mysql://${leaky}` }).join("\n");
    expect(p).not.toContain(leaky);
  });

  it("the relay process exits 1 with the message when the configuration is invalid", () => {
    const relayDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: relayDir,
      env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", ENV_NAME: "production" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Invalid relay configuration");
    expect(r.stderr).toContain("RELAY_HOST");
  }, 90_000);
});
