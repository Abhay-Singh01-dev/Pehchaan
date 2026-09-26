// REL-22: logs captured during full flows contain no payload, nonce, signature, grant, endpoint, name, label or
// phone number (16.7). The relay logs at debug level here, so every log line it can write is exercised.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("logleak", { env: { LOG_LEVEL: "trace" } });
});
afterAll(() => env.cleanup());

describe("REL-22 · no personal data or secrets in logs", () => {
  it("a full flow leaves nothing sensitive in the log stream", async () => {
    const r = env.relays[0]!;
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(r);
    const m = await maa.login(r);
    const req = await maa.plainSend("verify.request", arjun, { grant: arjun.cardGrant });
    m.send("send", req.body, req.id);
    await a.type("deliver", (f) => f.id === req.id);
    a.send("ack", { of: req.id });
    const ans = await arjun.plainSend("verify.answer", maa, { re: req.re });
    a.send("send", ans.body, ans.id);
    await m.type("deliver", (f) => f.id === ans.id);
    const al = await maa.plainSend("alert", arjun);
    m.send("send", al.body, al.id);
    await a.type("deliver", (f) => f.id === al.id);
    m.send("push.subscribe", {
      endpoint: "https://fcm.googleapis.com/fcm/send/secret-endpoint-token",
      p256dh: maa.ek,
      auth: "AAAAAAAAAAAAAAAAAAAAAA",
      vapidKeyId: "v1",
    });
    // A failed login and a bad frame, too.
    const bad = await TestDevice.create();
    await bad.login(r).catch(() => {});
    m.ws.send("{not json");
    await new Promise((res) => setTimeout(res, 300));
    a.close();
    m.close();
    await new Promise((res) => setTimeout(res, 100));

    const text = env.logs.join("\n");
    expect(env.logs.length).toBeGreaterThan(2); // the relay did log
    const reqPlain = req.body.plain as { req: { nonce: string }; fromName: string };
    const forbidden = [
      reqPlain.req.nonce,
      reqPlain.fromName,
      "Arjun",
      "Sunita",
      arjun.grant.secret,
      arjun.cardGrant,
      req.body.psig,
      ans.body.psig,
      maa.dk,
      arjun.dk,
      maa.deviceId,
      arjun.deviceId,
      "secret-endpoint-token",
      "fcm.googleapis.com",
      "127.0.0.1",
    ];
    for (const f of forbidden) expect(text.includes(f), `log contains ${f.slice(0, 12)}…`).toBe(false);
  });
});
