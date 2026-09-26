// Where this build runs and which relay it talks to (backend spec 5.3, 18.7). Vite bakes these in at build
// time, so changing one needs a new build.
//   VITE_ENV              development | test | staging | production
//   VITE_ORIGIN           https://app.yourdomain.in       (the origin passkeys sign for; verifier check 4)
//   VITE_RP_ID            app.yourdomain.in               (the passkey rpId; NEVER changes after launch)
//   VITE_RELAY_URL        wss://relay.yourdomain.in/v1/ws
//   VITE_RELAY_HTTP       https://relay.yourdomain.in
//   VITE_RELAY_HOST       optional: the host the relay signs logins for (default: the relay URL's host)
//   VITE_VAPID_PUBLIC_KEY, VITE_VAPID_KEY_ID   must match the relay
//   VITE_SENTRY_DSN       optional
//   VITE_PRIVACY_CONTACT  the grievance contact shown on the privacy notice (17.2)
// Without them (development), everything points at this page's own origin, and the relay at /relay on it
// (the Vite dev server proxies /relay to the local relay, 18.12).

const env = import.meta.env as Record<string, string | undefined>;
const here = typeof location !== "undefined" ? location : new URL("http://localhost/");

function relayUrl(): string {
  if (env.VITE_RELAY_URL) return env.VITE_RELAY_URL;
  const proto = here.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${here.host}/relay/v1/ws`;
}

const url = relayUrl();

export const appConfig = Object.freeze({
  env: (env.VITE_ENV ?? (import.meta.env.DEV ? "development" : "production")) as
    "development" | "test" | "staging" | "production",
  origin: env.VITE_ORIGIN ?? here.origin,
  rpId: env.VITE_RP_ID ?? here.hostname,
  relayUrl: url,
  relayHttp: env.VITE_RELAY_HTTP ?? `${here.origin}/relay`,
  relayHost: env.VITE_RELAY_HOST ?? new URL(url).host,
  vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY ?? "",
  vapidKeyId: env.VITE_VAPID_KEY_ID ?? "v1",
  sentryDsn: env.VITE_SENTRY_DSN ?? "",
  privacyContact: env.VITE_PRIVACY_CONTACT ?? "",
  /** Short build identity shown in Diagnostics, so an unexpected build is visible (16.6). */
  build: env.VITE_APP_VERSION ?? "dev",
});

/** A stable, coarse platform name for `client.platform` at login (7.3). Lower-case, no personal data. */
export function platformName(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const standalone =
    (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return standalone ? "ios-pwa" : "ios-safari";
  const browser = /Edg\//.test(ua)
    ? "edge"
    : /Firefox\//.test(ua)
      ? "firefox"
      : /Chrome\//.test(ua)
        ? "chrome"
        : "browser";
  if (/Android/i.test(ua)) return `android-${browser}${standalone ? "-pwa" : ""}`;
  return `desktop-${browser}`;
}
