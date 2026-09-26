// Which "device" this browser tab is (frontend spec B3, item 2).
//
// With the simulated relay, `?device=<name>` makes the tab its own phone: its own IndexedDB database
// (`pehchaan-<name>`) and so its own identity (the seeded names maa, arjun and priya get fixed keys, so the tabs can
// reach each other). The name sticks to the tab for the session, so navigating or reloading keeps it. Without the
// parameter, and always with the real relay, the tab is `pehchaan-default`.
import { flags } from "./flags";

const SESSION_KEY = "pehchaan:device";

export interface DeviceContext {
  /** e.g. "maa", "arjun"; null for the default device. */
  simName: string | null;
  dbName: string;
}

function sanitize(name: string): string | null {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
  return clean || null;
}

function resolve(): DeviceContext {
  if (typeof window === "undefined" || !flags.SIM_RELAY) {
    return { simName: null, dbName: "pehchaan-default" };
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
  if (!name || name === "default") return { simName: null, dbName: "pehchaan-default" };
  return { simName: name, dbName: `pehchaan-${name}` };
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
