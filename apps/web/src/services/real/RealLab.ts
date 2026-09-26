/*
 * RealLab — TEAM-OWNED. Replaces SimLab when SIMULATION=false (spec Part E).
 *
 * The relay implements hold / modify / inject ONLY IN THE TEST ENVIRONMENT, controlled by the
 * Lab page through the relay's lab channel. Never in production.
 *   - onTraffic: a stream of every message the relay passes (RelayEvent).
 *   - arm(change | replay | forge), disarm, setAttackerMode: sent to the lab channel.
 *   - Verdict reports from phones (RelayService.reportVerdict) feed the result panel and counters.
 *   - Keep the all-time attack log (the Lab page stores it in IndexedDB and exports JSON).
 */
import type { LabService } from "../types";

const todo = (): never => {
  throw new Error("Not implemented: team-owned");
};

export class RealLab implements LabService {
  onTraffic = todo;
  arm = todo;
  disarm = todo;
  setAttackerMode = todo;
  onCounters = todo;
  reset = todo;
  start = todo;
  stop = todo;
  onStatus = todo;
  onPeers = todo;
  setRoles = todo;
  attackLog = todo;
  clearLog = todo;
}
