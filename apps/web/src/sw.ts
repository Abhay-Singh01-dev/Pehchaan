// The service worker (frontend spec B14; backend spec 11.5, FC-8). Built by vite-plugin-pwa's injectManifest:
//   - precaches the app shell, icons and fonts, so the installed app opens without a network (and after an
//     update, the new version waits until the person reloads: registerType "prompt");
//   - wakes on Web Push, shows the notification and stores the frame for the app (sw/handle.ts);
//   - opens or focuses the app on a notification tap;
//   - re-registers a replaced push subscription with the relay.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { appConfig } from "@/app/config";
import { db } from "@/store/db";
import { handleClick, handlePush, handleSubscriptionChange, type SwDeps, type WindowLike } from "@/sw/handle";

// The few service-worker APIs used here, typed locally: the app is type-checked with the DOM library, which
// can't be combined with the WebWorker one in the same program.
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SwScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(o: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<Array<WindowLike & { focus(): Promise<unknown> }>>;
    openWindow(url: string): Promise<unknown>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: "push", l: (e: ExtendableEvent & { data: { text(): string } | null }) => void): void;
  addEventListener(type: "notificationclick", l: (e: ExtendableEvent & { notification: Notification }) => void): void;
  addEventListener(
    type: "pushsubscriptionchange",
    l: (
      e: ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null },
    ) => void,
  ): void;
  addEventListener(type: "message", l: (e: MessageEvent) => void): void;
}
const sw = self as unknown as SwScope;

cleanupOutdatedCaches();
// Written as `self.__WB_MANIFEST` on purpose: the build replaces that exact expression with the file list.
precacheAndRoute((self as unknown as SwScope).__WB_MANIFEST);
// Every page of the app is the same shell; the router takes it from there.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/relay\//] }));

// The update toast's "Reload" (virtual:pwa-register) asks the waiting worker to take over.
sw.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void sw.skipWaiting();
});

const deps: SwDeps = {
  db,
  relayHttp: appConfig.relayHttp,
  relayHost: appConfig.relayHost,
  vapidPublicKey: appConfig.vapidPublicKey,
  vapidKeyId: appConfig.vapidKeyId,
  showNotification: (title, options) => sw.registration.showNotification(title, options),
  windows: () => sw.clients.matchAll({ type: "window", includeUncontrolled: true }),
  openWindow: (url) => sw.clients.openWindow(url),
  fetch: (input, init) => fetch(input, init),
};

sw.addEventListener("push", (event) => {
  event.waitUntil(handlePush(deps, event.data ? event.data.text() : null));
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleClick(deps, (event.notification.data as { url?: unknown } | null)?.url));
});

// The browser replaced (or dropped) the push subscription while the app was closed (11.2).
sw.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = appConfig.vapidPublicKey;
      const next =
        event.newSubscription ??
        (key
          ? await sw.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64urlDecode(key),
            })
          : null);
      if (next) await handleSubscriptionChange(deps, next, event.oldSubscription?.endpoint);
    })(),
  );
});
