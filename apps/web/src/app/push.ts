// Web Push on this phone (backend spec 11.2, 11.5, 11.8, 11.9): turning alerts on, keeping the subscription
// fresh at every login, closing a notification once its screen is showing, and timing the alert check.
// Written against an injected browser environment so it can be tested without a push service; `push` at the
// bottom is the app's instance.
import { useEffect, useRef, useState } from "react";
import { b64url, b64urlDecode } from "@pehchaan/crypto/bytes";
import { services } from "@/services";
import { RelayError } from "@/services/errors";
import type { PushSubscriptionInfo, RelayInfo } from "@/services/types";
import { getMeta, setMeta } from "@/store/meta";
import { appConfig, platformName } from "./config";
import { flags } from "./flags";

export interface SubscriptionLike {
  endpoint: string;
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null;
  unsubscribe(): Promise<boolean>;
}

export interface RegistrationLike {
  pushManager: {
    getSubscription(): Promise<SubscriptionLike | null>;
    subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
  };
  getNotifications?(o: { tag: string }): Promise<Array<{ close(): void }>>;
}

export interface PushEnv {
  /** A service worker, the Push API and notifications all exist here. */
  supported: boolean;
  /** platformName(): "ios-safari" can't receive pushes until installed (11.7). */
  platform: string;
  vapidPublicKey: string;
  vapidKeyId: string;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /** The service worker's registration, or null when there is none. `wait`: until its worker is active (to
   *  subscribe); without it, answers at once (to read the state without holding up a screen). */
  registration(o?: { wait?: boolean }): Promise<RegistrationLike | null>;
  relay: { pushSubscribe(sub: PushSubscriptionInfo): void };
}

/** "install_first": an iPhone in a Safari tab; alerts need the Home Screen app (FC-10). */
export type PushSupport = "supported" | "install_first" | "unsupported";
export type AlertsState = "on" | "off" | "blocked" | "install_first" | "unsupported";
export type EnableResult = "granted" | "denied" | "unsupported" | "failed";
export type SyncResult = "none" | "sent" | "renewed";

function toInfo(sub: SubscriptionLike, vapidKeyId: string): PushSubscriptionInfo | null {
  const p256dh = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!p256dh || !auth) return null;
  return {
    endpoint: sub.endpoint,
    p256dh: b64url(new Uint8Array(p256dh)),
    auth: b64url(new Uint8Array(auth)),
    vapidKeyId,
  };
}

export function createPush(env: PushEnv) {
  /** The endpoint handed to the relay client in this session; it re-sends it at every later login (8.9). */
  let given: string | null = null;
  /** One sync at a time: two logins in a row must not subscribe twice. */
  let queue: Promise<unknown> = Promise.resolve();

  function support(): PushSupport {
    if (!env.supported || !env.vapidPublicKey) return "unsupported";
    if (env.platform === "ios-safari") return "install_first";
    return "supported";
  }

  function give(sub: SubscriptionLike) {
    const info = toInfo(sub, env.vapidKeyId);
    if (!info) return;
    env.relay.pushSubscribe(info);
    given = sub.endpoint;
  }

  /** A new subscription with this build's key, replacing `old` (dead, or made with a retired key). */
  async function renew(reg: RegistrationLike, old: SubscriptionLike | null) {
    if (old) await old.unsubscribe();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // mandatory: every push shows a notification (11.5)
      applicationServerKey: b64urlDecode(env.vapidPublicKey),
    });
    await setMeta("vapidKeyId", env.vapidKeyId);
    give(sub);
  }

  return {
    env,
    support,

    async state(): Promise<AlertsState> {
      const s = support();
      if (s !== "supported") return s;
      const perm = env.permission();
      if (perm === "denied") return "blocked";
      if (perm !== "granted") return "off";
      const reg = await env.registration({ wait: false }).catch(() => null);
      return (await reg?.pushManager.getSubscription().catch(() => null)) ? "on" : "off";
    },

    /** "Turn on alerts". Call it straight from the button's click handler. */
    async enable(): Promise<EnableResult> {
      if (support() !== "supported") return "unsupported";
      // The very first thing, still inside the tap: iPhone refuses the request outside a user gesture (11.2).
      const perm = await env.requestPermission();
      if (perm !== "granted") {
        await setMeta("pushEnabled", false);
        return "denied";
      }
      try {
        const reg = await env.registration({ wait: true });
        if (!reg) return "failed";
        await renew(reg, null);
        await setMeta("pushEnabled", true);
        return "granted";
      } catch {
        return "failed";
      }
    },

    /** After every login (11.2, 11.9). Never asks for permission: it only keeps what the person allowed working. */
    sync(info: RelayInfo): Promise<SyncResult> {
      const run = async (): Promise<SyncResult> => {
        if (!info.pushStatus || support() !== "supported" || env.permission() !== "granted") return "none";
        const reg = await env.registration({ wait: true });
        if (!reg) return "none";
        const current = await reg.pushManager.getSubscription();
        // 11.9: the relay now signs with this build's key, but the subscription was made with an older one.
        const rotated = info.vapidKeyId === env.vapidKeyId && (await getMeta<string>("vapidKeyId")) !== env.vapidKeyId;
        // A dead subscription (the push service said 404/410) or none at all: subscribe again, silently.
        if (!current || info.pushStatus === "expired" || rotated) {
          await renew(reg, current);
          return "renewed";
        }
        if (given === current.endpoint) return "none";
        give(current);
        return "sent";
      };
      const next = queue.then(run, run).catch((): SyncResult => "none");
      queue = next;
      return next;
    },

    /** 11.5: once the screen for a notification is showing, its notification has done its job. */
    async closeNotifications(tag: string): Promise<void> {
      const reg = await env.registration({ wait: false }).catch(() => null);
      const list = (await reg?.getNotifications?.({ tag }).catch(() => [])) ?? [];
      for (const n of list) n.close();
    },

    /** Seconds from the tap to the service worker receiving the alert check: both times from this phone (8.7). */
    arrivalSeconds(tappedAt: number, msg: unknown): number | null {
      const m = msg as { type?: unknown; at?: unknown } | null;
      if (m?.type !== "push-test" || typeof m.at !== "number") return null;
      return Math.round((m.at - tappedAt) / 100) / 10;
    },
  };
}

