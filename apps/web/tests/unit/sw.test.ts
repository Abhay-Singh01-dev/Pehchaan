// The service worker's notifications (backend spec 11.4–11.6; PSH-07, PSH-08, C-11.5a). Envelopes are really
// sealed and opened; only the browser's notification and window APIs are stand-ins.
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { resubscribeMessage, verifyDeviceRequest } from "@pehchaan/crypto/device-auth";
import { ulid } from "@pehchaan/protocol";
import { alertPayload, requestPayload, wrap } from "@/services/real/relay/envelope";
import { newIdentity } from "@/services/identity";
import { createRequestFactory } from "@/services/requests";
import { db, type IdentityRow } from "@/store/db";
import type { AskReason, FamilyMember } from "@/services/types";
import { URGENT_VIBRATION, notificationOptions, plan, type PushContent } from "@/sw/describe";
import { handleClick, handlePush, handleSubscriptionChange, type SwDeps } from "@/sw/handle";

const requests = createRequestFactory();
let me: IdentityRow;
let maa: IdentityRow;

interface Shown {
  title: string;
  options: NotificationOptions & { vibrate?: number[]; renotify?: boolean };
}

function harness(o: { visible?: boolean; fetchFrame?: unknown } = {}) {
  const shown: Shown[] = [];
  const messages: unknown[] = [];
  const opened: string[] = [];
  const posted: Array<{ url: string; body: unknown }> = [];
  const win = {
    visibilityState: o.visible ? "visible" : "hidden",
    postMessage: (m: unknown) => messages.push(m),
    focus: async () => undefined,
  };
  const deps: SwDeps = {
    db,
    relayHttp: "https://relay.pehchaan.test",
    relayHost: "relay.pehchaan.test",
    vapidPublicKey: "",
    vapidKeyId: "v1",
    showNotification: async (title, options) => void shown.push({ title, options: options as Shown["options"] }),
    windows: async () => (o.visible === undefined ? [] : [win]),
    openWindow: async (url) => void opened.push(url),
    fetch: (async (url: string, init: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      if (o.fetchFrame === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ frame: o.fetchFrame }), { status: 200 });
    }) as typeof fetch,
  };
  return { deps, shown, messages, opened, posted };
}

/** A request from Maa, sealed to this phone exactly as her app seals it, as the push would carry it. */
async function pushedRequest(o: { reason?: AskReason; amountInr?: number } = {}) {
  const req = requests.create({
    from: { deviceId: maa.deviceId, name: "Sunita" },
    member: { deviceId: me.deviceId, label: "Arjun" } as FamilyMember,
    ...o,
  });
  const id = req.requestId;
  const sealed = await wrap(
    requestPayload(req, maa),
    { kind: "verify.request", id, from: maa.deviceId, to: me.deviceId, re: id },
    maa,
    me.encPub,
    "e2e",
  );
  return {
    id,
    frame: {
      v: 1,
      t: "deliver",
      id,
      sts: Date.now(),
      body: { from: maa.deviceId, kind: "verify.request", re: id, ttlMs: 55_000, ...sealed },
    },
  };
}

beforeEach(async () => {
  await Promise.all([db.identity.clear(), db.family.clear(), db.profile.clear(), db.pushInbox.clear()]);
  [me, maa] = await Promise.all([newIdentity(), newIdentity()]);
  await db.identity.put(me);
});

