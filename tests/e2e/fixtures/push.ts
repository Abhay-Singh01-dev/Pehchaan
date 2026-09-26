// A phone whose browser holds a push subscription at the local stand-in push service (J-06).
//
// A real browser's PushManager.subscribe() talks to Google's, Apple's or Mozilla's push service, which a test
// can't reach. So this phone's browser gets a subscription created by the test (newSubscription: real P-256
// keys, an endpoint at an allowlisted host). Everything else is real: the app's A8 flow asks for permission and
// subscribes, the relay stores the subscription, and when the app is closed the relay encrypts (RFC 8291) and
// signs (VAPID) a real push, which the stand-in decrypts with the subscription's private key.
import type { BrowserContext } from "@playwright/test";
import type { TestSubscription } from "../../../apps/relay/test/helpers/mock-push";

export async function givePushSubscription(ctx: BrowserContext, sub: TestSubscription, origin: string): Promise<void> {
  // "Allow" on the browser's permission prompt.
  await ctx.grantPermissions(["notifications"], { origin });
  await ctx.addInitScript(
    ({ endpoint, p256dh, auth }) => {
      const bytes = (s: string) =>
        Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)).buffer;
      // Kept in localStorage: like a browser's, the subscription outlives the page.
      const KEY = "e2e:push-subscribed";
      const subscription = {
        endpoint,
        getKey: (name: string) => bytes(name === "p256dh" ? p256dh : auth),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      };
      const registration = {
        active: {},
        pushManager: {
          getSubscription: async () => (localStorage.getItem(KEY) ? subscription : null),
          subscribe: async () => {
            localStorage.setItem(KEY, "1");
            return subscription;
          },
        },
        getNotifications: async () => [],
      };
      Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => registration });
    },
    { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
  );
}
