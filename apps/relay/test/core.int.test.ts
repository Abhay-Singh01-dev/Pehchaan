// Core services called directly against real Valkey and Postgres: branches that are awkward to reach over a
// socket (a duplicate still in flight, a push that errors, an expired frame), and the Lab rows of the 16.3
// table with a stand-in for the Lab module's two questions ("is the Lab on?", "is this device opted in?").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "@pehchaan/protocol";
import { labAvailable, mayInject, mayReport, plainAllowed } from "../src/core/authz";
import type { LabModule } from "../src/lab/lab";
import type { Push } from "../src/push/push";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("core");
});
afterAll(() => env.cleanup());
const hub = () => env.relays[0]!.hub;

const labStandIn = (on: boolean, optedIn: string[]): LabModule =>
  ({ isOn: async () => on, isOptedIn: async (d: string) => optedIn.includes(d) }) as unknown as LabModule;

describe("16.3 rows 10–13 (the Lab and plain)", () => {
  it("row 10 · lab.* needs the module loaded and switched on", async () => {
    const h = hub();
    await expect(labAvailable(h)).rejects.toMatchObject({ code: "lab_disabled" });
    h.lab = labStandIn(false, []);
    await expect(labAvailable(h)).rejects.toMatchObject({ code: "lab_disabled" });
    h.lab = labStandIn(true, []);
    await expect(labAvailable(h)).resolves.toBeUndefined();
    h.lab = null;
  });

  it("row 11 · lab.inject needs both ends opted in", async () => {
    const h = hub();
    h.lab = labStandIn(true, ["a"]);
    await expect(mayInject(h, "a", "b")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(mayInject(h, "b", "a")).rejects.toMatchObject({ code: "not_allowed" });
    h.lab = labStandIn(true, ["a", "b"]);
    await expect(mayInject(h, "a", "b")).resolves.toBeUndefined();
    h.lab = null;
  });

  it("row 12 · lab.report only from the request's asker", async () => {
    const h = hub();
    const re = ulid();
    await h.requests.create(
      re,
      "asker-device-0000000000",
      ["target-device-000000000"],
      Date.now() + 60_000,
      Date.now(),
    );
    await expect(mayReport(h, "asker-device-0000000000", re)).resolves.toBeUndefined();
    await expect(mayReport(h, "target-device-000000000", re)).rejects.toMatchObject({ code: "not_allowed" });
    await expect(mayReport(h, "asker-device-0000000000", ulid())).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("row 13 · plain: always while E2E isn't required; otherwise only between two opted-in devices", async () => {
    const h = hub();
    expect(await plainAllowed(h, "a", "b")).toBe(true);
    const strict = { ...h, config: { ...h.config, E2E_REQUIRED: true } };
    expect(await plainAllowed(strict, "a", "b")).toBe(false); // Lab not loaded
    strict.lab = labStandIn(false, ["a", "b"]);
    expect(await plainAllowed(strict, "a", "b")).toBe(false); // Lab off
    strict.lab = labStandIn(true, ["a"]);
    expect(await plainAllowed(strict, "a", "b")).toBe(false); // only one end
    strict.lab = labStandIn(true, ["a", "b"]);
    expect(await plainAllowed(strict, "a", "b")).toBe(true);
  });
});

describe("core services", () => {
  it("dedupe: a duplicate arriving while the first is still in flight has no outcome yet", async () => {
    const h = hub();
    const id = ulid();
    expect(await h.dedupe.claim("dev", id)).toEqual({ first: true });
    expect(await h.dedupe.claim("dev", id)).toEqual({ first: false, outcome: null });
    await h.dedupe.record("dev", id, { receipt: { of: id, state: "accepted" } });
    expect(await h.dedupe.claim("dev", id)).toEqual({
      first: false,
      outcome: { receipt: { of: id, state: "accepted" } },
    });
  });

  it("requests.get reports who answered", async () => {
    const h = hub();
    const re = ulid();
    await h.requests.create(
      re,
      "asker-device-0000000001",
      ["target-device-000000001"],
      Date.now() + 60_000,
      Date.now(),
    );
    await h.requests.answer(re, "target-device-000000001", "asker-device-0000000001", Date.now());
    expect(await h.requests.get(re)).toMatchObject({ state: "answered", by: "target-device-000000001" });
    expect(await h.requests.get(ulid())).toBeNull();
  });

  it("the inbox never stores an envelope with no time left", async () => {
    const now = Date.now();
    const s = {
      frame: {
        v: 1 as const,
        t: "deliver" as const,
        id: ulid(),
        sts: now,
        body: { from: "x", kind: "alert", ttlMs: 0 },
      },
      expiresAt: now,
    };
    expect(await hub().inbox.put("nobody-00000000000000", s, now)).toBe(true);
    expect(await hub().inbox.size("nobody-00000000000000")).toBe(0);
  });

  it("routing to a device with no socket: an expired envelope is never pushed; a push error is `failed`", async () => {
    const h = hub();
    const target = await TestDevice.create();
    (await target.login(env.relays[0]!)).close();
    await new Promise((r) => setTimeout(r, 200));
    const erroring: Push = {
      send: async () => {
        throw new Error("push service down");
      },
      sendTest: async () => "failed",
      status: async () => "missing",
      close: async () => {},
    };
    const saved = h.push;
    h.push = erroring;
    const now = Date.now();
    const frame = (expiresAt: number) => ({
      frame: {
        v: 1 as const,
        t: "deliver" as const,
        id: ulid(),
        sts: now,
        body: { from: "x", kind: "alert", ttlMs: 0 },
      },
      expiresAt,
    });
    expect(await h.router.route(target.deviceId, frame(now + 60_000), { inbox: false, push: true })).toBe("failed");
    expect(await h.router.route(target.deviceId, frame(now - 1), { inbox: false, push: true })).toBe("failed");
    expect(await h.router.route(target.deviceId, frame(now + 60_000), { inbox: false, push: false })).toBe("queued");
    h.push = saved;
  });
});
