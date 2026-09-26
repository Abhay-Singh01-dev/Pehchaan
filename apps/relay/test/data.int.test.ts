// Phase 4: CON-04 … CON-13 and C-16.8a (contacts, data, presence, admin).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLOSE } from "@pehchaan/protocol";
import { createAdmin } from "../src/admin/commands";
import { AUDIT_KINDS } from "../src/store/schema";
import { TestClient, TestDevice, sleep } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

let env: Env;
beforeAll(async () => {
  env = await setupRelays("data", { count: 2 });
});
afterAll(() => env.cleanup());

const A = () => env.relays[0]!;
const B = () => env.relays[1]!;
const P = () => env.iso.keyPrefix;
const q = (sql: string, args: unknown[] = []) => env.iso.pool.query(sql, args);
const admin = () =>
  createAdmin({
    store: A().hub.store,
    redis: A().hub.redis,
    keys: A().hub.keys,
    bus: A().hub.bus,
    audit: A().hub.audit,
    retire: (d) => A().hub.retire(d, "admin"),
  });

/** Many logins from one test IP would hit the per-IP connection limit (REL-01's subject, not these tests'). */
const resetIp = () => env.iso.redis.del(`${P()}rl:upgrade_ip:${A().hub.limiter.ipKey("127.0.0.1")}`);

/** First (or later) contact from `from` to `to`, by alert: alerts need exactly the same binding or grant as
 *  requests (16.3 rows 2 and 7), without the per-pair and open-request limits that requests also have. */
async function contact(from: TestDevice, to: TestDevice, relay = A()) {
  await resetIp();
  const c = await from.login(relay);
  const r = await from.plainSend("alert", to, { grant: to.cardGrant });
  c.send("send", r.body, r.id);
  const outcome = await Promise.race([
    c.receipt(r.id, "accepted").then(() => "accepted"),
    c.error(r.id).then((e) => e.body.code),
  ]);
  c.close();
  return outcome;
}

beforeEach(() => resetIp());

