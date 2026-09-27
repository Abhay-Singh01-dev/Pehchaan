// Phase 8: REL-18 (spec 9.5, 16.3 row 13). With E2E_REQUIRED=true the relay says so in hello, accepts sealed
// envelopes, and refuses a readable (plain) one unless BOTH ends are opted in to a Security Lab that is switched on.
// Real sealed envelopes (packages/crypto e2e) and the real Lab module.
import { argon2id } from "hash-wasm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { seal } from "@pehchaan/crypto/e2e";
import { ulid } from "@pehchaan/protocol";
import { createAdmin } from "../src/admin/commands";
import { TestDevice, type TestClient } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

const PASSWORD = "e2e required lab test";
let env: Env;
beforeAll(async () => {
  const hash = await argon2id({
    password: PASSWORD,
    salt: new Uint8Array(16).fill(3),
    parallelism: 1,
    iterations: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: "encoded",
  });
  env = await setupRelays("e2eRequired", {
    env: { E2E_REQUIRED: "true", LAB_ENABLED: "true", LAB_PASSWORD_HASH: hash, IP_HASH_KEY: "cd".repeat(32) },
  });
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;
const P = () => env.iso.keyPrefix;
const admin = () =>
  createAdmin({
    store: relay().hub.store,
    redis: relay().hub.redis,
    keys: relay().hub.keys,
    bus: relay().hub.bus,
    audit: relay().hub.audit,
    retire: (d) => relay().hub.retire(d, "admin"),
  });

beforeEach(async () => {
  const keys = [...(await env.iso.redis.keys(`${P()}lab:*`)), ...(await env.iso.redis.keys(`${P()}rl:*`))];
  if (keys.length) await env.iso.redis.del(...keys);
  await admin().lab(false);
});

async function control(c: TestClient, t: Parameters<TestClient["send"]>[0], body: Record<string, unknown>) {
  const id = c.send(t, body);
  const f = await c.next((x) => (x.t === "receipt" || x.t === "error") && x.body.of === id);
  return f.t === "receipt" ? "accepted" : (f.body as { code: string }).code;
}

/** A request from `from` to `to`, sealed to `to`'s encryption key exactly as the app seals it. */
async function sealedRequest(from: TestDevice, to: TestDevice) {
  const id = ulid();
  const payload = from.samplePayload("verify.request", to.deviceId, id);
  const e2e = await seal(
    payload,
    { kind: "verify.request", id, from: from.deviceId, to: to.deviceId, re: id },
    b64urlDecode(to.ek),
    from.sign.privateKey,
  );
  return { id, body: { kind: "verify.request", to: to.deviceId, re: id, grant: to.cardGrant, ttlMs: 60_000, e2e } };
}

/** What happened to a send: "accepted", or the refusal's reason. */
async function outcome(c: TestClient, id: string) {
  const f = await c.next((x) => (x.t === "receipt" && x.body.of === id) || (x.t === "error" && x.body.of === id));
  if (f.t === "receipt") return f.body.state === "accepted" ? "accepted" : (f.body.reason ?? f.body.state);
  return (f.body as { code: string }).code;
}

describe("REL-18 · E2E_REQUIRED (9.5)", () => {
  it("hello tells every app that readable envelopes will be refused", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay());
    expect(c.hello!.t === "hello" && c.hello!.body.e2eRequired).toBe(true);
  });

  it("a sealed envelope is accepted and delivered exactly as sent", async () => {
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const [m, a] = [await maa.login(relay()), await arjun.login(relay())];
    const r = await sealedRequest(maa, arjun);
    m.send("send", r.body, r.id);
    expect(await outcome(m, r.id)).toBe("accepted");
    const got = await a.type("deliver", (f) => f.body.re === r.id);
    expect(got.body.e2e).toEqual(r.body.e2e);
    expect(got.body.plain).toBeUndefined();
  });

  it("a readable envelope is refused (e2e_required), for every kind", async () => {
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const m = await maa.login(relay());
    await arjun.login(relay());
    for (const kind of ["verify.request", "alert", "guard.prompt"] as const) {
      const r = await maa.plainSend(kind, arjun, { grant: arjun.cardGrant });
      m.send("send", r.body, r.id);
      expect(await outcome(m, r.id), kind).toBe("e2e_required");
    }
  });

  it("readable only between two phones opted in to a Lab that is on; one end, or the switch off, is not enough", async () => {
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const [m, a] = [await maa.login(relay()), await arjun.login(relay())];
    // Alerts: the same readable-or-sealed rule as requests, without the 3-a-minute per-pair request limit.
    const plain = async () => {
      const r = await maa.plainSend("alert", arjun, { grant: arjun.cardGrant });
      m.send("send", r.body, r.id);
      return outcome(m, r.id);
    };
    await admin().lab(true);
    expect(await control(m, "lab.optin", { password: PASSWORD })).toBe("accepted");
    expect(await plain()).toBe("e2e_required"); // only Maa opted in
    expect(await control(a, "lab.optin", { password: PASSWORD })).toBe("accepted");
    expect(await plain()).toBe("accepted"); // both opted in, Lab on
    await admin().lab(false);
    expect(await plain()).toBe("e2e_required"); // switched off: sealed again
  });
});
