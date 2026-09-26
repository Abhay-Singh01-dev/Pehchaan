// Screen wake lock (spec B7): held while waiting (D3) and while a request is open (F1).
// Failures are ignored: the feature is a nicety, never a requirement.
import { useEffect } from "react";

type Sentinel = { release: () => Promise<void>; released: boolean };

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request("screen");
        if (cancelled) void s.release().catch(() => {});
        else sentinel = s;
      } catch {
        /* ignore */
      }
    };
    // The lock is dropped whenever the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
