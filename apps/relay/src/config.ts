// The relay's configuration (spec 18.7). Every variable is validated with zod at boot; a missing or invalid
// value stops the relay from starting (fail fast, REL-20). Secrets never appear in error messages.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TIMING } from "@pehchaan/protocol";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const secret32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 32 random bytes as 64 hex characters (openssl rand -hex 32)");
const origin = z.string().refine((s) => {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === s;
  } catch {
    return false;
  }
}, "must be an origin like https://app.yourdomain.in");

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "must be x.y.z");

/** An IPv4/IPv6 address or CIDR block. */
const cidr = z.string().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "must be an IP address or CIDR block");

const schema = z
  .object({
    ENV_NAME: z.enum(["development", "test", "staging", "production"]),
    PORT: int(0, 65535).default(8080),
    METRICS_PORT: int(0, 65535).default(9091),
    BIND_HOST: z.string().default("0.0.0.0"),
    /** Used in the signed login message (7.3) and by Caddy; never taken from the request's Host header. */
    RELAY_HOST: z.string().min(1).max(253),
    PUBLIC_ORIGINS: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(origin).min(1)),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "must be a redis:// URL"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
    /** The Postgres schema the relay uses (tests give each file its own, D-018). */
    PG_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/)
      .default("public"),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_KEY_ID: z.string().default("v1"),
    /** During a VAPID key rotation (11.9): the previous pair, so older subscriptions keep working for 30 days. */
    VAPID_PREVIOUS_KEY_ID: z.string().optional(),
    VAPID_PREVIOUS_PUBLIC_KEY: z.string().optional(),
    VAPID_PREVIOUS_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default("mailto:security@yourdomain.in"),
    E2E_REQUIRED: bool.default(false),
    LAB_ENABLED: bool.default(false),
    LAB_PASSWORD_HASH: z.string().optional(),
    MIN_CLIENT_VERSION: semver.default("1.0.0"),
    MAX_SOCKETS: int(1, 1_000_000).default(15_000),
    TRUST_PROXY: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      )
      .pipe(z.array(cidr)),
    /** Prefix for every Valkey key and pub/sub channel (tests: one per file). */
    KEY_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9:_-]*$/)
      .default(""),
    RATE_LIMIT_PROFILE: z.enum(["standard", "relaxed"]).default("standard"),
    AUDIT_KEY: secret32.optional(),
    IP_HASH_KEY: secret32.optional(),
    GATEWAY_NAME: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .default("relay"),
    /** Error reports (16.7): scrubbed, no personal data. Absent: no reports are sent. */
    SENTRY_DSN: z.string().url().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DRAIN_TIMEOUT_MS: int(0, 60_000).default(20_000),
    /** Time for Caddy's 5 s health check to take a draining container out, before upgrades are refused. */
    DRAIN_SETTLE_MS: int(0, 30_000).default(6_000),
    // Timings from the spec. Only the test environment may shorten them (so tests don't wait minutes).
    AUTH_DEADLINE_MS: int(100, 60_000).default(TIMING.AUTH_DEADLINE_MS),
    RELAY_PING_MS: int(100, 120_000).default(TIMING.RELAY_PING_MS),
    ACK_PUSH_FALLBACK_MS: int(50, 10_000).default(TIMING.ACK_PUSH_FALLBACK_MS),
    LAB_HOLD_MS: int(100, 60_000).default(TIMING.LAB_HOLD_MS),
    PUSH_TEST_DELAY_MS: int(0, 60_000).default(TIMING.PUSH_TEST_DELAY_MS),
    /** Test only (D-011): send every push request to this mock push service instead of the endpoint's host. */
    PUSH_TEST_TARGET: z.string().url().optional(),
    /** Test only (J-16): write every WebSocket frame in and out to this file, to prove no personal data crosses. */
    FRAME_CAPTURE_FILE: z.string().min(1).optional(),
    /** The build being run, for error reports and Diagnostics (16.6). */
    RELEASE: z.string().max(64).default("dev"),
  })
  .superRefine((c, ctx) => {
    const strict = c.ENV_NAME === "staging" || c.ENV_NAME === "production";
    const need = (key: keyof typeof c, why: string) => {
      if (!c[key]) ctx.addIssue({ code: "custom", path: [key], message: `is required ${why}` });
    };
    if (strict) {
      need("AUDIT_KEY", "in staging and production");
      need("IP_HASH_KEY", "in staging and production");
      need("VAPID_PUBLIC_KEY", "in staging and production");
      need("VAPID_PRIVATE_KEY", "in staging and production");
      if (c.PUBLIC_ORIGINS.some((o) => !o.startsWith("https://"))) {
        ctx.addIssue({
          code: "custom",
          path: ["PUBLIC_ORIGINS"],
          message: "must be https:// in staging and production",
        });
      }
    }
    if (c.LAB_ENABLED) need("LAB_PASSWORD_HASH", "when LAB_ENABLED=true");
    if (c.LAB_PASSWORD_HASH && !c.LAB_PASSWORD_HASH.startsWith("$argon2id$")) {
      ctx.addIssue({ code: "custom", path: ["LAB_PASSWORD_HASH"], message: "must be an Argon2id hash" });
    }
    const previous = [c.VAPID_PREVIOUS_KEY_ID, c.VAPID_PREVIOUS_PUBLIC_KEY, c.VAPID_PREVIOUS_PRIVATE_KEY].filter(
      Boolean,
    );
    if (previous.length !== 0 && previous.length !== 3) {
      ctx.addIssue({
        code: "custom",
        path: ["VAPID_PREVIOUS_PRIVATE_KEY"],
        message: "the previous VAPID key needs its ID, public key and private key together",
      });
    }
    if (c.VAPID_PREVIOUS_KEY_ID && c.VAPID_PREVIOUS_KEY_ID === c.VAPID_KEY_ID) {
      ctx.addIssue({ code: "custom", path: ["VAPID_PREVIOUS_KEY_ID"], message: "must differ from VAPID_KEY_ID" });
    }
    if (Boolean(c.VAPID_PUBLIC_KEY) !== Boolean(c.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({ code: "custom", path: ["VAPID_PRIVATE_KEY"], message: "VAPID keys come as a pair" });
    }
    if (c.ENV_NAME !== "test") {
      const defaults = {
        AUTH_DEADLINE_MS: TIMING.AUTH_DEADLINE_MS,
        RELAY_PING_MS: TIMING.RELAY_PING_MS,
        ACK_PUSH_FALLBACK_MS: TIMING.ACK_PUSH_FALLBACK_MS,
        LAB_HOLD_MS: TIMING.LAB_HOLD_MS,
        PUSH_TEST_DELAY_MS: TIMING.PUSH_TEST_DELAY_MS,
      } as const;
      for (const [k, v] of Object.entries(defaults)) {
        if (c[k as keyof typeof defaults] !== v) {
          ctx.addIssue({ code: "custom", path: [k], message: `can only be changed when ENV_NAME=test` });
        }
      }
      if (c.PUSH_TEST_TARGET) {
        ctx.addIssue({ code: "custom", path: ["PUSH_TEST_TARGET"], message: "can only be set when ENV_NAME=test" });
      }
      if (c.FRAME_CAPTURE_FILE) {
        ctx.addIssue({ code: "custom", path: ["FRAME_CAPTURE_FILE"], message: "can only be set when ENV_NAME=test" });
      }
    }
    if (c.RATE_LIMIT_PROFILE === "relaxed" && c.ENV_NAME === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_PROFILE"],
        message: "relaxed is for load tests on staging only",
      });
    }
  });

export type Config = z.output<typeof schema> & {
  AUDIT_KEY: string;
  IP_HASH_KEY: string;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid relay configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Parses the environment. Throws ConfigError listing every problem (by variable name, never by value). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const input = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ConfigError(r.error.issues.map((i) => `${i.path.join(".") || "(config)"}: ${i.message}`));
  }
  // Development and test get throwaway HMAC keys; staging and production must provide their own.
  return {
    ...r.data,
    AUDIT_KEY: r.data.AUDIT_KEY ?? randomBytes(32).toString("hex"),
    IP_HASH_KEY: r.data.IP_HASH_KEY ?? randomBytes(32).toString("hex"),
  };
}
