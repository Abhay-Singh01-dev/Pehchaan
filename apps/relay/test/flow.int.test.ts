// A complete check on the wire (Appendix A): request → accepted → deliver → ack → delivered → seen →
// answer → deliver to the asker. Also REL-07's accepted / delivered / seen / queued / rejected receipts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("flow");
});
afterAll(() => env.cleanup());

describe("one check, end to end through the relay", () => {
  it("request → deliver → ack → delivered → seen → answer → deliver", async () => {
    const relay = env.relays[0]!;
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const m = await maa.login(relay);
    const a = await arjun.login(relay);

    // Maa asks, presenting Arjun's grant from his card (first contact).
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    expect((await m.receipt(req.id, "accepted")).body.re).toBe(req.re);

    // Arjun gets it with the time left on the relay's clock.
    const d = await a.type("deliver", (f) => f.id === req.id);
    expect(d.body).toMatchObject({ from: maa.deviceId, kind: "verify.request", re: req.re });
    expect(d.body.ttlMs).toBeGreaterThan(55_000);
    expect(d.body.ttlMs).toBeLessThanOrEqual(60_000);
    expect(d.body.plain).toEqual(req.body.plain);

    // He acks it (Maa hears "delivered") and opens it (Maa hears "seen").
    a.send("ack", { of: req.id });
    expect((await m.receipt(req.id, "delivered")).body.to).toBe(arjun.deviceId);
    a.send("seen", { re: req.re! });
    await m.receipt(req.re!, "seen");

    // He answers; no binding is needed for answers (the request record authorises them).
    const ans = await arjun.plainSend("verify.answer", maa, { re: req.re });
    a.send("send", ans.body, ans.id);
    await a.receipt(ans.id, "accepted");
    const got = await m.type("deliver", (f) => f.id === ans.id);
    expect(got.body).toMatchObject({ from: arjun.deviceId, kind: "verify.answer", re: req.re });
    expect(got.body.late).toBeUndefined();
    m.close();
    a.close();
  });

  it("queued when the recipient is offline and has no push subscription; rejected when not allowed", async () => {
    const relay = env.relays[0]!;
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(relay)).close();
    const m = await maa.login(relay);
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await m.receipt(req.id, "accepted");
    expect((await m.receipt(req.id, "queued")).body.to).toBe(arjun.deviceId);

    const stranger = await TestDevice.create();
    const s = await stranger.login(relay);
    const bad = await stranger.plainSend("verify.request", arjun); // no grant, no binding
    s.send("send", bad.body, bad.id);
    expect((await s.receipt(bad.id, "rejected")).body.reason).toBe("not_allowed");
    expect((await s.error(bad.id)).body.code).toBe("not_allowed");
    m.close();
    s.close();
  });
});
