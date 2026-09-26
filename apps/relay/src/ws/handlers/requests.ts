// ack, seen and cancel (spec 8.4, 8.6, 16.3 rows 4–6).
import { ulid, type ClientFrame } from "@pehchaan/protocol";
import type { Hub } from "../../hub";
import { ackTargetsOwnInbox, maySee, mayCancel } from "../../core/authz";
import type { Connection } from "../connection";
import { sendCancel } from "./send";

type Frame<T extends ClientFrame["t"]> = Extract<ClientFrame, { t: T }>;

/** "I received it": clears MY inbox entry and tells the sender `delivered`. With several sockets for one
 *  device, only the first ack removes the entry, so the sender hears about it once. */
export async function handleAck(hub: Hub, conn: Connection, f: Frame<"ack">): Promise<void> {
  const me = ackTargetsOwnInbox(conn.deviceId!);
  hub.router.acked(me, f.body.of);
  const stored = await hub.inbox.ack(me, f.body.of);
  if (!stored) return;
  const body = stored.frame.body;
  if (body.kind === "verify.cancel") return; // relay notices have no sender to tell
  hub.metrics.receipts.inc({ state: "delivered" });
  await hub.router.notify(body.from, {
    v: 1,
    t: "receipt",
    id: ulid(),
    sts: Date.now(),
    body: { of: f.body.of, to: me, ...(typeof body.re === "string" ? { re: body.re } : {}), state: "delivered" },
  });
}

/** "The question is on my screen": the asker's D3 can show "Seen" (P1). */
export async function handleSeen(hub: Hub, conn: Connection, f: Frame<"seen">): Promise<void> {
  const me = conn.deviceId!;
  const asker = await maySee(hub, me, f.body.re);
  hub.metrics.receipts.inc({ state: "seen" });
  // The request's message id is its request id (D-009), so `of` names the request itself.
  await hub.router.notify(asker, {
    v: 1,
    t: "receipt",
    id: ulid(),
    sts: Date.now(),
    body: { of: f.body.re, re: f.body.re, to: me, state: "seen" },
  });
}

/** The asker stops waiting (D3 Cancel): its targets get verify.cancel { asker_cancelled }. */
export async function handleCancel(hub: Hub, conn: Connection, f: Frame<"cancel">): Promise<void> {
  const me = conn.deviceId!;
  const targets = await mayCancel(hub, me, f.body.re);
  hub.metrics.requests.inc({ outcome: "cancelled" });
  for (const t of targets) await sendCancel(hub, me, f.body.re, t, "asker_cancelled");
  conn.send("receipt", { of: f.id, re: f.body.re, state: "accepted" });
}
