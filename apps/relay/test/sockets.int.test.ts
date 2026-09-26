// REL-03 heartbeats and REL-04 several sockets per device (7.1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSE } from "@pehchaan/protocol";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("sockets", { env: { RELAY_PING_MS: "150" } });
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;

describe("REL-03 · heartbeats", () => {
  it("terminates a socket that misses two pongs (logged in or not)", async () => {
    const c = await TestClient.open(relay(), { autoPong: false });
    await c.type("hello");
    const t0 = Date.now();
    const closed = await c.closed;
    expect(closed.code).toBe(1006); // terminated, not closed politely
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("keeps a socket that answers pings", async () => {
    const d = await TestDevice.create();
    const c = await d.login(relay(), { grant: false });
    await sleep(900);
    c.send("ping", {});
    await c.type("pong");
    c.close();
  });
});

describe("REL-04 · up to 3 sockets per device", () => {
  it("delivers to all of them, counts only the first ack, and replaces the oldest with a 4th (4409)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const tabs = [await arjun.login(relay()), await arjun.login(relay()), await arjun.login(relay())];
    const m = await maa.login(relay());

    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await Promise.all(tabs.map((t) => t.type("deliver", (f) => f.id === req.id)));
    tabs[0]!.send("ack", { of: req.id });
    tabs[1]!.send("ack", { of: req.id });
    tabs[2]!.send("ack", { of: req.id });
    await m.receipt(req.id, "delivered");
    await sleep(300);
    expect(m.all("receipt").filter((r) => r.body.state === "delivered")).toHaveLength(1);

    const fourth = await arjun.login(relay());
    expect((await tabs[0]!.closed).code).toBe(CLOSE.REPLACED);
    expect(relay().hub.sessions.get(arjun.deviceId)).toHaveLength(3);
    [tabs[1], tabs[2], fourth, m].forEach((c) => c!.close());
  });
});
