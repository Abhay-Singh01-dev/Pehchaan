// The answerer's side (Arjun's phone): F1 → F2 → F3, plus the F4/F5 states and FC-14, FC-15, FC-27.
//
// Answering always needs an unlock, including for NO, NOT ME (spec B9 #4). Time on this phone is only ever
// measured on this phone's clock: F1's deadline is the relay's `ttlMs` counted from when THIS phone received the
// request, never the asker's `expiresAt` (8.7). The relay decides whether an answer is in time (8.6, 8.8).
import { TIMING } from "@pehchaan/protocol";
import { services } from "@/services";
import { isKeyError, isRelayError } from "@/services/errors";
import type {
  CancelNotice,
  Decision,
  FamilyMember,
  IncomingRequest,
  VerifyRequest,
  WireAnswer,
} from "@/services/types";
import { getIncoming, pendingIncoming, saveIncoming, updateIncoming } from "@/store/requests";
import { getMemberByDeviceId } from "@/store/family";
import { addHistory } from "@/store/history";
import { db, type IncomingRecord } from "@/store/db";

export interface AskerInfo {
  label: string;
  member: FamilyMember | null;
  phone?: string;
}

/** Requests whose answer is being signed or sent right now: the expiry sweep leaves them to the relay. */
const answering = new Set<string>();

/** How this phone knows the asker: its own saved label, or the name they gave. */
export async function resolveAsker(req: VerifyRequest): Promise<AskerInfo> {
  const member = (await getMemberByDeviceId(req.fromDeviceId)) ?? null;
  return {
    label: member?.label ?? req.fromName,
    member,
    phone: member?.phone ?? req.fromPhone,
  };
}

/**
 * Stores a newly arrived request. Returns whether F1 should show it: false for expired or misaddressed ones and
 * for requests already closed. Another open tab of this same phone may have stored it a moment earlier (each
 * tab has its own relay socket); it still opens here while it is pending, and answering in one tab closes the
 * other through the shared database.
 */
export async function receiveRequest(r: IncomingRequest, myDeviceId: string): Promise<boolean> {
  const req = r.req;
  // FC-27: only requests addressed to this device, from the device that actually sent the envelope.
  if (req.toDeviceId !== myDeviceId || req.fromDeviceId !== r.envFrom) return false;
  if (r.ttlMs <= 0) return false;
  const existing = await getIncoming(req.requestId);
  if (existing) return existing.status === "pending" && existing.envFrom === r.envFrom;
  await saveIncoming({
    requestId: req.requestId,
    request: req,
    status: "pending",
    envFrom: r.envFrom,
    senderDevicePub: r.senderDevicePub,
    senderEncPub: r.senderEncPub,
    ttlMs: r.ttlMs,
    receivedAt: r.receivedAt,
    localDeadline: r.receivedAt + r.ttlMs,
    createdAt: r.receivedAt,
  });
  return true;
}

export async function expireIncoming(requestId: string) {
  const rec = await getIncoming(requestId);
  if (rec?.status === "pending") await updateIncoming(requestId, { status: "expired" });
}

/** Marks every pending request whose time is up (on this phone's clock) as expired. */
export async function sweepExpiredIncoming() {
  const now = Date.now();
  const rows = await db.incoming.where("status").equals("pending").toArray();
  await Promise.all(
    rows.filter((r) => r.localDeadline <= now && !answering.has(r.requestId)).map((r) => expireIncoming(r.requestId)),
  );
}

