// Shared verdict helpers for the UI, and THE GREEN GUARD (frontend spec B9 #1: "no green without all 7 checks").
// The 7 checks themselves, the late policy and the reason priority are the security core's
// (@pehchaan/crypto/verifier); services/verifier.ts turns its result into a VerdictResult.
//
// The green guard, enforced twice:
//   1. the verifier only returns VERIFIED when all 7 pass and the decision is ME;
//   2. only results created by finalizeVerdict() may be stored as VERIFIED (assertMayPersist), so no screen
//      or other code path can fabricate a green.
import type { CheckKey, CheckResult, VerdictResult } from "./types";

export const CHECK_ORDER: CheckKey[] = ["fresh", "key", "exact", "address", "unlocked", "signature", "unused"];

/** Why a check failed (mapped to plain language by the UI: checks.fail.*). */
export type CheckFailDetail =
  | "no_pending"
  | "nonce_mismatch"
  | "expired"
  | "late"
  | "unknown_key"
  | "mismatch"
  | "sealed_changed"
  | "wrong_origin"
  | "not_verified"
  | "bad"
  | "used";

export function makeCheck(
  n: CheckResult["n"],
  passed: boolean,
  opts: { detail?: CheckFailDetail; params?: Record<string, string | number>; skipped?: boolean } = {},
): CheckResult {
  const c: CheckResult = { n, key: CHECK_ORDER[n - 1]!, passed };
  if (opts.detail && (!passed || opts.detail === "late")) c.detail = opts.detail;
  if (opts.params) c.params = opts.params;
  if (opts.skipped) c.skipped = true;
  return c;
}

export function failedChecks(checks: CheckResult[]): number[] {
  return checks.filter((c) => !c.passed && !c.skipped).map((c) => c.n);
}

const issued = new WeakSet<VerdictResult>();

/** Only verifiers call this. Marks a result as produced by the 7 checks. */
export function finalizeVerdict(result: VerdictResult): VerdictResult {
  issued.add(result);
  return result;
}

export function isGreenAllowed(result: VerdictResult): boolean {
  return result.checks.length === 7 && result.checks.every((c) => c.passed && !c.skipped);
}

/** Throws if someone tries to store a VERIFIED result that the verifier didn't produce. */
export function assertMayPersist(result: VerdictResult): void {
  if (result.verdict !== "VERIFIED") return;
  if (!issued.has(result) || !isGreenAllowed(result)) {
    throw new Error("Refusing to store a green verdict that did not come from VerifierService");
  }
}
