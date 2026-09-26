// Routes each parsed frame to its handler. Before login only `auth` and `ping` are accepted (16.3 row 1).
import type { ClientFrame } from "@pehchaan/protocol";
import type { Hub } from "../hub";
import { refuse } from "../core/refusal";
import type { Connection } from "./connection";
import { handleAuth } from "./handlers/auth";
import { handleSend } from "./handlers/send";
import { handleAck, handleCancel, handleSeen } from "./handlers/requests";
import {
  handleContactList,
  handleContactRevoke,
  handleContactUnrevoke,
  handleGrantSet,
  handleRetire,
} from "./handlers/contacts";
import { handlePresence } from "./handlers/presence";
import { handlePushSubscribe, handlePushTest, handlePushUnsubscribe } from "./handlers/push";
import { handleLab } from "./handlers/lab";

export async function dispatch(hub: Hub, conn: Connection, f: ClientFrame): Promise<void> {
  switch (f.t) {
    case "auth":
      return handleAuth(hub, conn, f);
    case "ping":
      conn.send("pong", { serverTime: Date.now() });
      return;
  }
  if (!conn.deviceId) refuse("unauthenticated");
  switch (f.t) {
    case "send":
      return handleSend(hub, conn, f);
    case "ack":
      return handleAck(hub, conn, f);
    case "seen":
      return handleSeen(hub, conn, f);
    case "cancel":
      return handleCancel(hub, conn, f);
    case "presence.query":
      return handlePresence(hub, conn, f);
    case "push.subscribe":
      return handlePushSubscribe(hub, conn, f);
    case "push.unsubscribe":
      return handlePushUnsubscribe(hub, conn, f);
    case "push.test":
      return handlePushTest(hub, conn, f);
    case "grant.set":
      return handleGrantSet(hub, conn, f);
    case "contact.list":
      return handleContactList(hub, conn, f);
    case "contact.revoke":
      return handleContactRevoke(hub, conn, f);
    case "contact.unrevoke":
      return handleContactUnrevoke(hub, conn, f);
    case "device.retire":
      return handleRetire(hub, conn, f);
    default:
      return handleLab(hub, conn, f);
  }
}
