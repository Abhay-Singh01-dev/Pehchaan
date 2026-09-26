// Feature flags (frontend spec B3, backend spec 22.1 FC-1). Read from Vite env vars at build time.
//   VITE_SIM_RELAY      simulated relay (BroadcastChannel between tabs) instead of the real WebSocket relay
//   VITE_SIM_KEY        simulated key (a software authenticator behind the simulated unlock sheet) instead of
//                       the phone's passkey
//   VITE_SIM_VERIFIER   simulated verifier: the SAME 7 checks, expecting this page's own origin and rpId
//                       instead of the configured production ones (D-008)
//   VITE_SIMULATION     default for all three (true), kept for older .env files
//   VITE_ENABLE_LAB     the /lab route exists
//   VITE_ENABLE_GUARD   the /guard route and the B2 banner exist
//   VITE_ENABLE_EXTRAS  the optional screens C9, D5, I6
// The "Simulated …" badge shows whichever parts are simulated. Never show judges a build with it.

const env = import.meta.env as Record<string, string | undefined>;

function flag(name: string, fallback: boolean): boolean {
  const raw = env[`VITE_${name}`] ?? env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

const simulationDefault = flag("SIMULATION", true);

export const flags = Object.freeze({
  SIM_RELAY: flag("SIM_RELAY", simulationDefault),
  SIM_KEY: flag("SIM_KEY", simulationDefault),
  SIM_VERIFIER: flag("SIM_VERIFIER", simulationDefault),
  /** True when anything is simulated (the badge, the Simulation panel). */
  get SIMULATION() {
    return this.SIM_RELAY || this.SIM_KEY || this.SIM_VERIFIER;
  },
  ENABLE_LAB: flag("ENABLE_LAB", true),
  ENABLE_GUARD: flag("ENABLE_GUARD", true),
  ENABLE_EXTRAS: flag("ENABLE_EXTRAS", false),
});

/** The app's own version, sent at login (`client.ver`, 7.3): package version + short git SHA at build time. */
export const APP_VERSION = env.VITE_APP_VERSION || "1.0.0";
