// presence.query (spec 12): "if I ask this person now, will it reach them?" Not a social "last seen".
//   online  = at least one live socket on a live gateway
//   push    = no socket, but a working push subscription (the normal state for a phone in a pocket)
//   offline = neither
// Only devices that accept messages from me (a binding id ← me) are answered truthfully; every other ID
// is reported offline, so the relay reveals nothing about strangers. There are no timestamps.
import type { ClientFrame, PresenceState } from "@pehchaan/protocol";
import type { Hub } from "../../hub";
import { presenceVisible } from "../../core/authz";
import type { Connection } from "../connection";

type Frame = Extract<ClientFrame, { t: "presence.query" }>;

export async function handlePresence(hub: Hub, conn: Connection, f: Frame): Promise<void> {
  const me = conn.deviceId!;
  await hub.limiter.take("presence_device", me);
  const visible = await presenceVisible(hub, me, f.body.ids);
  const states: Record<string, PresenceState> = {};
  for (const id of f.body.ids) {
    if (!visible.has(id)) {
      states[id] = "offline";
    } else if ((await hub.router.aliveGateways(id)).length > 0) {
      states[id] = "online";
    } else {
      states[id] = (await hub.push.status(id)) === "ok" ? "push" : "offline";
    }
  }
  conn.send("presence", { states });
}