/** FC-15: the asker stopped waiting, the request was answered on another device, or it expired. */
export async function applyCancel(c: CancelNotice) {
  const rec = await getIncoming(c.requestId);
  if (!rec || rec.status !== "pending") return;
  // Notices name the asker (the relay sends them on its behalf); one naming anyone else is noise.
  if (c.from !== rec.envFrom) return;
  await updateIncoming(c.requestId, {
    status: c.reason === "expired" ? "expired" : "cancelled",
    cancelReason: c.reason,
  });
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
  | { kind: "answered_elsewhere" }
  | { kind: "sent" };

/**
 * Signs and sends an answer. The passkey prompt starts synchronously, first thing in the tap (Safari's
 * user-gesture rule, 10.4): pass the record the screen already holds. Reports progress through `onPhase` and
 * resolves when the answer is accepted, the unlock is cancelled, or the relay refuses it. `isAlive` stops
 * retries on unmount.
 */
export function answerRequest(
  rec: IncomingRecord,
  decision: Decision,
  onPhase: (p: AnswerPhase) => void,
  isAlive: () => boolean = () => true,
): Promise<AnswerPhase["kind"]> {
  if (rec.status !== "pending") {
    onPhase({ kind: "expired" });
    return Promise.resolve("expired");
  }
  answering.add(rec.requestId);
  // Nothing is awaited before this call.
  const signing = services.key.signAnswer(rec.request, decision);
  onPhase({ kind: "unlocking" });
  return sendSigned(rec, decision, signing, onPhase, isAlive).finally(() => answering.delete(rec.requestId));
}

async function sendSigned(
  rec: IncomingRecord,
  decision: Decision,
  signing: Promise<WireAnswer>,
  onPhase: (p: AnswerPhase) => void,
  isAlive: () => boolean,
): Promise<AnswerPhase["kind"]> {
  const req = rec.request;
  let answer: WireAnswer;
  try {
    answer = await signing;
  } catch (e) {
    if (isKeyError(e, "no_key")) {
      onPhase({ kind: "no_key" });
      return "no_key";
    }
    // Cancelled or failed unlock: F5 "Not confirmed. Tap to try again."
    onPhase({ kind: "cancelled" });
    return "cancelled";
  }

  // The answer goes back to whoever asked, with the keys that came with the request (6.4: no binding needed).
  const to = { deviceId: rec.envFrom, encPub: rec.senderEncPub, devicePub: rec.senderDevicePub };
  // The relay forwards answers up to 30 s after the deadline (8.8); after that it would refuse them anyway.
  const giveUpAt = rec.localDeadline + TIMING.ANSWER_GRACE_MS;
  let attempt = 1;
  onPhase({ kind: "sending", attempt });
  const offState = services.relay.onState((s) => {
    if (!isAlive()) return;
    onPhase(s === "connected" ? { kind: "sending", attempt } : { kind: "retrying", attempt });
  });
  try {
    while (isAlive()) {
      try {
        await services.relay.sendAnswer(answer, to);
        break;
      } catch (e) {
        // A refusal is final: someone answered first (another device), or the request is over (F4).
        if (isRelayError(e, "rejected") || isRelayError(e, "not_allowed")) {
          const elsewhere = isRelayError(e) && e.reason === "already_answered";
          await updateIncoming(req.requestId, {
            status: elsewhere ? "cancelled" : "expired",
            ...(elsewhere ? { cancelReason: "answered_elsewhere" as const } : {}),
          });
          const kind = elsewhere ? "answered_elsewhere" : "expired";
          onPhase({ kind });
          return kind;
        }
        if (Date.now() >= giveUpAt) {
          await expireIncoming(req.requestId);
          onPhase({ kind: "expired" });
          return "expired";
        }
        attempt++;
        onPhase({ kind: "retrying", attempt });
        await new Promise((r) => setTimeout(r, TIMING.OUTBOX_RETRY_MS));
      }
    }
  } finally {
    offState();
  }
  if (!isAlive()) return "cancelled";

  const words = decision === "ME" ? await services.requests.confirmationWords(answer) : undefined;
  const asker = await resolveAsker(req);
  const now = Date.now();
  await updateIncoming(req.requestId, {
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
    requestId: req.requestId,
    askedAt: rec.receivedAt,
    answeredAt: answer.answeredAt,
  });
  onPhase({ kind: "sent" });
  return "sent";
}

let installed = false;
/** Cancellation notices close F1 wherever the person is (FC-15). */
export function installAnsweringController() {
  if (installed) return;
  installed = true;
  services.relay.onCancel((c) => void applyCancel(c));
}
