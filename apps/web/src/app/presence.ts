// Presence, asked only when a screen needs it (backend spec 12): "if I ask this person now, will it reach them?"
// Asked when the screen opens and again at most every 30 s while it stays visible; never a subscription.
import { useEffect, useState } from "react";
import { TIMING } from "@pehchaan/protocol";
import { services } from "@/services";
import type { PresenceState } from "@/services/types";
import { useConnection } from "./session";

export interface PresencePoller {
  /** Ask now if allowed (the screen opened, or came back into view). */
  poke(): void;
  stop(): void;
}

/** The asking rule on its own, so it can be tested without a screen. */
export function startPresencePoller(o: {
  ids: string[];
  query: (ids: string[]) => Promise<Record<string, PresenceState>>;
  onStates: (s: Record<string, PresenceState> | null) => void;
  isVisible: () => boolean;
  now?: () => number;
}): PresencePoller {
  const now = o.now ?? Date.now;
  let lastAt: number | null = null;
  let live = true;
  const poke = () => {
    // At most every 30 s, and only while someone can see the screen (12).
    if (!live || !o.isVisible() || (lastAt !== null && now() - lastAt < TIMING.PRESENCE_REASK_MS)) return;
    lastAt = now();
    o.query(o.ids).then(
      (s) => live && o.onStates(s),
      () => live && o.onStates(null),
    );
  };
  poke();
  // Checked more often than the limit, so a visible screen is re-asked about every 30 s despite timer drift.
  const timer = setInterval(poke, TIMING.PRESENCE_REASK_MS / 3);
  return {
    poke,
    stop() {
      live = false;
      clearInterval(timer);
    },
  };
}

/** Each device's state, or null until the relay has answered (and while offline: nothing is known then). */
export function usePresence(deviceIds: string[]): Record<string, PresenceState> | null {
  const connection = useConnection();
  const [states, setStates] = useState<Record<string, PresenceState> | null>(null);
  const key = [...deviceIds].sort().join(",");

  useEffect(() => {
    if (!key || connection !== "connected") {
      setStates(null);
      return;
    }
    const poller = startPresencePoller({
      ids: key.split(","),
      query: (ids) => services.relay.queryPresence(ids),
      onStates: setStates,
      isVisible: () => document.visibilityState === "visible",
    });
    const onVisibility = () => poller.poke();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, connection]);

  return states;
}
