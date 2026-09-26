// Small label helpers shared by screens.
import type { TFunction } from "i18next";
import type { AskReason, Verdict } from "@/services/types";
import { formatINR } from "./format";

export const REASON_KEY: Record<AskReason, string> = {
  money: "reason.money",
  otp: "reason.otp",
  bank_details: "reason.bank",
  install_app: "reason.app",
  nothing_yet: "reason.none",
};

/** "Money ₹50,000", "OTP or code", … */
export function reasonLabel(t: TFunction, reason?: AskReason, amountInr?: number): string {
  if (!reason) return t("reason.none");
  const base = t(REASON_KEY[reason]);
  return reason === "money" && amountInr ? `${base} ${formatINR(amountInr)}` : base;
}

export type VerdictTone = "ok" | "no" | "fake" | "amber" | "wait";

export function verdictTone(v: Verdict): VerdictTone {
  switch (v) {
    case "VERIFIED":
      return "ok";
    case "DENIED":
      return "no";
    case "INVALID":
      return "fake";
    default:
      return "amber";
  }
}
