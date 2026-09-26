// One-line summaries of messages for the Security Lab's traffic log (frontend J1), shared by the simulated and the
// real Lab. Built on the Lab page from the readable payload, so the relay never has to interpret one.
import type { FamilyAlert, GuardPrompt, RelayEvent, WireAnswer } from "./types";

const inr = (n?: number) =>
  n ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n) : "";

const REASON_EN: Record<string, string> = {
  money: "Money",
  otp: "OTP or code",
  bank_details: "Bank or card details",
  install_app: "Install an app",
  nothing_yet: "Nothing yet",
};

/** The request fields a summary needs (a VerifyRequest, or the wire request inside a readable payload). */
interface RequestLike {
  nonce: string;
  reason?: string;
  amountInr?: number;
}

export function summarize(kind: RelayEvent["kind"], payload: unknown): string {
  if (kind === "request") {
    const r = payload as RequestLike;
    const what = r.reason
      ? `${REASON_EN[r.reason] ?? r.reason}${r.amountInr ? " " + inr(r.amountInr) : ""}`
      : "No reason";
    return `request · ${what} · nonce ${r.nonce.slice(0, 4)}…`;
  }
  if (kind === "answer") {
    const a = payload as WireAnswer;
    return `answer · ${a.decision === "ME" ? "ME" : "NOT ME"} · key ${a.credId.slice(0, 10)}… · nonce ${a.nonce.slice(0, 4)}…`;
  }
  if (kind === "alert") {
    const a = payload as FamilyAlert;
    return `alert · ${a.type === "impersonation" ? "impersonation" : "check on"} · about ${a.aboutLabel}`;
  }
  if (kind === "guard") {
    const g = payload as GuardPrompt;
    return `call guard · claims ${g.claimedLabel}${g.amountInr ? " · " + inr(g.amountInr) : ""}`;
  }
  return kind;
}
