// Feature flags (spec B3). Read from Vite env vars at build time, with the spec's defaults.
//   VITE_SIMULATION     true  → services/sim/* + the "Simulated network" badge
//   VITE_ENABLE_LAB     true  → the /lab route exists
//   VITE_ENABLE_GUARD   true  → the /guard route and the B2 banner exist
//   VITE_ENABLE_EXTRAS  false → the optional screens A8, C9, D5, I6

const env = import.meta.env as Record<string, string | undefined>;

function flag(name: string, fallback: boolean): boolean {
  const raw = env[`VITE_${name}`] ?? env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export const flags = Object.freeze({
  SIMULATION: flag("SIMULATION", true),
  ENABLE_LAB: flag("ENABLE_LAB", true),
  ENABLE_GUARD: flag("ENABLE_GUARD", true),
  ENABLE_EXTRAS: flag("ENABLE_EXTRAS", false),
});

export const APP_VERSION = "1.0.0";
