// What a push notification says and does (backend spec 11.5, 11.6). Pure: the service worker opens the envelope
// and looks up labels, then asks this module for the notification.
//
// The lock screen is visible to anyone near the phone, so a notification NEVER contains an amount or a reason,
// only who is asking. Every push shows a notification (browsers revoke push from sites that push silently);
// while the app is on screen it is silent, and the vibration pattern is never set together with `silent`.
import { notify as en } from "@/i18n/en.json";
import { notify as hi } from "@/i18n/hi.json";

export type Strings = typeof en;
export type NotifyLang = "en" | "hi";

/** What the service worker learned from a push (after opening the envelope, where there is one). */
export type PushContent =
  | { kind: "verify.request"; requestId: string; askerLabel?: string; fromName: string }
  | { kind: "verify.cancel"; requestId: string; askerLabel?: string; fromName?: string }
  | { kind: "verify.answer"; requestId: string; label?: string }
  | { kind: "alert"; id: string; type: "impersonation" | "check_on"; about: string; victim: string }
  | { kind: "guard.prompt"; at: number; claimed: string }
  | { kind: "test" }
  /** The envelope couldn't be opened or read, or a wake fetch failed (11.6's last row). */
  | { kind: "unreadable" };

export interface NotificationPlan {
  title: string;
  body: string;
  tag: string;
  urgent: boolean;
  url: string;
}

const fill = (s: string, v: Record<string, string>) => s.replace(/{{\s*(\w+)\s*}}/g, (_, k: string) => v[k] ?? "");

export function plan(c: PushContent, lang: NotifyLang): NotificationPlan {
  const s: Strings = lang === "hi" ? hi : en;
  switch (c.kind) {
    case "verify.request": {
      // Someone not in my family list is named by the name they gave, marked as such (11.6).
      return {
        title: c.askerLabel
          ? fill(s.requestTitle, { asker: c.askerLabel })
          : fill(s.requestStranger, { asker: c.fromName }),
        body: fill(s.requestBody, { asker: c.askerLabel ?? c.fromName }),
        tag: `req-${c.requestId}`,
        urgent: true,
        url: `/request/${c.requestId}`,
      };
    }
    case "verify.cancel":
      // Same tag as the request: it replaces the request's notification.
      return {
        title: fill(s.cancelTitle, { asker: c.askerLabel ?? c.fromName ?? s.genericTitle }),
        body: s.cancelBody,
        tag: `req-${c.requestId}`,
        urgent: false,
        url: `/request/${c.requestId}`,
      };
    case "verify.answer":
      return {
        title: fill(s.answerTitle, { label: c.label ?? s.genericTitle }),
        body: s.answerBody,
        tag: `ans-${c.requestId}`,
        urgent: true,
        url: `/verify/waiting/${c.requestId}`,
      };
    case "alert":
      return c.type === "impersonation"
        ? {
            title: fill(s.impTitle, { about: c.about }),
            body: fill(s.impBody, { victim: c.victim }),
            tag: `alert-${c.id}`,
            urgent: true,
            url: "/alerts",
          }
        : {
            title: fill(s.checkOnTitle, { about: c.about }),
            body: fill(s.checkOnBody, { victim: c.victim }),
            tag: `alert-${c.id}`,
            urgent: false,
            url: "/alerts",
          };
    case "guard.prompt":
      return {
        title: s.guardTitle,
        body: fill(s.guardBody, { claimed: c.claimed }),
        tag: `guard-${c.at}`,
        urgent: true,
        url: "/home",
      };
    case "test":
      return { title: s.testTitle, body: s.testBody, tag: "test", urgent: false, url: "/settings/alerts" };
    case "unreadable":
      return { title: s.genericTitle, body: s.genericBody, tag: "generic", urgent: false, url: "/" };
  }
}

/** The long vibration pattern for urgent pushes (Android only; iPhone ignores it). */
export const URGENT_VIBRATION = [300, 150, 300, 150, 600];

/** The options for showNotification: silent while the app is on screen, and never silent AND vibrating. */
export function notificationOptions(p: NotificationPlan, appVisible: boolean, now = Date.now()): NotificationOptions {
  const vibrate = p.urgent && !appVisible ? URGENT_VIBRATION : undefined;
  return {
    body: p.body,
    tag: p.tag,
    silent: appVisible,
    requireInteraction: p.urgent,
    data: { url: p.url },
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // Part of the Notifications API but not of TypeScript's DOM types: `vibrate` (Android, never with `silent`),
    // `renotify` (alert again when a notification with the same tag is replaced) and `timestamp`.
    ...({ renotify: true, timestamp: now, ...(vibrate ? { vibrate } : {}) } as NotificationOptions),
  };
}
