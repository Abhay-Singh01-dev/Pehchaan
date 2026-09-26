// Shared verdict logic: turns the 7 check results into a verdict (spec B4, "Mapping the checks
// to a verdict" and "INVALID reasons"). Used by SimVerifier and by the team's RealVerifier,
// so both behave identically.
//
// Safety rule B9 #1 — "No green without all 7 checks" — is enforced twice:
//   1. decideVerdict() only returns VERIFIED when all 7 pass and the decision is ME;
//   2. only results created by finalizeVerdict() may be stored as VERIFIED
//      (assertMayPersist), so no screen or other code path can fabricate a green.
import type { CheckKey, CheckResult, Decision, InvalidReason, Verdict, VerdictResult } from "./types";

export const CHECK_ORDER: CheckKey[] = ["fresh", "key", "exact", "address", "unlocked", "signature", "unused"];

/** Why a check failed (mapped to plain language by the UI). */
export type CheckFailDetail =
  | "no_pending"
  | "nonce_mismatch"
  | "expired"
  | "unknown_key"
  | "mismatch"
  | "wrong_origin"
  | "not_verified"
  | "bad"
  | "used";

export function makeCheck(
  n: CheckResult["n"],
  passed: boolean,
  opts: { detail?: CheckFailDetail; params?: Record<string, string | number> } = {},
): CheckResult {
  const c: CheckResult = { n, key: CHECK_ORDER[n - 1]!, passed };
  if (!passed && opts.detail) c.detail = opts.detail;
  if (opts.params) c.params = opts.params;
  return c;
}

export function failedChecks(checks: CheckResult[]): number[] {
  return checks.filter((c) => !c.passed).map((c) => c.n);
}

/**
 * Picks the INVALID reason when checks fail. When several fail, the most specific cause wins:
 * a foreign key (forgery) first, then reuse/expiry, then a changed answer, and so on.
 */
export function invalidReasonFor(checks: CheckResult[], expired: boolean): InvalidReason {
  const failed = (n: number) => checks.find((c) => c.n === n)?.passed === false;
  if (failed(2)) return "wrong_key";
  if (failed(1) || failed(7)) return expired ? "expired" : "reused";
  if (failed(3)) return "changed";
  if (failed(4)) return "wrong_app";
  if (failed(5)) return "not_unlocked";
  return "bad_signature";
}

export function decideVerdict(
  checks: CheckResult[],
  decision: Decision,
  expired: boolean,
): { verdict: Verdict; invalidReason?: InvalidReason } {
  const allPassed = checks.length === 7 && checks.every((c) => c.passed);
  if (!allPassed) return { verdict: "INVALID", invalidReason: invalidReasonFor(checks, expired) };
  return { verdict: decision === "ME" ? "VERIFIED" : "DENIED" };
}

// ─── The green guard ────────────────────────────────────────────────────────────

const issued = new WeakSet<VerdictResult>();

/** Only verifiers call this. Marks a result as produced by the 7 checks. */
export function finalizeVerdict(result: VerdictResult): VerdictResult {
  issued.add(result);
  return result;
}

export function isGreenAllowed(result: VerdictResult): boolean {
  return result.checks.length === 7 && result.checks.every((c) => c.passed);
}

/** Throws if someone tries to store a VERIFIED result that the verifier didn't produce. */
export function assertMayPersist(result: VerdictResult): void {
  if (result.verdict !== "VERIFIED") return;
  if (!issued.has(result) || !isGreenAllowed(result)) {
    throw new Error("Refusing to store a green verdict that did not come from VerifierService");
  }
}