describe("PSH-07 · what each notification says and does (11.6)", () => {
  const cases: Array<[PushContent, { tag: string; urgent: boolean; url: string; title: RegExp }]> = [
    [
      { kind: "verify.request", requestId: "R1", askerLabel: "Maa", fromName: "Sunita" },
      { tag: "req-R1", urgent: true, url: "/request/R1", title: /^Maa is asking$/ },
    ],
    [
      { kind: "verify.request", requestId: "R1", fromName: "Sunita" },
      { tag: "req-R1", urgent: true, url: "/request/R1", title: /^Sunita \(not in your family\)$/ },
    ],
    [
      { kind: "verify.cancel", requestId: "R1", askerLabel: "Maa" },
      { tag: "req-R1", urgent: false, url: "/request/R1", title: /^Maa stopped waiting$/ },
    ],
    [
      { kind: "verify.answer", requestId: "R1", label: "Arjun" },
      { tag: "ans-R1", urgent: true, url: "/verify/waiting/R1", title: /^Arjun answered$/ },
    ],
    [
      { kind: "alert", id: "A1", type: "impersonation", about: "Arjun", victim: "Maa" },
      { tag: "alert-A1", urgent: true, url: "/alerts", title: /^Someone pretended to be Arjun$/ },
    ],
    [
      { kind: "alert", id: "A1", type: "check_on", about: "Arjun", victim: "Maa" },
      { tag: "alert-A1", urgent: false, url: "/alerts", title: /^Can you check on Arjun\?$/ },
    ],
    [
      { kind: "guard.prompt", at: 7, claimed: "Arjun" },
      { tag: "guard-7", urgent: true, url: "/home", title: /^Call Guard: verify now\?$/ },
    ],
    [{ kind: "unreadable" }, { tag: "generic", urgent: false, url: "/", title: /^Pehchaan$/ }],
  ];

  it.each(cases)("%o", (content, want) => {
    const p = plan(content, "en");
    expect(p).toMatchObject({ tag: want.tag, urgent: want.urgent, url: want.url });
    expect(p.title).toMatch(want.title);
  });

  it("a cancel replaces its request's notification (same tag)", () => {
    expect(plan({ kind: "verify.cancel", requestId: "R9" }, "en").tag).toBe(
      plan({ kind: "verify.request", requestId: "R9", fromName: "x" }, "en").tag,
    );
  });

  it("speaks Hindi to a Hindi phone", () => {
    expect(plan({ kind: "verify.request", requestId: "R1", askerLabel: "माँ", fromName: "x" }, "hi").title).toBe(
      "माँ पूछ रहे हैं",
    );
  });

  it("is silent while the app is on screen, vibrates only when urgent and not visible, and never both", () => {
    fc.assert(
      fc.property(fc.constantFrom(...cases.map(([c]) => c)), fc.boolean(), (content, visible) => {
        const o = notificationOptions(plan(content, "en"), visible) as Shown["options"];
        expect(o.silent).toBe(visible);
        if (o.vibrate) expect(o.silent).toBe(false);
        expect(Boolean(o.vibrate)).toBe(plan(content, "en").urgent && !visible);
        expect(o.requireInteraction).toBe(plan(content, "en").urgent);
        expect(o.renotify).toBe(true);
        expect((o.data as { url: string }).url).toBe(plan(content, "en").url);
      }),
    );
    expect(URGENT_VIBRATION).toEqual([300, 150, 300, 150, 600]);
  });
});

