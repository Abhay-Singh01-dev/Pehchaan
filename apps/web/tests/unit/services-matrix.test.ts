// FC-1 / APP-01: SIM_RELAY, SIM_KEY and SIM_VERIFIER are independent. Every one of the 8 combinations builds a
// working service set, and each flag swaps exactly its own service.
import { afterEach, describe, expect, it, vi } from "vitest";

const combos = [false, true].flatMap((relay) =>
  [false, true].flatMap((key) => [false, true].map((verifier) => ({ relay, key, verifier }))),
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe.each(combos)("SIM_RELAY=$relay SIM_KEY=$key SIM_VERIFIER=$verifier", ({ relay, key, verifier }) => {
  it("builds the matching services", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SIM_RELAY", String(relay));
    vi.stubEnv("VITE_SIM_KEY", String(key));
    vi.stubEnv("VITE_SIM_VERIFIER", String(verifier));
    const { services, simControls } = await import("@/services");
    const { flags } = await import("@/app/flags");
    const { SimRelay } = await import("@/services/sim/SimRelay");
    const { RealRelay } = await import("@/services/real/relay/RealRelay");

    expect(flags).toMatchObject({ SIM_RELAY: relay, SIM_KEY: key, SIM_VERIFIER: verifier });
    expect(services.relay).toBeInstanceOf(relay ? SimRelay : RealRelay);
    // The simulated relay reports that it isn't sealing anything; the real one always seals (FC-7).
    expect(services.relay.info().e2e).toBe(!relay);
    // Every service is present and callable.
    for (const name of ["key", "verifier", "card", "requests"] as const) expect(services[name]).toBeDefined();
    expect(typeof services.key.signAnswer).toBe("function");
    expect(typeof services.verifier.verify).toBe("function");
    // The Simulation panel exists whenever anything is simulated, and only then.
    expect(simControls === null).toBe(!relay && !key && !verifier);
    if (services.relay instanceof RealRelay) services.relay.disconnect();
  });
});
