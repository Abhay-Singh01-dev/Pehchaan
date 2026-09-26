// infra/scripts/vapid-keys.ts (spec 11.1): a usable VAPID key pair for one environment.
import { spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const run = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "infra/scripts/vapid-keys.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
const value = (out: string, name: string) => out.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1] ?? "";

describe("vapid-keys", () => {
  it("prints a matching P-256 pair, the same public key and ID for the relay and the app", () => {
    const r = run("v7");
    expect(r.status).toBe(0);
    const pub = Buffer.from(value(r.stdout, "VAPID_PUBLIC_KEY"), "base64url");
    const priv = Buffer.from(value(r.stdout, "VAPID_PRIVATE_KEY"), "base64url");
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(0x04);
    expect(priv).toHaveLength(32);
    const check = createECDH("prime256v1");
    check.setPrivateKey(priv);
    expect(check.getPublicKey().equals(pub)).toBe(true);
    expect(value(r.stdout, "VAPID_KEY_ID")).toBe("v7");
    expect(value(r.stdout, "VITE_VAPID_KEY_ID")).toBe("v7");
    expect(value(r.stdout, "VITE_VAPID_PUBLIC_KEY")).toBe(value(r.stdout, "VAPID_PUBLIC_KEY"));
  });

  it("makes a new pair every time, and refuses an unusable key ID", () => {
    expect(value(run().stdout, "VAPID_PRIVATE_KEY")).not.toBe(value(run().stdout, "VAPID_PRIVATE_KEY"));
    expect(value(run().stdout, "VAPID_KEY_ID")).toMatch(/^v\d{8}$/);
    expect(run("bad id!").status).toBe(1);
  });
});
