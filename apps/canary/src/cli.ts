// The canary CLI (spec 19.6, 18.8):
//   canary   one run of the synthetic check (scheduled every 10 min by .github/workflows/canary.yml)
//   smoke    the post-deploy smoke test (deploy-relay.yml): /healthz, /readyz, then one canary run
//   keys     prints a new CANARY_IDENTITIES value (two software identities; store it as a secret)
// Settings (environment): CANARY_RELAY_URL (wss://…/v1/ws), CANARY_ORIGIN (the app origin), CANARY_RELAY_HOST
// (defaults to the URL's host), CANARY_IDENTITIES (from `keys`; without it, fresh devices are made for this run).
// Prints one JSON line and exits 0 on success, 1 on failure.
import { runCanary } from "./canary";
import { loadDevice, newIdentity, type StoredIdentity } from "./device";
import type { Endpoint } from "./client";

export interface Settings {
  ep: Endpoint;
  identities: { asker: StoredIdentity; answerer: StoredIdentity } | null;
}

/** Reads and checks the settings (pure: the environment is passed in). */
export function settingsFrom(env: Record<string, string | undefined>): Settings {
  const url = env.CANARY_RELAY_URL;
  const origin = env.CANARY_ORIGIN;
  if (!url || !/^wss?:\/\//.test(url)) throw new Error("CANARY_RELAY_URL must be the relay's ws(s):// URL");
  if (!origin || !/^https?:\/\//.test(origin)) throw new Error("CANARY_ORIGIN must be the app's origin");
  const identities = env.CANARY_IDENTITIES ? (JSON.parse(env.CANARY_IDENTITIES) as Settings["identities"]) : null;
  if (identities && (!identities.asker?.sign || !identities.answerer?.sign)) {
    throw new Error("CANARY_IDENTITIES must hold an asker and an answerer (see `canary keys`)");
  }
  return { ep: { url, origin, relayHost: env.CANARY_RELAY_HOST ?? new URL(url).host }, identities };
}

/** The relay's HTTP origin, from its WebSocket URL. */
export const httpBase = (wsUrl: string) => wsUrl.replace(/^ws/, "http").replace(/\/v1\/ws$/, "");

async function canary(s: Settings) {
  const ids = s.identities ?? { asker: await newIdentity(), answerer: await newIdentity() };
  return runCanary(s.ep, await loadDevice(ids.asker), await loadDevice(ids.answerer));
}

async function smoke(s: Settings) {
  const base = httpBase(s.ep.url);
  for (const path of ["/healthz", "/readyz"]) {
    const res = await fetch(`${base}${path}`).catch((e: Error) => ({ ok: false, status: e.message }) as const);
    if (!res.ok) return { ok: false, error: `${path}: ${res.status}` };
  }
  return canary(s);
}

async function main(cmd: string | undefined) {
  if (cmd === "keys") {
    console.log(JSON.stringify({ asker: await newIdentity(), answerer: await newIdentity() }));
    return 0;
  }
  if (cmd !== "canary" && cmd !== "smoke") {
    console.error("usage: cli.ts canary | smoke | keys");
    return 2;
  }
  const s = settingsFrom(process.env);
  const result = cmd === "canary" ? await canary(s) : await smoke(s);
  console.log(JSON.stringify({ check: cmd, at: new Date().toISOString(), ...result }));
  return result.ok ? 0 : 1;
}

// Run only as a program (tests import the functions above).
if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  // exitCode, not exit(): the sockets finish closing first (exiting mid-close crashes Node on Windows).
  main(process.argv[2]).then(
    (code) => (process.exitCode = code),
    (e: Error) => {
      console.log(JSON.stringify({ ok: false, error: e.message }));
      process.exitCode = 1;
    },
  );
}
