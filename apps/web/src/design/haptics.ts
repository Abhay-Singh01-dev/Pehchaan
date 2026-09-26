// Haptics (spec B7). navigator.vibrate is Android-only; every call is feature-detected
// and fails silently elsewhere.

export const HAPTICS = {
  press: [8],
  chip: [5],
  incoming: [220, 120, 220, 900],
  confirmed: [40, 40, 60],
  denied: [260, 120, 260],
  fake: [70, 50, 70, 50, 70],
  amber: [140],
  success: [30, 60, 30],
  error: [120, 80, 120],
  lock: [18],
} as const satisfies Record<string, readonly number[]>;

export type HapticName = keyof typeof HAPTICS;

// Browsers ignore (and warn about) vibration before the person has interacted with the page.
const canVibrate = () => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
};

export function haptic(name: HapticName) {
  if (!canVibrate()) return;
  try {
    navigator.vibrate([...HAPTICS[name]]);
  } catch {
    // Some browsers throw when vibration is blocked by permissions policy.
  }
}

/** Repeats a pattern until the returned stop function is called. */
export function hapticLoop(name: HapticName): () => void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return () => {};
  // Each beat re-checks activation, so the loop starts buzzing once the person has tapped.
  const pattern = HAPTICS[name];
  const period = pattern.reduce((a, b) => a + b, 0);
  haptic(name);
  const id = window.setInterval(() => haptic(name), period);
  return () => {
    window.clearInterval(id);
    if (!canVibrate()) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  };
}
