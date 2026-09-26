// The family app shell (spec B12.0 AppShell): background with --bg, the glow and noise;
// a centred 480px column on wide screens; safe areas; global overlays and listeners.
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { AnimatedRoutes } from "./AnimatedRoutes";
import { GlobalListeners } from "./GlobalListeners";
import { lazyNamed, preloadCritical, prefetchScreens } from "./lazy";
import { prefetchOtherLanguage } from "./i18n";
import { useUi } from "./ui";
import { TabBar } from "@/components/TabBar";
import { SimulationBadge } from "@/components/SimulationBadge";
import { ToastHost } from "@/components/Toasts";
import { useUnlockBridge } from "@/services/sim/unlockBridge";
import { PHONE_ROOT_ID } from "@/design/origin";

// Overlays that aren't needed for the first screen load on first use (prefetched when idle).
const BannerHost = lazyNamed(() => import("./Banners"), "BannerHost");
const UnlockSheet = lazyNamed(() => import("@/components/UnlockSheet"), "UnlockSheet");

/** Mounts `children` from the first time `when` is true, and keeps them mounted (exit animations). */
function MountOnce({ when, children }: { when: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(when);
  useEffect(() => {
    if (when) setMounted(true);
  }, [when]);
  return mounted ? <Suspense fallback={null}>{children}</Suspense> : null;
}

export function FamilyApp() {
  const hasBanners = useUi((s) => s.banners.length > 0);
  const unlocking = useUnlockBridge((s) => s.pending !== null);

  useEffect(() => {
    preloadCritical();
    const id = window.setTimeout(() => {
      prefetchScreens();
      prefetchOtherLanguage();
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    // Phones: full screen. Wider screens: a 375 × 667 phone card on the page's glow.
    <div className="phone-stage frame-bg">
      <div id={PHONE_ROOT_ID} className="phone-frame">
        <AnimatedRoutes />
        <TabBar />
        <SimulationBadge />
        <MountOnce when={hasBanners}>
          <BannerHost />
        </MountOnce>
        <ToastHost />
        <MountOnce when={unlocking}>
          <UnlockSheet />
        </MountOnce>
      </div>
      <GlobalListeners />
    </div>
  );
}
