// The push interface the router uses (spec 8.3, 11). The real Web Push sender implements it (push/sender.ts);
// until a device has a subscription, every push is simply `queued`: the envelope waits in the inbox.
import type { StoredFrame } from "../core/inbox";

export type PushOutcome = "pushed" | "queued" | "failed";
export type PushStatus = "ok" | "missing" | "expired";

export interface Push {
  /** Wakes the device through its push subscriptions. `queued` = no subscription (the inbox keeps it). */
  send(to: string, stored: StoredFrame): Promise<PushOutcome>;
  /** Diagnostics "Send test alert" (11.8): a test notification to the device itself. */
  sendTest(to: string): Promise<PushOutcome>;
  close(): Promise<void>;
}

/** A relay without Web Push configured: nothing to send through. */
export const noPush: Push = {
  send: async () => "queued",
  sendTest: async () => "queued",
  close: async () => {},
};