export type Push = ReturnType<typeof createPush>;

/** The service worker's registration, or null (none registered, e.g. the dev server). With `wait`, once its
 *  worker is active (a first launch may still be installing it), giving up after 10 s. */
async function swRegistration(o: { wait?: boolean } = {}): Promise<RegistrationLike | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  if (reg.active || !o.wait) return reg as unknown as RegistrationLike;
  const ready = navigator.serviceWorker.ready as Promise<unknown> as Promise<RegistrationLike>;
  return Promise.race([ready, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
}

function browserEnv(): PushEnv {
  const hasApis =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined";
  return {
    // A simulated relay can't send pushes.
    supported: hasApis && !flags.SIM_RELAY,
    platform: platformName(),
    vapidPublicKey: appConfig.vapidPublicKey,
    vapidKeyId: appConfig.vapidKeyId,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration: swRegistration,
    relay: services.relay,
  };
}

export const push = createPush(browserEnv());

/** Messages from the service worker ("push-test", "navigate", "push-frame"). */
export function onServiceWorkerMessage(cb: (data: { type?: string; [k: string]: unknown }) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const on = (e: MessageEvent) => {
    const d = e.data as { type?: string } | null;
    if (d && typeof d === "object") cb(d);
  };
  navigator.serviceWorker.addEventListener("message", on);
  return () => navigator.serviceWorker.removeEventListener("message", on);
}

/** Live alert state for Settings; refreshed when the screen comes back into view. */
export function useAlertsState(): AlertsState | null {
  const [state, setState] = useState<AlertsState | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void push.state().then((s) => live && setState(s));
    read();
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return state;
}

export type AlertCheck =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "arrived"; seconds: number }
  | { status: "failed"; limited: boolean };

/** "Send an alert check" (11.8): the relay pushes to this phone after 10 s; the arrival time is reported. */
export function useAlertCheck(): { check: AlertCheck; send(): Promise<void> } {
  const [check, setCheck] = useState<AlertCheck>({ status: "idle" });
  const tappedAt = useRef<number | null>(null);
  useEffect(
    () =>
      onServiceWorkerMessage((m) => {
        if (tappedAt.current === null) return;
        const seconds = push.arrivalSeconds(tappedAt.current, m);
        if (seconds !== null) setCheck({ status: "arrived", seconds });
      }),
    [],
  );
  return {
    check,
    async send() {
      setCheck({ status: "sending" });
      tappedAt.current = Date.now();
      try {
        await services.relay.sendTestAlert();
        setCheck({ status: "sent" });
      } catch (e) {
        tappedAt.current = null;
        setCheck({ status: "failed", limited: e instanceof RelayError && e.reason === "rate_limited" });
      }
    },
  };
}
