// Web Push on this phone (backend spec 11.2, 11.5, 11.9; C-11.2a, PSH-06, C-11.5a). The browser's push manager
// is a stand-in (a real one needs a push service); the subscription keys it hands out are real P-256 keys.
import { beforeEach, describe, expect, it } from "vitest";
import { b64url, b64urlDecode } from "@pehchaan/crypto/bytes";
import { db } from "@/store/db";
import { getMeta, setMeta } from "@/store/meta";
import type { PushSubscriptionInfo, RelayInfo } from "@/services/types";
import { createPush, type PushEnv, type RegistrationLike, type SubscriptionLike } from "@/app/push";

const APP_KEY = b64url(new Uint8Array(65).fill(4));
const OTHER_KEY = b64url(new Uint8Array(65).fill(7));

/** A browser's PushManager: one subscription per registration, tied to the key it was made with. */
class FakePushManager {
  current: (SubscriptionLike & { key: string }) | null = null;
  subscribeCalls: Array<{ userVisibleOnly: boolean; key: string }> = [];
  private n = 0;
  async getSubscription() {
    return this.current;
  }
  async subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) {
    const key = b64url(o.applicationServerKey);
    this.subscribeCalls.push({ userVisibleOnly: o.userVisibleOnly, key });
    // Browsers refuse a second subscription with a different key until the old one is removed.
    if (this.current && this.current.key !== key) throw new DOMException("key differs", "InvalidStateError");
    if (this.current) return this.current;
    const p256dh = new Uint8Array(65).fill(++this.n);
    const auth = new Uint8Array(16).fill(this.n);
    const sub = {
      endpoint: `https://fcm.googleapis.com/fcm/send/sub-${this.n}`,
      key,
      getKey: (name: "p256dh" | "auth") => (name === "p256dh" ? p256dh : auth).buffer as ArrayBuffer,
      unsubscribe: async () => {
        if (this.current === sub) this.current = null;
        return true;
      },
    };
    this.current = sub;
    return sub;
  }
}

function setup(
  o: Partial<PushEnv> & { perm?: NotificationPermission; answer?: NotificationPermission; noSw?: boolean } = {},
) {
  const pm = new FakePushManager();
  const sent: PushSubscriptionInfo[] = [];
  const closed: string[] = [];
  let perm: NotificationPermission = o.perm ?? "default";
  const calls: string[] = [];
  const reg: RegistrationLike = {
    pushManager: pm,
    getNotifications: async ({ tag }) => [
      { tag, close: () => closed.push(tag) },
      { tag, close: () => closed.push(tag) },
    ],
  };
  const env: PushEnv = {
    supported: true,
    platform: "android-chrome",
    vapidPublicKey: APP_KEY,
    vapidKeyId: "v2",
    permission: () => perm,
    requestPermission: async () => {
      calls.push("requestPermission");
      perm = o.answer ?? "granted";
      return perm;
    },
    registration: async (w) => {
      calls.push(w?.wait ? "registration(wait)" : "registration");
      return o.noSw ? null : reg;
    },
    relay: { pushSubscribe: (s) => void sent.push(s) },
    ...o,
  };
  return { push: createPush(env), pm, sent, closed, calls };
}

const login = (o: Partial<RelayInfo> = {}): RelayInfo => ({ e2e: true, pushStatus: "ok", vapidKeyId: "v2", ...o });

beforeEach(async () => {
  await db.meta.clear();
});

describe("11.2 · turning alerts on (A8)", () => {
  it("asks for permission first, inside the tap, before anything is awaited", () => {
    const { push, calls } = setup();
    void push.enable();
    // iPhone only allows the request in a user gesture: it must be the very first thing enable() does.
    expect(calls).toEqual(["requestPermission"]);
  });

  it("granted: subscribes with this build's key (userVisibleOnly) and gives the relay the subscription", async () => {
    const { push, pm, sent } = setup();
    expect(await push.enable()).toBe("granted");
    expect(pm.subscribeCalls).toEqual([{ userVisibleOnly: true, key: APP_KEY }]);
    expect(sent).toEqual([
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/sub-1",
        p256dh: b64url(new Uint8Array(65).fill(1)),
        auth: b64url(new Uint8Array(16).fill(1)),
        vapidKeyId: "v2",
      },
    ]);
    expect(await getMeta("pushEnabled")).toBe(true);
    expect(await getMeta("vapidKeyId")).toBe("v2");
    expect(await push.state()).toBe("on");
  });

  it("refused: nothing is subscribed, the choice is remembered, and Settings shows Blocked", async () => {
    const { push, pm, sent } = setup({ answer: "denied" });
    expect(await push.enable()).toBe("denied");
    expect(pm.subscribeCalls).toEqual([]);
    expect(sent).toEqual([]);
    expect(await getMeta("pushEnabled")).toBe(false);
    expect(await push.state()).toBe("blocked");
  });

  it("no service worker or push manager, or no key in this build: unsupported, and nothing is asked", async () => {
    for (const o of [{ supported: false }, { vapidPublicKey: "" }]) {
      const { push, calls } = setup(o);
      expect(push.support()).toBe("unsupported");
      expect(await push.enable()).toBe("unsupported");
      expect(await push.state()).toBe("unsupported");
      expect(calls).toEqual([]);
    }
  });

  it("iPhone in a Safari tab: alerts need the Home Screen app first (FC-10)", async () => {
    const { push, calls } = setup({ platform: "ios-safari" });
    expect(push.support()).toBe("install_first");
    expect(await push.enable()).toBe("unsupported");
    expect(calls).toEqual([]);
    expect(setup({ platform: "ios-pwa" }).push.support()).toBe("supported");
  });

  it("a subscribe that fails (no service worker yet, push service unreachable) reports failed", async () => {
    expect(await setup({ noSw: true }).push.enable()).toBe("failed");
    const broken = setup();
    broken.pm.subscribe = async () => {
      throw new DOMException("push service error", "AbortError");
    };
    expect(await broken.push.enable()).toBe("failed");
    expect(broken.sent).toEqual([]);
  });

  it("reading the state never waits for a service worker still installing; subscribing does", async () => {
    const { push, calls } = setup({ perm: "granted" });
    await push.state();
    await push.closeNotifications("req-R1");
    expect(calls).toEqual(["registration", "registration"]);
    calls.length = 0;
    await push.enable();
    expect(calls).toEqual(["requestPermission", "registration(wait)"]);
  });

  it("state: off until permission is granted and a subscription exists", async () => {
    const { push, pm } = setup({ perm: "granted" });
    expect(await push.state()).toBe("off");
    await pm.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(APP_KEY) });
    expect(await push.state()).toBe("on");
    expect(await setup({ perm: "default" }).push.state()).toBe("off");
  });
});

