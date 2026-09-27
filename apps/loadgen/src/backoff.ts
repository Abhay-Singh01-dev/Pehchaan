// Reconnect delays, the same as the app's (spec 8.9): 0.5, 1, 2, 4, 8 s, then every 8 s, each ±30%, so
// thousands of simulated phones don't come back at the same instant after a relay container stops.
const STEPS_MS = [500, 1000, 2000, 4000, 8000] as const;

/** Delay before reconnect attempt `n` (0-based). `random` is injectable so tests are deterministic. */
export function backoffMs(n: number, random: () => number = Math.random): number {
  const base = STEPS_MS[Math.min(n, STEPS_MS.length - 1)]!;
  return Math.round(base * (0.7 + random() * 0.6));
}
