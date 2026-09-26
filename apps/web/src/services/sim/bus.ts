// The simulated relay's wire: a BroadcastChannel('pehchaan-sim') shared by every tab of this browser. Two tabs
// act as two phones; a third can be the Security Lab (frontend spec B3, SimRelay).
//
// Routing: a message is posted with hop "deliver" (straight to its recipient), unless the Lab has taken control
// of the relay (attacker mode), in which case phones post hop "up" and only the Lab forwards it as "deliver",
// possibly after tampering with it. Receipts ("ack", "seen", "reject") and cancel notices travel the same way.
import type { AttackKind, InvalidReason, PeerInfo, Verdict } from "../types";

export const CHANNEL_NAME = "pehchaan-sim";

export type MsgKind = "request" | "answer" | "alert" | "guard" | "cancel" | "ack" | "seen" | "reject";

export interface WireMsg {
  t: "msg";
  id: string;
  kind: MsgKind;
  from: string;
  to: string;
  payload: unknown;
  hop: "up" | "deliver";
  at: number;
  /** The sender's device keys (a request carries them, so the answer can go back). */
  sender?: { devicePub: string; encPub: string };
  tampered?: AttackKind;
  /** The Lab created this message itself (a replayed or forged answer). */
  injected?: boolean;
}

export type Wire =
  | { t: "presence"; from: string; name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean; at: number }
  | { t: "bye"; from: string }
  | WireMsg
  | { t: "lab"; attackerMode: boolean; at: number; closing?: boolean }
  | {
      t: "report";
      from: string;
      requestId: string;
      verdict: Verdict;
      invalidReason?: InvalidReason;
      failedChecks: number[];
      at: number;
    };

export interface Bus {
  post(w: Wire): void;
  close(): void;
  readonly supported: boolean;
}

export function openBus(onMessage: (w: Wire) => void): Bus {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => {}, close: () => {}, supported: false };
  }
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e: MessageEvent<Wire>) => {
    if (e.data && typeof e.data === "object" && "t" in e.data) onMessage(e.data);
  };
  let open = true;
  return {
    supported: true,
    post(w) {
      if (!open) return;
      try {
        ch.postMessage(w);
      } catch {
        /* channel closed */
      }
    },
    close() {
      open = false;
      ch.close();
    },
  };
}

/** 250–600 ms of random latency per message (frontend spec B3). */
export const latency = () => 250 + Math.floor(Math.random() * 351);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
