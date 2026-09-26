// Which "device" this browser tab is (spec B3, item 2).
//
// In simulation mode, `?device=<name>` makes the tab its own phone: its own IndexedDB
// database (`pehchaan-<name>`) and its own device id (`sim-<name>`, stable so the seeded
// tabs can reach each other). The name sticks to the tab for the session, so navigating
// or reloading keeps it. Without the parameter the tab is `pehchaan-default`.
import { flags } from "./flags";

const SESSION_KEY = "pehchaan:device";

export interface DeviceContext {
  /** e.g. "maa", "arjun"; null for the default device. */
  simName: string | null;
  dbName: string;
  /** Known up front for named simulation devices; otherwise generated and stored in the DB. */
  fixedDeviceId: string | null;
}

function sanitize(name: string): string | null {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
  return clean || null;
}

function resolve(): DeviceContext {
  if (typeof window === "undefined" || !flags.SIMULATION) {
    return { simName: null, dbName: "pehchaan-default", fixedDeviceId: null };
  }
  let name: string | null = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("device");
    if (fromUrl !== null) {
      name = sanitize(fromUrl);
      if (name) sessionStorage.setItem(SESSION_KEY, name);
      else sessionStorage.removeItem(SESSION_KEY);
    } else {
      name = sanitize(sessionStorage.getItem(SESSION_KEY) ?? "");
    }
  } catch {
    // sessionStorage can be unavailable (private mode quirks); fall back to the URL only.
  }
  if (!name || name === "default") return { simName: null, dbName: "pehchaan-default", fixedDeviceId: null };
  return { simName: name, dbName: `pehchaan-${name}`, fixedDeviceId: `sim-${name}` };
}

export const device: DeviceContext = resolve();

/** Removes ?device= from the address bar once it's remembered, keeping URLs clean. */
export function tidyDeviceParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("device")) return;
    url.searchParams.delete("device");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}
