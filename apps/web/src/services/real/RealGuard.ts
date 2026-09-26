/*
 * RealGuard — TEAM-OWNED, optional (spec Part E).
 *
 * A better speech-to-text engine for microphone mode, behind the same GuardService interface.
 * The keyword rules in services/guard/rules.ts stay exactly as they are: feed each final
 * transcript line through analyzeLine() and accumulate() so the Rules drawer stays truthful.
 * Call Guard only suggests a check. It never decides who is calling.
 */
import type { GuardService } from "../types";

const todo = (): never => {
  throw new Error("Not implemented: team-owned");
};

export class RealGuard implements GuardService {
  start = todo;
  stop = todo;
  onTranscript = todo;
  onSignals = todo;
  setNames = todo;
  next = todo;
  onLevel = todo;
  micSupported = todo;
}
