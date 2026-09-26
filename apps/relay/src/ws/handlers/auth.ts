// The login handshake (spec 7.3):
//   1. devicePub is 65 bytes with the 0x04 prefix     ┐
//   2. deviceIdFrom(devicePub) === deviceId           ├ verifyAuth (packages/crypto/device-auth)
//   3. ECDSA verify(sig, auth message)                ┘ over RELAY_HOST (config, never the Host header)
//                                                       and this socket's one-time server nonce
//   4. the device is not retired or blocked
//   5. client.ver >= minClient, else 4426
// Then: auth.ok, the route is registered, and the inbox is drained.
import { CLOSE, type ClientFrame } from "@pehchaan/protocol";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { verifyAuth } from "@pehchaan/crypto/device-auth";
import type { Hub } from "../../hub";
import type { Connection } from "../connection";

type AuthFrame = Extract<ClientFrame, { t: "auth" }>;

/** a < b for dotted numeric versions ("1.0.0+9c1e2ab" compares as 1.0.0). */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split(/[+-]/)[0]!.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

export async function handleAuth(hub: Hub, conn: Connection, f: AuthFrame): Promise<void> {
  const b = f.body;
  if (conn.deviceId) return conn.sendError({ code: "bad_request" }, f.id); // already logged in
  // The server nonce is used exactly once: a second attempt on this socket can never succeed.
  const nonce = conn.serverNonce;
  conn.serverNonce = null;
  const ok = nonce !== null && (await verifyAuth(b, nonce, hub.config.RELAY_HOST));
  if (!ok) {
    hub.metrics.wsAuth.inc({ result: "bad_sig" });
    const wait = await hub.limiter.check("login_fail_ip", hub.limiter.ipKey(conn.ip)).catch(() => 0);
    if (wait > 0) {
      await hub.audit.record("auth_failed_burst", null, {});
      return conn.close(CLOSE.RATE_LIMIT, "too many failed logins");
    }
    return conn.close(CLOSE.LOGIN_FAILED, "login failed");
  }
  if (olderThan(b.client.ver, hub.config.MIN_CLIENT_VERSION)) {
    hub.metrics.wsAuth.inc({ result: "too_old" });
    return conn.close(CLOSE.APP_TOO_OLD, "update Pehchaan");
  }
  const status = await hub.devices.status(b.deviceId);
  if (status.retired || status.blocked) {
    hub.metrics.wsAuth.inc({ result: "blocked" });
    return conn.close(CLOSE.RETIRED_OR_BLOCKED, "retired or blocked");
  }
  await hub.devices.touch(b.deviceId, b64urlDecode(b.devicePub), b.client.platform, b.client.ver);

  conn.authenticated(b.deviceId, b.client.platform);
  const replaced = hub.sessions.add(conn);
  if (replaced) replaced.close(CLOSE.REPLACED, "replaced by a newer connection");
  await hub.router.addRoute(b.deviceId);
  hub.metrics.wsAuth.inc({ result: "ok" });
  hub.metrics.wsConnections.inc({ platform: b.client.platform });

  const [pushStatus, lab] = await Promise.all([
    hub.subscriptions.status(b.deviceId).catch(() => "missing" as const),
    hub.lab ? hub.lab.optInState(b.deviceId) : Promise.resolve({ optedIn: false }),
  ]);
  conn.send("auth.ok", { serverTime: Date.now(), pushStatus, lab });
  hub.log.debug({ dev: hub.hmac(b.deviceId), platform: b.client.platform }, "login");

  // Drain the inbox: everything that waited for this device, soonest expiry first (8.5). Each frame's ttlMs
  // is rewritten to the time left now; the device acks each one, which removes it.
  const now = Date.now();
  for (const s of await hub.inbox.pending(b.deviceId, now)) {
    const ttl = s.expiresAt - Date.now();
    if (ttl <= 0) continue;
    conn.sendText(JSON.stringify({ ...s.frame, sts: Date.now(), body: { ...s.frame.body, ttlMs: ttl } }));
  }
  if (hub.lab) await hub.lab.onLogin(conn);
}