describe("CON-04 · retire", () => {
  it("tombstones the device, refuses its logins (4403), and deletes exactly what 6.6 says", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const papa = await TestDevice.create();
    const blocker = await TestDevice.create();
    const a = await arjun.login(A());
    (await papa.login(A())).close();
    const bl = await blocker.login(A());
    expect(await contact(arjun, maa.deviceId === "" ? papa : papa)).toBe("accepted"); // papa ← arjun (arjun is sender)
    (await maa.login(A())).close();
    expect(await contact(maa, arjun)).toBe("accepted"); // arjun ← maa (arjun is target)
    expect(await contact(arjun, blocker)).toBe("accepted"); // blocker ← arjun …
    await bl.receipt(bl.send("contact.revoke", { deviceId: arjun.deviceId }), "accepted"); // … then revoked
    const sub = a.send("push.subscribe", {
      endpoint: "https://fcm.googleapis.com/fcm/send/arjun-1",
      p256dh: arjun.ek,
      auth: "AAAAAAAAAAAAAAAAAAAAAA",
      vapidKeyId: "v1",
    });
    await a.receipt(sub, "accepted");
    const now = Date.now();
    await A().hub.inbox.put(
      arjun.deviceId,
      {
        frame: {
          v: 1,
          t: "deliver",
          id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
          sts: now,
          body: { from: maa.deviceId, kind: "alert", ttlMs: 0 },
        },
        expiresAt: now + 60_000,
      },
      now,
    );

    const other = await arjun.login(B()); // a socket on the other gateway too
    await a.receipt(a.send("device.retire", {}), "accepted");
    expect((await a.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
    expect((await other.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);

    const dev = (
      await q(
        "select retired_at is not null as retired, platform, app_version, length(device_pub) len from devices where device_id=$1",
        [arjun.deviceId],
      )
    ).rows[0];
    expect(dev).toEqual({ retired: true, platform: null, app_version: null, len: 65 });
    expect((await q("select 1 from contact_grants where target_device_id=$1", [arjun.deviceId])).rowCount).toBe(0);
    expect((await q("select 1 from push_subscriptions where device_id=$1", [arjun.deviceId])).rowCount).toBe(0);
    expect((await q("select 1 from contact_bindings where target_device_id=$1", [arjun.deviceId])).rowCount).toBe(0);
    // As sender: the allowed binding (papa ← arjun) is gone; the REVOKED one (blocker ← arjun) stays.
    const asSender = (
      await q("select target_device_id t, revoked_at is not null r from contact_bindings where sender_device_id=$1", [
        arjun.deviceId,
      ])
    ).rows;
    expect(asSender).toEqual([{ t: blocker.deviceId, r: true }]);
    expect(await A().hub.inbox.size(arjun.deviceId)).toBe(0);
    expect((await q("select count(*)::int n from audit_events where kind='device_retired'")).rows[0].n).toBeGreaterThan(
      0,
    );

    const c = await TestClient.open(A());
    const h = await c.type("hello");
    c.send("auth", await arjun.authBody(h.body.serverNonce));
    expect((await c.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
    bl.close();
  });
});

describe("CON-05 · binding limits", () => {
  it("20 new bindings a day per target (burst 5) and per sender (burst 5)", async () => {
    const target = await TestDevice.create();
    (await target.login(A())).close();
    const senders = await Promise.all(Array.from({ length: 6 }, () => TestDevice.create()));
    const outcomes: string[] = [];
    for (const s of senders) outcomes.push(await contact(s, target));
    expect(outcomes.slice(0, 5)).toEqual(Array(5).fill("accepted"));
    expect(outcomes[5]).toBe("rate_limited");

    const sender = await TestDevice.create();
    const targets = await Promise.all(Array.from({ length: 6 }, () => TestDevice.create()));
    for (const t of targets) (await t.login(A())).close();
    const out2: string[] = [];
    for (const t of targets) out2.push(await contact(sender, t));
    expect(out2.slice(0, 5)).toEqual(Array(5).fill("accepted"));
    expect(out2[5]).toBe("rate_limited");
  });

  it("at most 50 bindings per target", async () => {
    const target = await TestDevice.create();
    (await target.login(A())).close();
    for (let i = 0; i < 50; i++) {
      const s = await TestDevice.create();
      await q("insert into devices (device_id, device_pub) values ($1, $2)", [
        s.deviceId,
        Buffer.from(s.dk, "base64url"),
      ]);
      await q("insert into contact_bindings (target_device_id, sender_device_id, via_grant_id) values ($1,$2,'x')", [
        target.deviceId,
        s.deviceId,
      ]);
    }
    await env.iso.redis.del(`${P()}cb:${target.deviceId}`);
    const late = await TestDevice.create();
    expect(await contact(late, target)).toBe("not_allowed");
  });
});

describe("CON-06 / SEC-12 · presence", () => {
  it("online, push and offline for devices that accept me; strangers are always offline; no timestamps", async () => {
    const maa = await TestDevice.create();
    const online = await TestDevice.create();
    const pocket = await TestDevice.create();
    const off = await TestDevice.create();
    const stranger = await TestDevice.create();
    const o = await online.login(B());
    const p = await pocket.login(A());
    const sub = p.send("push.subscribe", {
      endpoint: "https://fcm.googleapis.com/fcm/send/pocket",
      p256dh: pocket.ek,
      auth: "AAAAAAAAAAAAAAAAAAAAAA",
      vapidKeyId: "v1",
    });
    await p.receipt(sub, "accepted");
    p.close();
    (await off.login(A())).close();
    const s = await stranger.login(A());
    for (const t of [online, pocket, off]) expect(await contact(maa, t)).toBe("accepted");
    await sleep(200);
    const m = await maa.login(A());
    m.send("presence.query", { ids: [online.deviceId, pocket.deviceId, off.deviceId, stranger.deviceId] });
    const res = await m.type("presence");
    expect(res.body).toEqual({
      states: {
        [online.deviceId]: "online",
        [pocket.deviceId]: "push",
        [off.deviceId]: "offline",
        [stranger.deviceId]: "offline",
      },
    });
    [o, s, m].forEach((c) => c.close());
  });
});

describe("CON-07 · contact.list, and no personal data in the schema", () => {
  it("lists who can reach me by device ID and date, never by name", async () => {
    const arjun = await TestDevice.create();
    const maa = await TestDevice.create();
    const a = await arjun.login(A());
    expect(await contact(maa, arjun)).toBe("accepted");
    a.send("contact.list", {});
    const res = await a.type("contact.list.result");
    expect(res.body.contacts).toEqual([{ deviceId: maa.deviceId, since: expect.any(Number), via: "grant" }]);
    a.close();
  });

  it("has no column that could hold a name, label, phone number, amount or message", async () => {
    const cols = (
      await q("select table_name, column_name from information_schema.columns where table_schema = $1", [
        env.iso.schema,
      ])
    ).rows;
    const bad = cols.filter(
      (c) =>
        /name|label|phone|amount|message|content|text|nonce|ip/i.test(c.column_name) &&
        c.column_name !== "block_reason",
    );
    expect(bad).toEqual([]);
  });
});

describe("CON-08 · caches", () => {
  it("are deleted on change: bindings, grants, push subscriptions, device status", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    const a = await arjun.login(A());
    expect(await contact(maa, arjun)).toBe("accepted");
    expect(await contact(maa, arjun)).toBe("accepted"); // fills cb:
    expect(await env.iso.redis.exists(`${P()}cb:${arjun.deviceId}`)).toBe(1);
    await a.receipt(a.send("contact.revoke", { deviceId: maa.deviceId }), "accepted");
    expect(await env.iso.redis.exists(`${P()}cb:${arjun.deviceId}`)).toBe(0);

    expect(await env.iso.redis.exists(`${P()}cg:${arjun.deviceId}`)).toBe(1);
    arjun.grant = TestDevice.newGrant();
    await a.receipt(a.send("grant.set", { grantId: arjun.grant.id, hash: arjun.grant.hash, rotate: true }), "accepted");
    expect(await env.iso.redis.exists(`${P()}cg:${arjun.deviceId}`)).toBe(0);

    await A().hub.subscriptions.status(arjun.deviceId);
    expect(await env.iso.redis.exists(`${P()}ps:${arjun.deviceId}`)).toBe(1);
    await a.receipt(
      a.send("push.subscribe", {
        endpoint: "https://fcm.googleapis.com/fcm/send/c8",
        p256dh: arjun.ek,
        auth: "AAAAAAAAAAAAAAAAAAAAAA",
        vapidKeyId: "v1",
      }),
      "accepted",
    );
    expect(await env.iso.redis.exists(`${P()}ps:${arjun.deviceId}`)).toBe(0);

    await A().hub.devices.status(arjun.deviceId);
    await admin().block(arjun.deviceId, "test");
    expect(await env.iso.redis.hget(`${P()}dv:${arjun.deviceId}`, "exists")).toBeNull();
    await admin().unblock(arjun.deviceId);
  });
});

describe("CON-09 · retention (time travel)", () => {
  it("deletes per 15.3 and tombstones devices unseen for 12 months", async () => {
    const old = await TestDevice.create();
    const fresh = await TestDevice.create();
    const blocker = await TestDevice.create();
    (await old.login(A())).close();
    (await fresh.login(A())).close();
    (await blocker.login(A())).close();
    expect(await contact(old, fresh)).toBe("accepted"); // fresh ← old (allowed)
    await q("insert into contact_bindings (target_device_id, sender_device_id, revoked_at) values ($1,$2,now())", [
      blocker.deviceId,
      old.deviceId,
    ]);
    await q("update devices set last_seen_on = current_date - interval '13 months' where device_id=$1", [old.deviceId]);
    await q(
      "insert into push_subscriptions (device_id, endpoint, p256dh, auth, vapid_key_id, expired_at) values ($1,'https://fcm.googleapis.com/x-old','p','a','v1', now() - interval '31 days'), ($1,'https://fcm.googleapis.com/x-new','p','a','v1', now() - interval '29 days')",
      [fresh.deviceId],
    );
    await q(
      "insert into audit_events (at, kind) values (now() - interval '366 days', 'device_first_seen'), (now() - interval '364 days', 'device_first_seen')",
    );
    await q(
      "insert into lab_attacks (at, attack, asker, answerer) values (now() - interval '91 days','change','a','b'), (now() - interval '89 days','forge','a','b')",
    );

    await admin().retention();

    expect((await q("select retired_at is not null r from devices where device_id=$1", [old.deviceId])).rows[0].r).toBe(
      true,
    );
    expect((await q("select retired_at is null r from devices where device_id=$1", [fresh.deviceId])).rows[0].r).toBe(
      true,
    );
    expect((await q("select 1 from contact_grants where target_device_id=$1", [old.deviceId])).rowCount).toBe(0);
    expect(
      (await q("select revoked_at is not null r from contact_bindings where sender_device_id=$1", [old.deviceId])).rows,
    ).toEqual([{ r: true }]);
    expect(
      (await q("select endpoint from push_subscriptions where device_id=$1", [fresh.deviceId])).rows.map(
        (r) => r.endpoint,
      ),
    ).toEqual(["https://fcm.googleapis.com/x-new"]);
    expect((await q("select count(*)::int n from audit_events where at < now() - interval '1 year'")).rows[0].n).toBe(
      0,
    );
    expect((await q("select count(*)::int n from audit_events where at < now() - interval '300 days'")).rows[0].n).toBe(
      1,
    );
    expect((await q("select attack from lab_attacks")).rows.map((r) => r.attack)).toEqual(["forge"]);
    // Running it again changes nothing (idempotent).
    await admin().retention();
    expect((await q("select attack from lab_attacks")).rows).toHaveLength(1);
  });
});

describe("CON-10 · migrations", () => {
  it("apply from empty (every test file starts from an empty schema) and are recorded", async () => {
    const r = await q(`select count(*)::int n from "${env.iso.schema}".__drizzle_migrations`);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it("destructive statements are refused unless the file is marked as a contract step", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const { checkMigrations } = (await import(join(here, "..", "..", "..", "scripts", "check-migrations.mjs"))) as {
      checkMigrations: (dir?: string) => string[];
    };
    expect(checkMigrations()).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(
      join(dir, "0001_add.sql"),
      "ALTER TABLE devices ADD COLUMN note_kind text;\n-- drop table is mentioned only in a comment\n",
    );
    writeFileSync(
      join(dir, "0002_drop.sql"),
      'ALTER TABLE "devices" DROP COLUMN "platform";--> statement-breakpoint\nDELETE FROM audit_events;',
    );
    const problems = checkMigrations(dir);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/drops something/);
    expect(problems.join("\n")).toMatch(/deletes rows/);
    writeFileSync(
      join(dir, "0002_drop.sql"),
      "-- pehchaan:contract-step (platform unused since 1.4)\nALTER TABLE devices DROP COLUMN platform;",
    );
    expect(checkMigrations(dir)).toEqual([]);
  });
});

describe("CON-11 · self-healing", () => {
  it("wiping the allowed bindings: the next message carrying the grant rebuilds them", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    expect(await contact(maa, arjun)).toBe("accepted");
    await q("delete from contact_bindings where target_device_id=$1 and revoked_at is null", [arjun.deviceId]);
    await env.iso.redis.del(`${P()}cb:${arjun.deviceId}`);
    expect(await contact(maa, arjun)).toBe("accepted"); // the app keeps including the grant
    expect(
      (
        await q("select 1 from contact_bindings where target_device_id=$1 and sender_device_id=$2", [
          arjun.deviceId,
          maa.deviceId,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("wiping Valkey: logins, grants and routes come back by themselves (see also REL-05)", async () => {
    const maa = await TestDevice.create();
    const arjun = await TestDevice.create();
    (await arjun.login(A())).close();
    expect(await contact(maa, arjun)).toBe("accepted");
    await env.iso.redis.del(...(await env.iso.keys()));
    const a = await arjun.login(B());
    expect(await contact(maa, arjun)).toBe("accepted");
    a.close();
  });
});

describe("CON-12 · admin CLI", () => {
  it("block closes the device's sockets on every gateway with 4403 and refuses logins; unblock restores it", async () => {
    const d = await TestDevice.create();
    const onA = await d.login(A());
    const onB = await d.login(B());
    expect(await admin().block(d.deviceId, "spam")).toBe(true);
    expect((await onA.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
    expect((await onB.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
    const c = await TestClient.open(A());
    const h = await c.type("hello");
    c.send("auth", await d.authBody(h.body.serverNonce));
    expect((await c.closed).code).toBe(CLOSE.RETIRED_OR_BLOCKED);
    expect(await admin().unblock(d.deviceId)).toBe(true);
    (await d.login(A())).close();
    expect(await admin().block("NoSuchDeviceXXXXXXXXXX", "x")).toBe(false);
  });

  it("stats are counts only; lab on/off sets and clears the 12-hour switch", async () => {
    const s = await admin().stats();
    for (const v of Object.values(s)) expect(typeof v).toBe("number");
    await admin().lab(true);
    const ttl = await env.iso.redis.pttl(`${P()}cfg:lab`);
    expect(ttl).toBeGreaterThan(12 * 3600_000 - 5000);
    await admin().lab(false);
    expect(await env.iso.redis.exists(`${P()}cfg:lab`)).toBe(0);
  });

  it("the CLI itself runs (stats, and usage for an unknown command)", () => {
    const relayDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "src/admin.ts", ...args], {
        cwd: relayDir,
        env: { ...process.env, ...env.env, LOG_LEVEL: "silent" },
        encoding: "utf8",
        timeout: 60_000,
      });
    const stats = run("stats");
    expect(stats.status).toBe(0);
    expect(JSON.parse(stats.stderr)).toHaveProperty("devicesActive");
    const bad = run("frobnicate");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("usage:");
    const noId = run("block", "not-an-id");
    expect(noId.status).toBe(1);
  }, 120_000);
});

describe("CON-13 · audit events", () => {
  it("every kind that has been written carries an HMAC subject, never a raw device ID", async () => {
    const rows = (await q("select kind, subject from audit_events")).rows as Array<{
      kind: string;
      subject: string | null;
    }>;
    expect(rows.length).toBeGreaterThan(5);
    const devices = (await q("select device_id from devices")).rows.map((r) => r.device_id as string);
    for (const r of rows) {
      expect(AUDIT_KINDS).toContain(r.kind);
      if (r.subject !== null) {
        expect(r.subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(devices).not.toContain(r.subject);
      }
    }
    const seen = new Set(rows.map((r) => r.kind));
    for (const k of [
      "device_first_seen",
      "binding_created",
      "binding_revoked",
      "grant_rotated",
      "device_retired",
      "device_blocked",
    ]) {
      expect(seen.has(k), k).toBe(true);
    }
  });
});

describe("C-16.8a · automatic abuse signals", () => {
  it("a device refused by rate limits 20 times in an hour, and a sender binding to more than 10 devices in a day", async () => {
    const d = await TestDevice.create();
    const c = await d.login(A());
    for (let i = 0; i < 32; i++) c.send("presence.query", { ids: [d.deviceId] });
    await sleep(600);
    const subject = A().hub.audit.subject(d.deviceId);
    expect(
      (await q("select count(*)::int n from audit_events where kind='rate_limited_burst' and subject=$1", [subject]))
        .rows[0].n,
    ).toBe(1);
    c.close();

    const sender = await TestDevice.create();
    await env.iso.redis.set(`${P()}ab:bind:${sender.deviceId}`, "10", "PX", 60_000);
    const t = await TestDevice.create();
    (await t.login(A())).close();
    expect(await contact(sender, t)).toBe("accepted");
    const s2 = A().hub.audit.subject(sender.deviceId);
    expect(
      (await q("select count(*)::int n from audit_events where kind='binding_burst' and subject=$1", [s2])).rows[0].n,
    ).toBe(1);
  });
});
