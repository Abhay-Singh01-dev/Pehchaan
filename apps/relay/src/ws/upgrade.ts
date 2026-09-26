// Accepting a WebSocket (spec 7.1, 16.2), before any work is done for it:
//   path /v1/ws · not draining and under MAX_SOCKETS (else 503) · Origin allowed (else 403) · subprotocol
//   pehchaan.v1 (else 426) · then, once upgraded (so the app can read the close code): the per-IP connection
//   rate limit and the cap of 20 unauthenticated sockets per IP (both 4429).
// The Origin header is a browser safeguard, not authentication; the device signature at login is.
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { CLOSE, LIMITS, SUBPROTOCOL } from "@pehchaan/protocol";
import { WebSocketServer } from "ws";
import type { Hub } from "../hub";
import { Connection } from "./connection";

const normalize = (ip: string) => (ip.startsWith("::ffff:") ? ip.slice(7) : ip);

export function trustList(cidrs: string[]): BlockList {
  const list = new BlockList();
  for (const c of cidrs) {
    const [addr, bits] = c.split("/") as [string, string | undefined];
    const type = isIP(addr) === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(bits), type);
  }
  return list;
}

/** The client's IP. X-Forwarded-For is honoured ONLY when the connection comes from a trusted proxy
 *  (Caddy); otherwise anyone could forge their IP and dodge the limits (16.2, REL-21). */
export function clientIp(req: IncomingMessage, trusted: BlockList): string {
  const remote = normalize(req.socket.remoteAddress ?? "");
  const isTrusted = (ip: string) => {
    const t = isIP(ip);
    return t !== 0 && trusted.check(ip, t === 6 ? "ipv6" : "ipv4");
  };
  const xff = req.headers["x-forwarded-for"];
  if (!isTrusted(remote) || typeof xff !== "string") return remote;
  // The right-most address that isn't one of our own proxies is the client.
  const hops = xff.split(",").map((h) => normalize(h.trim()));
  for (let i = hops.length - 1; i >= 0; i--) {
    if (isIP(hops[i]!) && !isTrusted(hops[i]!)) return hops[i]!;
  }
  return remote;
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createUpgradeHandler(hub: Hub, hooks: { onGone: (c: Connection) => void }) {
  const trusted = trustList(hub.config.TRUST_PROXY);
  const origins = new Set(hub.config.PUBLIC_ORIGINS);
  /** Unauthenticated sockets per IP (at most 20, 16.2), and in total (they count toward MAX_SOCKETS). */
  const pendingByIp = new Map<string, number>();
  const pending = new Set<Connection>();
  let seq = 0;

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // compressing attacker-influenced data next to secrets is a known risk (7.1)
    maxPayload: LIMITS.SOCKET_MAX_PAYLOAD, // larger frames are closed with 1009
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  const settle = (c: Connection) => {
    if (!pending.delete(c)) return;
    const n = (pendingByIp.get(c.ip) ?? 1) - 1;
    if (n <= 0) pendingByIp.delete(c.ip);
    else pendingByIp.set(c.ip, n);
  };

  return {
    wss,
    unauthenticatedCount: () => pending.size,
    unauthenticated: () => [...pending],

    handle(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/v1/ws") return reject(socket, 404, "Not Found");
      if (hub.state.refuseUpgrades || hub.sessions.count + pending.size >= hub.config.MAX_SOCKETS) {
        return reject(socket, 503, "Service Unavailable");
      }
      if (!origins.has(String(req.headers.origin ?? ""))) return reject(socket, 403, "Forbidden");
      const offered = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((p) => p.trim());
      if (!offered.includes(SUBPROTOCOL)) return reject(socket, 426, "Upgrade Required");

      const ip = clientIp(req, trusted);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = new Connection(hub, ws, ip, ++seq, {
          onAuthenticated: settle,
          onGone: (c) => {
            settle(c);
            hooks.onGone(c);
          },
        });
        pending.add(conn);
        pendingByIp.set(ip, (pendingByIp.get(ip) ?? 0) + 1);
        if (pendingByIp.get(ip)! > LIMITS.UNAUTH_PER_IP) {
          conn.close(CLOSE.RATE_LIMIT, "too many pending connections");
          return;
        }
        hub.limiter
          .check("upgrade_ip", hub.limiter.ipKey(ip))
          .then((wait) => {
            if (wait > 0) {
              hub.metrics.rateLimited.inc({ scope: "upgrade_ip" });
              conn.close(CLOSE.RATE_LIMIT, "too many connections");
              return;
            }
            conn.start();
          })
          .catch(() => conn.close(CLOSE.SERVICE_RESTART, "unavailable"));
      });
    },
  };
}
