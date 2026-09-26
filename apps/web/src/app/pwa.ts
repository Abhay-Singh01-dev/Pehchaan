// PWA install and update flow (spec B14).
//   - Captures `beforeinstallprompt` for A1 (Android / Chrome).
//   - Detects standalone mode.
//   - When a new service worker is waiting, marks `updateReady`; the UpdateToast shows
//     "Update ready · Reload" — never during D3, F1 or a verdict screen.
import { registerSW } from "virtual:pwa-register";
import { useSession, type BeforeInstallPromptEvent } from "./session";

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type Platform = "android" | "ios" | "inapp" | "desktop" | "other";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|LinkedInApp|WhatsApp|GSA\//i.test(ua)) return "inapp";
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "other";
}

export function installPwa() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useSession.setState({ installPrompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => useSession.setState({ installPrompt: null }));

  if (import.meta.env.DEV) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useSession.setState({ updateReady: true });
    },
  });
}

export function applyUpdate() {
  if (updateSW) void updateSW(true);
  else window.location.reload();
}

/** FC-23: the relay refused this version (close 4426). Fetch the new service worker now, then reload into it. */
export async function forceUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // No service worker (dev, or unsupported): a plain reload fetches the new version.
  }
  if (useSession.getState().updateReady && updateSW) return void updateSW(true);
  window.location.reload();
}
