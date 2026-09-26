/*
 * RealRelay — TEAM-OWNED. Replaces SimRelay when SIMULATION=false (spec Part E).
 *
 * What goes here:
 *   - A WebSocket client to the team's relay server. The relay only passes messages:
 *     it stores no keys and makes no decisions.
 *   - Same events as RelayService: requests, answers, alerts, guard prompts, presence.
 *   - Reconnect with backoff: 1, 2, 4, 8 s, then every 8 s. Emit "reconnecting" while retrying
 *     and "offline" when the browser is offline.
 *   - Presence heartbeat every 2 s; a device is reachable if seen in the last 6 s.
 *   - reportVerdict(): send to the relay's lab channel only in the test environment.
 *
 * Screens never change when this replaces SimRelay.
 */
import type { RelayService } from "../types";

const todo = (): never => {
  throw new Error("Not implemented: team-owned");
};

export class RealRelay implements RelayService {
  connect = todo;
  onState = todo;
  onPresence = todo;
  sendRequest = todo;
  onRequest = todo;
  sendAnswer = todo;
  onAnswer = todo;
  sendAlert = todo;
  onAlert = todo;
  sendGuardPrompt = todo;
  onGuardPrompt = todo;
  announce = todo;
  onPeers = todo;
  getState = todo;
  ping = todo;
  reconnect = todo;
  address = todo;
  lastMessageAt = todo;
  reportVerdict = todo;
}
