// The answerer's side (Arjun's phone): F1 → F2 → F3, plus the F4/F5 states.
//
// Answering always needs an unlock, including for NO, NOT ME (spec B9 #4). If sending fails,
// it retries automatically until the request expires (F1 "Offline while answering").
import { services } from "@/services";
import { isKeyError } from "@/services/errors";
import type { Decision, FamilyMember, VerifyRequest } from "@/services/types";
import { getIncoming, pendingIncoming, saveIncoming, updateIncoming } from "@/store/requests";
import { getMemberByDeviceId } from "@/store/family";
import { addHistory } from "@/store/history";
import { db } from "@/store/db";

export interface AskerInfo {
  label: string;
  member: FamilyMember | null;
  phone?: string;
}

/** How this phone knows the asker: its own saved label, or the name they gave. */
export async function resolveAsker(req: VerifyRequest): Promise<AskerInfo> {
  const member = (await getMemberByDeviceId(req.fromDeviceId)) ?? null;
  return {
    label: member?.label ?? req.fromName,
    member,
    phone: member?.phone ?? req.fromPhone,
  };
}

/** Stores a newly arrived request. Returns false for duplicates, expired or misaddressed ones. */
export async function receiveRequest(req: VerifyRequest, myDeviceId: string): Promise<boolean> {
  if (req.toDeviceId !== myDeviceId) return false;
  if (req.expiresAt <= Date.now()) return false;
  if (await getIncoming(req.requestId)) return false;
  await saveIncoming({ requestId: req.requestId, request: req, status: "pending", createdAt: Date.now() });
  return true;
}

export async function expireIncoming(requestId: string) {
  const rec = await getIncoming(requestId);
  if (rec?.status === "pending") await updateIncoming(requestId, { status: "expired" });
}

/** Marks every pending request whose time is up as expired. */
export async function sweepExpiredIncoming() {
  const now = Date.now();
  const rows = await db.incoming.where("status").equals("pending").toArray();
  await Promise.all(rows.filter((r) => r.request.expiresAt <= now).map((r) => expireIncoming(r.requestId)));
}

export async function nextPendingRequestId(excluding?: string): Promise<string | null> {
  const rows = await pendingIncoming();
  return rows.find((r) => r.requestId !== excluding)?.requestId ?? null;
}

export type AnswerPhase =
  | { kind: "unlocking" }
  | { kind: "sending"; attempt: number }
  | { kind: "retrying"; attempt: number }
  | { kind: "cancelled" }
  | { kind: "no_key" }
  | { kind: "expired" }
  | { kind: "sent" };

/**
 * Signs and sends an answer. Reports progress through `onPhase`. Resolves when the answer is
 * sent, the unlock is cancelled, or the request expires. `isAlive` stops retries on unmount.
 */
export async function answerRequest(
  requestId: string,
  decision: Decision,
  onPhase: (p: AnswerPhase) => void,
  isAlive: () => boolean = () => true,
): Promise<AnswerPhase["kind"]> {
  const rec = await getIncoming(requestId);
  if (!rec || rec.status !== "pending") {
    onPhase({ kind: "expired" });
    return "expired";
  }
  const req = rec.request;

  onPhase({ kind: "unlocking" });
  let answer;
  try {
    answer = await services.key.signAnswer(req, decision);
  } catch (e) {
    if (isKeyError(e, "no_key")) {
      onPhase({ kind: "no_key" });
      return "no_key";
    }
    // Cancelled or failed unlock: F5 "Not confirmed. Tap to try again."
    onPhase({ kind: "cancelled" });
    return "cancelled";
  }

  let attempt = 0;
  while (isAlive()) {
    if (Date.now() >= req.expiresAt) {
      await expireIncoming(requestId);
      onPhase({ kind: "expired" });
      return "expired";
    }
    attempt++;
    onPhase({ kind: attempt === 1 ? "sending" : "retrying", attempt });
    try {
      await services.relay.sendAnswer(answer, req.fromDeviceId);
      break;
    } catch {
      onPhase({ kind: "retrying", attempt });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!isAlive()) return "cancelled";

  const words = decision === "ME" ? await services.requests.confirmationWords(answer) : undefined;
  const asker = await resolveAsker(req);
  const now = Date.now();
  await updateIncoming(requestId, {
    status: "answered",
    decision,
    answer,
    words,
    answeredAt: now,
  });
  await addHistory({
    kind: "answered",
    personLabel: asker.label,
    decision,
    reason: req.reason,
    amountInr: req.amountInr,
    at: now,
    memberDeviceId: req.fromDeviceId,
    requestId,
    askedAt: req.createdAt,
    answeredAt: answer.answeredAt,
  });
  onPhase({ kind: "sent" });
  return "sent";
}
