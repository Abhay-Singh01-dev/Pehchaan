// push.subscribe / unsubscribe / test (spec 7.4, 11.2, 11.3, 11.8). Only ever for MY device (16.3 row 9).
import type { ClientFrame } from "@pehchaan/protocol";
import type { Hub } from "../../hub";
import { ownDeviceOnly } from "../../core/authz";
import type { Connection } from "../connection";

type Frame<T extends ClientFrame["t"]> = Extract<ClientFrame, { t: T }>;

/** Save or refresh my Web Push subscription (sent on every login). The endpoint must be a known push
 *  service over https, or it is refused (SSRF guard, 11.3). */
export async function handlePushSubscribe(hub: Hub, conn: Connection, f: Frame<"push.subscribe">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  await hub.limiter.take("push_subscribe_device", me);
  await hub.subscriptions.save(me, f.body);
  conn.send("receipt", { of: f.id, state: "accepted" });
}

export async function handlePushUnsubscribe(hub: Hub, conn: Connection, f: Frame<"push.unsubscribe">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  await hub.subscriptions.remove(me, f.body.endpoint);
  conn.send("receipt", { of: f.id, state: "accepted" });
}

/** Diagnostics "Send test alert": a test notification to ME after 10 s (enough time to lock the screen). */
export async function handlePushTest(hub: Hub, conn: Connection, f: Frame<"push.test">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  await hub.limiter.take("push_test_device", me);
  conn.send("receipt", { of: f.id, state: "accepted" });
  hub.pushTest(me, f.id);
}
