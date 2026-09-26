// CON-01 grants, CON-02 first contact, CON-03 revocation, C-6.4a revoked stays revoked, SEC-04 binding bypass.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("contacts");
});
afterAll(() => env.cleanup());

const relay = () => env.relays[0]!;

async function tryRequest(from: TestDevice, to: TestDevice, grant?: string) {
  // These tests are about authorisation; the per-pair rate limit (3/min, burst 2) is REL-16's subject, and it
  // counts refused attempts too (that is what stops grant guessing), so reset it between attempts.
  await env.iso.redis.del(`${env.iso.keyPrefix}rl:request_pair:${from.deviceId}>${to.deviceId}`);
  const c = await from.login(relay());
  const r = await from.plainSend("verify.request", to, grant ? { grant } : {});
  c.send("send", r.body, r.id);
  const outcome = await Promise.race([
    c.receipt(r.id, "accepted").then(() => "accepted"),
    c.error(r.id).then((e) => e.body.code),
  ]);
  c.close();
  return outcome;
}

describe("CON-01 · grants", () => {
  it("stores only SHA-256 of the secret", async () => {
    const d = await TestDevice.create();
    (await d.login(relay())).close();
    const r = await env.iso.pool.query(
      "select grant_id, encode(secret_hash, 'base64') as h from contact_grants where target_device_id = $1",
      [d.deviceId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].grant_id).toBe(d.grant.id);
    expect(Buffer.from(r.rows[0].h, "base64").toString("base64url")).toBe(d.grant.hash);
    const everything = JSON.stringify((await env.iso.pool.query("select * from contact_grants")).rows);
    expect(everything).not.toContain(d.grant.secret);
  });

  it("rotate revokes every older grant; re-sending an old grant never revives it", async () => {
    const arjun = await TestDevice.create();
    const c = await arjun.login(relay());
    const old = arjun.cardGrant;
    arjun.grant = TestDevice.newGrant();
    const id = c.send("grant.set", { grantId: arjun.grant.id, hash: arjun.grant.hash, rotate: true });
    await c.receipt(id, "accepted");
    // An old app sending the old grant again (rotate: false) must not re-activate it.
    const [oldId] = old.split(".");
    const hash = (
      await env.iso.pool.query("select encode(secret_hash,'base64') h from contact_grants where grant_id=$1", [oldId])
    ).rows[0].h;
    const again = c.send("grant.set", {
      grantId: oldId!,
      hash: Buffer.from(hash, "base64").toString("base64url"),
      rotate: false,
    });
    await c.receipt(again, "accepted");
    c.close();
    const rows = await env.iso.pool.query(
      "select grant_id, revoked_at is not null as revoked from contact_grants where target_device_id=$1",
      [arjun.deviceId],
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.grant_id, r.revoked]))).toEqual({
      [oldId!]: true,
      [arjun.grant.id]: false,
    });
    const stranger = await TestDevice.create();
    expect(await tryRequest(stranger, arjun, old)).toBe("not_allowed");
    expect(await tryRequest(stranger, arjun, arjun.cardGrant)).toBe("accepted");
  });
});

describe("CON-02 · first contact", () => {
  it("a valid grant creates the binding; later messages need no grant", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(relay())).close();
    expect(await tryRequest(maa, arjun, arjun.cardGrant)).toBe("accepted");
    const b = await env.iso.pool.query(
      "select via_grant_id from contact_bindings where target_device_id=$1 and sender_device_id=$2",
      [arjun.deviceId, maa.deviceId],
    );
    expect(b.rows[0].via_grant_id).toBe(arjun.grant.id);
    expect(await tryRequest(maa, arjun)).toBe("accepted"); // bound now
  });

  it("an invalid grant, or no grant and no binding → not_allowed", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(relay())).close();
    expect(await tryRequest(maa, arjun)).toBe("not_allowed");
    expect(await tryRequest(maa, arjun, `${arjun.grant.id}.${TestDevice.newGrant().secret}`)).toBe("not_allowed");
    expect(await tryRequest(maa, arjun, `${TestDevice.newGrant().id}.${arjun.grant.secret}`)).toBe("not_allowed");
  });

  it("a device the relay has never seen → unknown_target", async () => {
    const maa = await TestDevice.create();
    const ghost = await TestDevice.create();
    expect(await tryRequest(maa, ghost, ghost.cardGrant)).toBe("unknown_target");
  });
});

describe("CON-03 · revocation", () => {
  it("a revoked sender is refused even with a valid grant; unrevoke by the target works (C-6.4a)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(relay());
    expect(await tryRequest(maa, arjun, arjun.cardGrant)).toBe("accepted");
    await a.receipt(a.send("contact.revoke", { deviceId: maa.deviceId }), "accepted");
    expect(await tryRequest(maa, arjun, arjun.cardGrant)).toBe("not_allowed");
    await a.receipt(a.send("contact.unrevoke", { deviceId: maa.deviceId }), "accepted");
    expect(await tryRequest(maa, arjun)).toBe("accepted");
    const list = a.send("contact.list", {});
    void list;
    const res = await a.type("contact.list.result");
    expect(res.body.contacts).toEqual([expect.objectContaining({ deviceId: maa.deviceId, via: "unrevoked" })]);
    a.close();
  });

  it("revoking a device that never contacted me blocks it before its first contact", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await maa.login(relay())).close(); // Maa's device exists, but has never contacted Arjun
    const a = await arjun.login(relay());
    await a.receipt(a.send("contact.revoke", { deviceId: maa.deviceId }), "accepted");
    expect(await tryRequest(maa, arjun, arjun.cardGrant)).toBe("not_allowed");
    a.close();
  });

  it("a revoked row survives the blocked device retiring (it can't erase its own block)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(relay());
    expect(await tryRequest(maa, arjun, arjun.cardGrant)).toBe("accepted");
    await a.receipt(a.send("contact.revoke", { deviceId: maa.deviceId }), "accepted");
    const m = await maa.login(relay());
    await m.receipt(m.send("device.retire", {}), "accepted");
    await m.closed;
    const rows = await env.iso.pool.query(
      "select revoked_at is not null as revoked from contact_bindings where target_device_id=$1 and sender_device_id=$2",
      [arjun.deviceId, maa.deviceId],
    );
    expect(rows.rows).toEqual([{ revoked: true }]);
    a.close();
  });

  it("SEC-04 · a new identity with a rotated-away grant is refused", async () => {
    const arjun = await TestDevice.create();
    const a = await arjun.login(relay());
    const oldCard = arjun.cardGrant;
    arjun.grant = TestDevice.newGrant();
    await a.receipt(a.send("grant.set", { grantId: arjun.grant.id, hash: arjun.grant.hash, rotate: true }), "accepted");
    const reinstall = await TestDevice.create(); // "Maa" reinstalled: a new device ID holding the old card
    expect(await tryRequest(reinstall, arjun, oldCard)).toBe("not_allowed");
    a.close();
  });
});
