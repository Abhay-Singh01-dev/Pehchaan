// The relay's two signed HTTP routes, used by the service worker while the app is closed (spec 11.2, 11.4).
// Each is signed with the device key over a fixed message (packages/crypto device-auth) and carries its time,
// which the relay accepts only within ±120 s of its own clock.
import { z } from "zod";
import { CLIENT_BODIES } from "./client";
import { deviceId, millis, rawSig, ulidString } from "./fields";

/** How far a signed request's time may be from the relay's clock (11.4). */
export const SIGNED_REQUEST_WINDOW_MS = 120_000;

/** POST /v1/inbox/fetch: the frame a "wake" push pointed at (11.4). */
export const inboxFetchBody = z.strictObject({
  deviceId,
  msgId: ulidString,
  ts: millis,
  sig: rawSig,
});
export type InboxFetchBody = z.infer<typeof inboxFetchBody>;

/** POST /v1/push/resubscribe: the browser replaced the push subscription (`pushsubscriptionchange`, 11.2). */
export const pushResubscribeBody = z.strictObject({
  deviceId,
  subscription: CLIENT_BODIES["push.subscribe"],
  /** The subscription it replaces, when the browser still knows it. */
  oldEndpoint: z.string().min(10).max(1024).optional(),
  ts: millis,
  sig: rawSig,
});
export type PushResubscribeBody = z.infer<typeof pushResubscribeBody>;

/** A "wake" push: the frame was too big to travel inside the push, so the service worker fetches it (11.4). */
export const wakePush = z.strictObject({
  t: z.literal("wake"),
  id: ulidString,
  kind: z.string().min(1).max(32),
  from: deviceId,
});
export type WakePush = z.infer<typeof wakePush>;
