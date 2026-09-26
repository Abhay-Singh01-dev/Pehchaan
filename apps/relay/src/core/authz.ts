// AUTHORISATION: every rule of spec 16.3, one function per row, in this one module (B5).
//
// The relay authorises DEVICES, never answers: whether an answer is genuine is decided only on the asker's
// phone. These rules decide who may send what to whom, so a leaked card can't be used to spam someone,
// and a device can only ever act on its own inbox, grants and subscriptions.
import type { ClientBody } from "@pehchaan/protocol";
import type { Hub } from "../hub";
import { refuse } from "./refusal";

/** Row 1 · any message except auth/ping: the socket is authenticated, and the device is not retired or
 *  blocked. (Blocking also closes every socket at once, 16.8; this catches the moment in between.) */
export async function authenticatedAndActive(hub: Hub, deviceId: string | null): Promise<string> {
  if (!deviceId) return refuse("unauthenticated");
  const s = await hub.devices.status(deviceId);
  if (s.retired || s.blocked) refuse("not_allowed");
  return deviceId;
}

/** A target must be a device the relay has seen, and not retired or blocked (unknown_target). */
async function reachableTarget(hub: Hub, to: string): Promise<void> {
  if (!(await hub.devices.isReachableTarget(to))) refuse("unknown_target");
}

/** Row 2 · send verify.request: `re` present; a binding (target ← me) that isn't revoked, OR no binding
 *  row at all and a valid grant (which creates the binding); the target isn't retired or blocked.
 *  (The "fewer than 3 open requests" part is atomic with record creation: core/requests.ts.) */
export async function mayRequest(hub: Hub, me: string, send: ClientBody<"send">): Promise<void> {
  if (!send.re) refuse("bad_request");
  await reachableTarget(hub, send.to);
  await hub.contacts.authorise(send.to, me, send.grant);
}

/** Row 3 · send verify.answer: the request record says I am a target, the recipient is the asker, the
 *  request is open and within deadline + grace. Atomic: first answer wins (8.6). No binding needed. */
export async function mayAnswer(hub: Hub, me: string, send: ClientBody<"send">, now: number) {
  if (!send.re) refuse("bad_request");
  return hub.requests.answer(send.re!, me, send.to, now);
}

/** Row 4 · seen: the request record says I am a target, and the request is still open.
 *  Returns the asker, who gets the `seen` receipt. */
export async function maySee(hub: Hub, me: string, re: string): Promise<string> {
  const rec = await hub.requests.get(re);
  if (!rec || !rec.to.includes(me) || rec.state !== "open") refuse("not_allowed");
  return rec!.from;
}

/** Row 5 · ack: only removes entries from MY OWN inbox. There is nothing to check: the inbox key is built
 *  from the authenticated device ID, never from the message. */
export const ackTargetsOwnInbox = (me: string) => me;

/** Row 6 · cancel: the request record's `from` is me (checked atomically in the cancel script). */
export async function mayCancel(hub: Hub, me: string, re: string): Promise<string[]> {
  return hub.requests.cancel(re, me);
}

/** Row 7 · send alert / guard.prompt: a binding, or a valid grant with no binding row, as for requests. */
export async function mayAlertOrPrompt(hub: Hub, me: string, send: ClientBody<"send">): Promise<void> {
  await reachableTarget(hub, send.to);
  await hub.contacts.authorise(send.to, me, send.grant);
}

/** Row 8 · presence.query: answers only for IDs where a binding (id ← me) exists; everything else is
 *  reported `offline`, so the relay reveals nothing about strangers (12). */
export async function presenceVisible(hub: Hub, me: string, ids: string[]): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const id of new Set(ids)) if (await hub.contacts.isBound(id, me)) visible.add(id);
  return visible;
}

/** Row 9 · contact.revoke / unrevoke, grant.set, push.*, device.retire: only ever act on MY device. The
 *  handlers take the device from the authenticated socket; no message can name another owner. */
export const ownDeviceOnly = (me: string) => me;

/** Row 10 · lab.*: the Lab module is loaded and switched on, plus a Lab session (Lab page) or an opt-in
 *  (phone). Implemented by the Lab module (lab/lab.ts). */
export async function labAvailable(hub: Hub): Promise<void> {
  if (!hub.lab || !(await hub.lab.isOn())) refuse("lab_disabled");
}

/** Row 11 · lab.inject: both `as` and `to` are opted in; an injected answer still goes through the
 *  request-record script (row 3). */
export async function mayInject(hub: Hub, as: string, to: string): Promise<void> {
  await labAvailable(hub);
  if (!(await hub.lab!.isOptedIn(as)) || !(await hub.lab!.isOptedIn(to))) refuse("not_allowed");
}

/** Row 12 · lab.report: the sender is the request record's `from` (the asker). */
export async function mayReport(hub: Hub, me: string, requestId: string): Promise<void> {
  const rec = await hub.requests.get(requestId);
  if (!rec || rec.from !== me) refuse("not_allowed");
}

/** Row 13 · plain bodies: allowed when E2E_REQUIRED=false, or when both ends are opted in to the Lab (9.5). */
export async function plainAllowed(hub: Hub, from: string, to: string): Promise<boolean> {
  if (!hub.config.E2E_REQUIRED) return true;
  if (!hub.lab || !(await hub.lab.isOn())) return false;
  return (await hub.lab.isOptedIn(from)) && (await hub.lab.isOptedIn(to));
}