describe("C-11.2a · keeping the subscription fresh at every login (refresh)", () => {
  async function enabled() {
    const s = setup();
    await s.push.enable();
    s.sent.length = 0;
    s.pm.subscribeCalls.length = 0;
    return s;
  }

  it("expired: the dead subscription is replaced by a new one, silently", async () => {
    const s = await enabled();
    expect(await s.push.sync(login({ pushStatus: "expired" }))).toBe("renewed");
    expect(s.pm.subscribeCalls).toHaveLength(1);
    expect(s.sent.map((x) => x.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/sub-2"]);
  });

  it("missing, and the browser dropped the subscription too: subscribes again", async () => {
    const s = await enabled();
    s.pm.current = null;
    expect(await s.push.sync(login({ pushStatus: "missing" }))).toBe("renewed");
    expect(s.sent.map((x) => x.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/sub-2"]);
  });

  it("the first login after a reload hands the relay client the current subscription (re-sent on every login)", async () => {
    const s = await enabled();
    const fresh = createPush({ ...s.push.env });
    expect(await fresh.sync(login())).toBe("sent");
    expect(s.sent.map((x) => x.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/sub-1"]);
    expect(s.pm.subscribeCalls).toEqual([]);
  });

  it("ok and already given this session: nothing to do", async () => {
    const s = await enabled();
    expect(await s.push.sync(login())).toBe("none");
    expect(s.sent).toEqual([]);
  });

  it("permission not granted, unsupported, or before login (no push status): nothing, and nothing is asked", async () => {
    for (const s of [
      setup({ perm: "default" }),
      setup({ perm: "denied" }),
      setup({ perm: "granted", supported: false }),
    ]) {
      expect(await s.push.sync(login({ pushStatus: "missing" }))).toBe("none");
      expect(s.pm.subscribeCalls).toEqual([]);
      expect(s.calls).not.toContain("requestPermission");
    }
    const s = await enabled();
    expect(await s.push.sync({ e2e: true })).toBe("none");
  });

  it("logins that arrive together don't subscribe twice", async () => {
    const s = await enabled();
    s.pm.current = null;
    const r = await Promise.all([
      s.push.sync(login({ pushStatus: "missing" })),
      s.push.sync(login({ pushStatus: "missing" })),
    ]);
    expect(r).toEqual(["renewed", "none"]);
    expect(s.pm.subscribeCalls).toHaveLength(1);
  });
});

describe("PSH-06 · VAPID key rotation (11.9)", () => {
  it("the relay announces this build's new key while the subscription was made with the old one: unsubscribe, subscribe", async () => {
    const s = setup({ perm: "granted" });
    await s.pm.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(OTHER_KEY) });
    await setMeta("vapidKeyId", "v1");
    expect(await s.push.sync(login({ vapidKeyId: "v2" }))).toBe("renewed");
    expect(s.pm.current?.key).toBe(APP_KEY);
    expect(s.sent.at(-1)).toMatchObject({ vapidKeyId: "v2", endpoint: s.pm.current?.endpoint });
    expect(await getMeta("vapidKeyId")).toBe("v2");
  });

  it("an older build than the relay keeps its subscription: the relay still sends with the previous key", async () => {
    const s = setup({ perm: "granted", vapidKeyId: "v1", vapidPublicKey: OTHER_KEY });
    await s.push.enable();
    s.pm.subscribeCalls.length = 0;
    const again = createPush({ ...s.push.env });
    expect(await again.sync(login({ vapidKeyId: "v2" }))).toBe("sent");
    expect(s.pm.subscribeCalls).toEqual([]);
    expect(s.pm.current?.key).toBe(OTHER_KEY);
  });
});

describe("C-11.5a · the app closes the notification once it shows the screen", () => {
  it("closes every notification with that tag", async () => {
    const s = setup();
    await s.push.closeNotifications("req-R1");
    expect(s.closed).toEqual(["req-R1", "req-R1"]);
  });

  it("does nothing without a service worker", async () => {
    await expect(setup({ noSw: true }).push.closeNotifications("req-R1")).resolves.toBeUndefined();
  });
});

describe("the alert check's arrival time (11.8)", () => {
  it("is measured on this phone's own clock, from the tap to the service worker receiving it", () => {
    const { push } = setup();
    expect(push.arrivalSeconds(1_000_000, { type: "push-test", at: 1_012_400, sts: 5 })).toBe(12.4);
    // The relay's clock (sts) is never used (8.7); a message without the phone's own time gives nothing.
    expect(push.arrivalSeconds(1_000_000, { type: "push-test", sts: 1_012_400 })).toBeNull();
    expect(push.arrivalSeconds(1_000_000, { type: "push-frame" })).toBeNull();
  });
});
