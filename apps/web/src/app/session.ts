// Session-wide, in-memory app state (not persisted): boot status, connection, presence,
// the reduced-motion decision and the install prompt.
import { create } from "zustand";
import type { ConnectionState, PeerInfo, RelayInfo } from "@/services/types";

interface SessionState {
  ready: boolean;
  deviceId: string | null;
  connection: ConnectionState;
  reachable: string[];
  peers: PeerInfo[];
  reducedMotion: boolean;
  /** Android/Chrome install prompt, captured from `beforeinstallprompt`. */
  installPrompt: BeforeInstallPromptEvent | null;
  /** A new service worker is waiting (B14 update flow). */
  updateReady: boolean;
  /** The relay closed with 4426: this version is too old to connect (FC-23). */
  updateRequired: boolean;
  /** The relay session (environment, push state, Lab opt-in), for Diagnostics and the Lab banner. */
  relayInfo: RelayInfo | null;
  /** Home's staggered entrance plays once per session, not on every tab return. */
  homeIntroPlayed: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const useSession = create<SessionState>(() => ({
  ready: false,
  deviceId: null,
  connection: "reconnecting",
  reachable: [],
  peers: [],
  reducedMotion: false,
  installPrompt: null,
  updateReady: false,
  updateRequired: false,
  relayInfo: null,
  homeIntroPlayed: false,
}));

export const useReduced = () => useSession((s) => s.reducedMotion);
export const useConnection = () => useSession((s) => s.connection);
export const useReachable = () => useSession((s) => s.reachable);