describe("PSH-08 · the lock screen never shows an amount or a reason", () => {
  it("whatever the request carries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.constantFrom<AskReason>("money", "otp", "bank_details", "install_app", "nothing_yet"),
        fc.constantFrom("en", "hi"),
        async (amountInr, reason, lang) => {
          await db.profile.put({ id: "me", lang } as never);
          const { frame } = await pushedRequest({ reason, amountInr });
          const h = harness();
          await handlePush(h.deps, JSON.stringify(frame));
          const text = `${h.shown[0]!.title} ${h.shown[0]!.options.body}`;
          expect(text).not.toMatch(/₹|\d{2,}/);
          expect(text).not.toContain(amountInr.toLocaleString("en-IN"));
          expect(text.toLowerCase()).not.toMatch(/money|otp|bank|install|पैसे|बैंक/);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("C-11.5a · every push shows a notification, and the app hears about it", () => {
  it("a sealed request: opened with this phone's key, named from its family list, kept for the app", async () => {
    await db.family.put({
      id: "m_maa",
      deviceId: maa.deviceId,
      label: "Maa",
      devicePub: maa.devicePub,
    } as FamilyMember);
    const { id, frame } = await pushedRequest({ reason: "money", amountInr: 50_000 });
    const h = harness({ visible: false });
    await handlePush(h.deps, JSON.stringify(frame));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]!.title).toBe("Maa is asking");
    expect(h.shown[0]!.options).toMatchObject({ tag: `req-${id}`, silent: false, requireInteraction: true });
    expect(h.shown[0]!.options.vibrate).toEqual(URGENT_VIBRATION);
    expect(await db.pushInbox.get(id)).toMatchObject({ id, frame });
    expect(h.messages).toEqual([{ type: "push-frame" }]);
  });

  it("the app on screen: the notification is silent", async () => {
    const { frame } = await pushedRequest();
    const h = harness({ visible: true });
    await handlePush(h.deps, JSON.stringify(frame));
    expect(h.shown[0]!.options.silent).toBe(true);
    expect(h.shown[0]!.options.vibrate).toBeUndefined();
  });

  it("a tampered envelope, garbage, or nothing at all still shows the generic notification", async () => {
    const { frame } = await pushedRequest();
    const e2e = (frame.body as { e2e: { ct: string } }).e2e;
    const tampered = {
      ...frame,
      body: { ...frame.body, e2e: { ...e2e, ct: (e2e.ct[0] === "A" ? "B" : "A") + e2e.ct.slice(1) } },
    };
    for (const data of [JSON.stringify(tampered), "not json", null, JSON.stringify({ t: "deliver" })]) {
      const h = harness();
      await handlePush(h.deps, data);
      expect(h.shown).toHaveLength(1);
      expect(h.shown[0]).toMatchObject({ title: "Pehchaan", options: { tag: "generic" } });
    }
  });

  it("a request addressed to another device is shown only generically (FC-27)", async () => {
    const other = await newIdentity();
    const req = requests.create({
      from: { deviceId: maa.deviceId, name: "Sunita" },
      member: { deviceId: other.deviceId, label: "Priya" } as FamilyMember,
    });
    const id = req.requestId;
    const sealed = await wrap(
      requestPayload(req, maa),
      { kind: "verify.request", id, from: maa.deviceId, to: me.deviceId, re: id },
      maa,
      me.encPub,
      "e2e",
    );
    const h = harness();
    await handlePush(
      h.deps,
      JSON.stringify({
        v: 1,
        t: "deliver",
        id,
        sts: 1,
        body: { from: maa.deviceId, kind: "verify.request", re: id, ttlMs: 1000, ...sealed },
      }),
    );
    expect(h.shown[0]!.options.tag).toBe("generic");
  });

  it("a wake: the frame is fetched with a request signed by this device (11.4)", async () => {
    const { id, frame } = await pushedRequest();
    const h = harness({ fetchFrame: frame });
    await handlePush(h.deps, JSON.stringify({ t: "wake", id, kind: "verify.request", from: maa.deviceId }));
    expect(h.posted[0]!.url).toBe("https://relay.pehchaan.test/v1/inbox/fetch");
    expect(h.posted[0]!.body).toMatchObject({ deviceId: me.deviceId, msgId: id });
    expect(h.shown[0]!.options.tag).toBe(`req-${id}`);
    const failed = harness();
    await handlePush(failed.deps, JSON.stringify({ t: "wake", id, kind: "verify.request", from: maa.deviceId }));
    expect(failed.shown[0]!.options.tag).toBe("generic");
  });

  it("an alert names both people from this phone's own family list", async () => {
    await db.family.bulkPut([
      { id: "m_maa", deviceId: maa.deviceId, label: "Maa", devicePub: maa.devicePub } as FamilyMember,
      { id: "m_arjun", deviceId: "arjun-device-000000000", label: "Arjun bhai" } as FamilyMember,
    ]);
    const id = ulid();
    const alert = {
      id: "alert_1",
      type: "impersonation" as const,
      aboutLabel: "Arjun",
      aboutDeviceId: "arjun-device-000000000",
      victimName: "Sunita",
      createdAt: 1,
      read: false,
      amountInr: 20_000,
    };
    const sealed = await wrap(
      alertPayload(alert, maa),
      { kind: "alert", id, from: maa.deviceId, to: me.deviceId },
      maa,
      me.encPub,
      "e2e",
    );
    const h = harness();
    await handlePush(
      h.deps,
      JSON.stringify({
        v: 1,
        t: "deliver",
        id,
        sts: 1,
        body: { from: maa.deviceId, kind: "alert", ttlMs: 1000, ...sealed },
      }),
    );
    expect(h.shown[0]!.title).toBe("Someone pretended to be Arjun bhai");
    expect(h.shown[0]!.options.body).toBe("On a call to Maa. Tap for details.");
  });

  it("the alert check (push.test): shown, and the app is told when it arrived", async () => {
    const h = harness({ visible: false });
    await handlePush(h.deps, JSON.stringify({ t: "test", id: ulid(), sts: 1234 }));
    expect(h.shown[0]!.title).toBe("Alert check");
    expect(h.messages[0]).toMatchObject({ type: "push-test", sts: 1234 });
  });
});

describe("notification taps and re-subscription (11.2, 11.5)", () => {
  it("a tap focuses the open app on the notification's screen, or opens it there", async () => {
    const open = harness({ visible: false });
    await handleClick(open.deps, "/request/R1");
    expect(open.messages).toEqual([{ type: "navigate", url: "/request/R1" }]);
    const closed = harness();
    await handleClick(closed.deps, "/alerts");
    expect(closed.opened).toEqual(["/alerts"]);
  });

  it("never navigates away from the app", async () => {
    const h = harness();
    for (const url of ["https://evil.example", "//evil.example/x", 42, undefined]) await handleClick(h.deps, url);
    expect(h.opened).toEqual(["/", "/", "/", "/"]);
  });

  it("a replaced subscription is registered with a request signed by this device", async () => {
    const h = harness();
    const p256dh = b64urlDecode(maa.encPub); // any 65-byte P-256 point
    const auth = new Uint8Array(16).fill(9);
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/new",
      getKey: (n: "p256dh" | "auth") => (n === "p256dh" ? p256dh.buffer : auth.buffer) as ArrayBuffer,
    };
    await handleSubscriptionChange(h.deps, sub, "https://fcm.googleapis.com/fcm/send/old");
    const body = h.posted[0]!.body as {
      deviceId: string;
      ts: number;
      sig: string;
      oldEndpoint: string;
      subscription: { vapidKeyId: string };
    };
    expect(h.posted[0]!.url).toBe("https://relay.pehchaan.test/v1/push/resubscribe");
    expect(body).toMatchObject({
      deviceId: me.deviceId,
      oldEndpoint: "https://fcm.googleapis.com/fcm/send/old",
      subscription: { vapidKeyId: "v1" },
    });
    const msg = resubscribeMessage("relay.pehchaan.test", me.deviceId, sub.endpoint, body.ts);
    expect(await verifyDeviceRequest(b64urlDecode(me.devicePub), msg, body.sig)).toBe(true);
  });
});
