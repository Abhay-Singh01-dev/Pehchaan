// grant.set, contact.list, contact.revoke / unrevoke and device.retire (spec 6.4, 6.6, 16.3 row 9):
// every one of them acts only on the authenticated device itself.
import type { ClientFrame } from "@pehchaan/protocol";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import type { Hub } from "../../hub";
import { ownDeviceOnly } from "../../core/authz";
import type { Connection } from "../connection";

type Frame<T extends ClientFrame["t"]> = Extract<ClientFrame, { t: T }>;

const ok = (conn: Connection, id: string) => conn.send("receipt", { of: id, state: "accepted" });

/** Register my contact grant (sent on every login); `rotate` revokes the older ones ("Reset my code"). */
export async function handleGrantSet(hub: Hub, conn: Connection, f: Frame<"grant.set">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  const hash = Buffer.from(b64urlDecode(f.body.hash)); // the schema guarantees 32 bytes
  await hub.contacts.setGrant(me, f.body.grantId, hash, f.body.rotate);
  ok(conn, f.id);
}

/** Who can reach me (P1). Device IDs and dates only; the app resolves names from its own family list. */
export async function handleContactList(hub: Hub, conn: Connection, _f: Frame<"contact.list">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  conn.send("contact.list.result", { contacts: await hub.contacts.list(me) });
}

/** Remove {label} from family (C7): that device can no longer contact me, even with my grant. */
export async function handleContactRevoke(hub: Hub, conn: Connection, f: Frame<"contact.revoke">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  // A device the relay has never seen can't hold a binding; the grant rotation that Remove does by
  // default covers it (D-029).
  if ((await hub.devices.status(f.body.deviceId)).exists) await hub.contacts.revoke(me, f.body.deviceId);
  ok(conn, f.id);
}

/** Re-added in person (C5): clears my block on that device. */
export async function handleContactUnrevoke(hub: Hub, conn: Connection, f: Frame<"contact.unrevoke">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  await hub.contacts.unrevoke(me, f.body.deviceId);
  ok(conn, f.id);
}

/** "Delete my data" (6.6): tombstone the device and delete what the relay holds about it. */
export async function handleRetire(hub: Hub, conn: Connection, f: Frame<"device.retire">): Promise<void> {
  const me = ownDeviceOnly(conn.deviceId!);
  ok(conn, f.id);
  await hub.retire(me);
}
