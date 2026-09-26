// The asker's side of a check (Maa's phone): D2 → D3 → E1–E5.
//
// Lives outside the screens so a check keeps running if the person navigates away:
// timers, relay-state watching and answer handling are owned here, and screens simply
// render the OutgoingRecord from the database.
//
// Safety rules enforced here (frontend spec B9, backend spec 10.5–10.9, 13.1, FC-12, FC-13, FC-16):
//   #1 only VerifierService produces VERIFIED (assertMayPersist)
//   #2 an answer is verified only while its request is waiting, or within the 30 s late window after a
//      timeout, and then only the first one; anything after "Not confirmed yet" never turns green (10.7)
//   #5 requests expire after 60 s (on THIS phone's clock, against the expiresAt it set itself)
//   #6 silence, offline, refusal and errors fail closed → NO_RESPONSE, never green
//   the used-nonce store gets the nonce right after a verdict or a cancel, but after a timeout only when the
//   late window closes, so a genuine late answer isn't misreported as `reused` (10.9)
import { TIMING } from "@pehchaan/protocol";
import { services } from "@/services";
import { assertMayPersist, failedChecks } from "@/services/verdict";
import { isRelayError } from "@/services/errors";
import type {
  AskReason,
  ConnectionState,
  FamilyAlert,
  FamilyMember,
  IncomingAnswer,
  NoResponseReason,
  Receipt,
  RecipientCard,
  VerdictResult,
} from "@/services/types";
import { db, type AlertDelivery, type OutgoingRecord } from "@/store/db";
import { getOutgoing, saveOutgoing, updateOutgoing } from "@/store/requests";
import { getMember, getMemberByDeviceId, listFamily, updateMember } from "@/store/family";
import { getProfile } from "@/store/profile";
import { addHistory } from "@/store/history";
import { setMeta } from "@/store/meta";
import { uid } from "@/lib/uid";
import { useSession } from "./session";

const RELAY_UNREACHABLE_MS = 5000;
const LATE_WINDOW_MS = TIMING.ANSWER_GRACE_MS;
const inflight = new Set<string>();
const watchers = new Map<string, () => void>();
const nonceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function myDeviceId(): string {
  const id = useSession.getState().deviceId;
  if (!id) throw new Error("Device not ready");
  return id;
}

/** What a sender needs from a saved card to reach that person. */
export const recipientOf = (m: FamilyMember): RecipientCard => ({
  deviceId: m.deviceId,
  grant: m.grant,
  encPub: m.encPub,
  devicePub: m.devicePub,
});

// ─── Starting a check ──────────────────────────────────────────────────────

export async function startCheck(p: { member: FamilyMember; reason?: AskReason; amountInr?: number }): Promise<string> {
  const profile = await getProfile();
  const req = services.requests.create({
    from: { deviceId: myDeviceId(), name: profile?.name ?? "Pehchaan", phone: profile?.phone },
    member: p.member,
    reason: p.reason,
    amountInr: p.amountInr,
  });
  await saveOutgoing({
    requestId: req.requestId,
    request: req,
    memberId: p.member.id,
    memberDeviceId: p.member.deviceId,
    memberLabel: p.member.label,
    status: "pending",
    createdAt: req.createdAt,
  });
  await updateMember(p.member.id, { lastCheckedAt: req.createdAt });
  watch(req.requestId);

  services.relay.sendRequest(req, recipientOf(p.member)).then(
    () => void advanceDelivery(req.requestId, "sent"),
    (err: unknown) => {
      // Fail closed. The person isn't accepting checks from me (FC-13): say so at once. Couldn't send: amber
      // after a short pause that keeps the waiting screen legible.
      if (isRelayError(err, "not_allowed")) return void finishNoResponse(req.requestId, "not_allowed");
      const reason: NoResponseReason = isRelayError(err, "offline") ? "offline" : "relay_unreachable";
      setTimeout(() => void finishNoResponse(req.requestId, reason), 1400);
    },
  );
  return req.requestId;
}

/** "Someone else": no network call, straight to Can't verify (E5). */
export async function recordUnknownPerson(): Promise<string> {
  const requestId = services.requests.randomId("unk");
  const now = Date.now();
  const result: VerdictResult = {
    requestId,
    verdict: "UNKNOWN_PERSON",
    checks: [],
    memberLabel: "",
    decidedAt: now,
  };
  await saveOutgoing({ requestId, memberLabel: "", status: "done", result, createdAt: now });
  await addHistory({ kind: "checked", personLabel: "", verdict: "UNKNOWN_PERSON", at: now, requestId });
  await setMeta("lastVerdictRequestId", requestId);
  return requestId;
}

// ─── Watching a pending check ──────────────────────────────────────────────

/** Arms the 60 s timeout and the relay-unreachable watch for a pending request. Idempotent. */
export function watch(requestId: string) {
  if (watchers.has(requestId)) return;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;

  void getOutgoing(requestId).then((rec) => {
    if (!rec?.request || rec.status !== "pending") return stop();
    const left = rec.request.expiresAt - Date.now();
    if (left <= 0) {
      void finishNoResponse(requestId, "timeout");
      return;
    }
    expiryTimer = setTimeout(() => void finishNoResponse(requestId, "timeout"), left);
  });

  const onState = (s: ConnectionState) => {
    if (s === "offline") {
      if (!offlineTimer) {
        offlineTimer = setTimeout(() => void finishNoResponse(requestId, "relay_unreachable"), RELAY_UNREACHABLE_MS);
      }
    } else if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = undefined;
    }
  };
  const unsub = services.relay.onState(onState);

  const stop = () => {
    clearTimeout(expiryTimer);
    clearTimeout(offlineTimer);
    unsub();
    watchers.delete(requestId);
  };
  watchers.set(requestId, stop);
}

function unwatch(requestId: string) {
  watchers.get(requestId)?.();
}

/** On launch: finalize checks that expired while the app was closed; re-watch the rest; settle nonces. */
export async function resumePendingChecks() {
  const pending = await db.outgoing.where("status").equals("pending").toArray();
  for (const rec of pending) {
    if (!rec.request) continue;
    if (rec.request.expiresAt <= Date.now()) await finishNoResponse(rec.requestId, "timeout");
    else watch(rec.requestId);
  }
  // Timed-out checks whose late window was still open when the app closed.
  const done = await db.outgoing.where("status").anyOf("done", "cancelled").toArray();
  for (const rec of done) if (rec.request && !rec.nonceMarked) scheduleNonceMark(rec);
}

// ─── Delivery status (FC-12) ───────────────────────────────────────────────

type Delivery = NonNullable<OutgoingRecord["delivery"]>;
const DELIVERY_RANK: Record<Delivery, number> = { sent: 0, queued: 1, pushed: 1, delivered: 2, seen: 3 };

/** D3's status line only moves forward: Sent → Delivered → Seen. Read and write in one transaction, so two
 *  receipts arriving together can't undo each other. */
async function advanceDelivery(requestId: string, next: Delivery) {
  await db.transaction("rw", db.outgoing, async () => {
    const rec = await db.outgoing.get(requestId);
    if (!rec || rec.status !== "pending") return;
    if (rec.delivery && DELIVERY_RANK[rec.delivery] >= DELIVERY_RANK[next]) return;
    await db.outgoing.update(requestId, { delivery: next });
  });
}

/** Alert message ids → the check they belong to (receipts update "Family alerted: …", 13.1). */
const alertMsgs = new Map<string, { requestId: string; field: "alerts" | "checkOnAlerts" }>();

/** Receipts for message ids not known yet: a fast relay can confirm the first recipient's alert while the next
 *  recipient's envelope is still being sealed. Applied as soon as the ids are recorded; kept one minute. */
const earlyReceipts = new Map<string, { state: AlertDelivery["state"]; at: number }>();
const EARLY_RECEIPT_KEEP_MS = 60_000;

async function applyAlertReceipt(msgId: string, state: AlertDelivery["state"]) {
  const alert = alertMsgs.get(msgId);
  if (!alert) return;
  // One transaction per receipt: receipts for different recipients of the same alert never overwrite each other.
  await db.transaction("rw", db.outgoing, async () => {
    const list = (await db.outgoing.get(alert.requestId))?.[alert.field];
    if (!list) return;
    const next = list.map((a) => (a.msgId === msgId ? { ...a, state: mergeAlertState(a.state, state) } : a));
    await db.outgoing.update(alert.requestId, alert.field === "alerts" ? { alerts: next } : { checkOnAlerts: next });
  });
}

async function onReceipt(r: Receipt) {
  if (alertMsgs.has(r.of)) return applyAlertReceipt(r.of, r.state);
  // A request's message id is its request id (D-009).
  if (r.state === "delivered" || r.state === "seen" || r.state === "pushed" || r.state === "queued") {
    await advanceDelivery(r.of, r.state);
  }
  const now = Date.now();
  for (const [id, e] of earlyReceipts) if (now - e.at > EARLY_RECEIPT_KEEP_MS) earlyReceipts.delete(id);
  const prev = earlyReceipts.get(r.of);
  earlyReceipts.set(r.of, { state: prev ? mergeAlertState(prev.state, r.state) : r.state, at: now });
}

/** Applies receipts that arrived before these alert message ids were recorded. */
async function applyEarlyReceipts(alerts: AlertDelivery[]) {
  for (const a of alerts) {
    const early = earlyReceipts.get(a.msgId);
    if (!early) continue;
    earlyReceipts.delete(a.msgId);
    await applyAlertReceipt(a.msgId, early.state);
  }
}

const ALERT_RANK: Record<AlertDelivery["state"], number> = {
  sending: 0,
  accepted: 1,
  queued: 2,
  failed: 2,
  rejected: 3,
  pushed: 4,
  delivered: 5,
  seen: 5,
};

function mergeAlertState(prev: AlertDelivery["state"], next: AlertDelivery["state"]): AlertDelivery["state"] {
  return ALERT_RANK[next] >= ALERT_RANK[prev] ? next : prev;
}

// ─── Used nonces (10.9) ────────────────────────────────────────────────────

/** At start: the used-nonce store keeps 30 days. */
export async function pruneUsedNonces(now = Date.now()): Promise<number> {
  return db.usedNonces
    .where("usedAt")
    .below(now - TIMING.USED_NONCE_KEEP_MS)
    .delete();
}

async function markNonce(requestId: string) {
  const t = nonceTimers.get(requestId);
  if (t) clearTimeout(t);
  nonceTimers.delete(requestId);
  const rec = await getOutgoing(requestId);
  if (!rec?.request || rec.nonceMarked) return;
  await db.usedNonces.put({ nonce: rec.request.nonce, requestId, usedAt: Date.now() });
  await updateOutgoing(requestId, { nonceMarked: true });
}

/** After a timeout the nonce waits for the late window to close (or for the late answer, if first). */
function scheduleNonceMark(rec: OutgoingRecord) {
  if (!rec.request || nonceTimers.has(rec.requestId)) return;
  const timedOut = rec.result?.verdict === "NO_RESPONSE" && rec.result.noResponseReason === "timeout";
  const wait = timedOut && !rec.lateHandled ? rec.request.expiresAt + LATE_WINDOW_MS - Date.now() : 0;
  if (wait <= 0) return void markNonce(rec.requestId);
  nonceTimers.set(
    rec.requestId,
    setTimeout(() => void markNonce(rec.requestId), wait),
  );
}

// ─── Finishing ─────────────────────────────────────────────────────────────

async function recordHistory(rec: OutgoingRecord, result: VerdictResult) {
  // A late answer replaces the "Not confirmed yet" entry for the same request instead of adding a second one.
  const existing = await db.history.where("requestId").equals(rec.requestId).first();
  await addHistory({
    ...(existing ? { id: existing.id } : {}),
    kind: "checked",
    personLabel: rec.memberLabel,
    verdict: result.verdict,
    invalidReason: result.invalidReason,
    noResponseReason: result.noResponseReason,
    late: result.late,
    reason: rec.request?.reason,
    amountInr: rec.request?.amountInr,
    at: result.decidedAt,
    checks: result.checks.length ? result.checks : undefined,
    elapsedMs: result.elapsedMs,
    memberDeviceId: rec.memberDeviceId,
    requestId: rec.requestId,
    askedAt: rec.request?.createdAt,
    answeredAt: result.answeredAt,
  });
}

async function persistResult(rec: OutgoingRecord, result: VerdictResult, patch: Partial<OutgoingRecord> = {}) {
  assertMayPersist(result);
  unwatch(rec.requestId);
  await updateOutgoing(rec.requestId, { status: "done", result, ...patch });
  await recordHistory(rec, result);
  await setMeta("lastVerdictRequestId", rec.requestId);
}

export async function finishNoResponse(requestId: string, reason: NoResponseReason) {
  if (inflight.has(requestId)) return;
  const rec = await getOutgoing(requestId);
  if (!rec || rec.status !== "pending") return;
  const result: VerdictResult = {
    requestId,
    verdict: "NO_RESPONSE",
    noResponseReason: reason,
    checks: [],
    memberId: rec.memberId,
    memberLabel: rec.memberLabel,
    decidedAt: Date.now(),
  };
  if (rec.request?.reason) result.reason = rec.request.reason;
  if (rec.request?.amountInr) result.amountInr = rec.request.amountInr;
  await persistResult(rec, result);
  // A request that never got an `accepted` may still be waiting in the outbox: stop it reaching them now.
  if (reason === "offline" || reason === "relay_unreachable") void services.relay.cancelRequest(requestId);
  scheduleNonceMark({ ...rec, status: "done", result });
  services.relay.reportVerdict({ requestId, verdict: "NO_RESPONSE", failedChecks: [] });
}

/** May this answer be verified now? Only while waiting, or once within the 30 s after a timeout (10.5). */
function acceptsAnswer(rec: OutgoingRecord, now: number): "waiting" | "late" | null {
  if (!rec.request || !rec.memberId) return null;
  if (rec.status === "pending") return "waiting";
  const timedOut =
    rec.status === "done" && rec.result?.verdict === "NO_RESPONSE" && rec.result.noResponseReason === "timeout";
  if (timedOut && !rec.lateHandled && now <= rec.request.expiresAt + LATE_WINDOW_MS) return "late";
  return null;
}

async function onAnswer(incoming: IncomingAnswer) {
  const requestId = incoming.re;
  if (!requestId || inflight.has(requestId)) return;
  inflight.add(requestId);
  try {
    const rec = await getOutgoing(requestId);
    const when = rec ? acceptsAnswer(rec, incoming.receivedAt) : null;
    // Unknown, cancelled or finished requests: the answer is ignored (B9 #2).
    if (!rec?.request || !when) return;
    // The saved card of the person the request was SENT to, never the envelope's sender (10.5).
    const member = await getMemberByDeviceId(rec.request.toDeviceId);
    if (!member) return; // removed meanwhile: nothing to verify against, so the check stays unconfirmed

    let result = await services.verifier.verify({ req: rec.request, incoming, member });
    // "Not confirmed yet" is already on screen: nothing turns it green (10.7).
    if (when === "late" && result.verdict === "VERIFIED") {
      result = { ...result, verdict: "NO_RESPONSE", noResponseReason: "late" };
      delete result.confirmationWords;
    }
    // The nonce is spent BEFORE the verdict is saved: a verdict on screen always means its nonce is used (10.9).
    await markNonce(requestId);
    await persistResult(rec, result, when === "late" ? { lateHandled: true } : {});
    services.relay.reportVerdict({
      requestId: rec.requestId,
      verdict: result.verdict,
      invalidReason: result.invalidReason,
      failedChecks: failedChecks(result.checks),
    });
    if (result.verdict === "DENIED") void alertFamily(rec.requestId);
  } finally {
    inflight.delete(requestId);
  }
  // The 60 s timer may have fired while this answer was being checked (and was skipped): if the request is
  // still waiting and its time is up, finish it now.
  const after = await getOutgoing(requestId);
  if (after?.status === "pending" && after.request && after.request.expiresAt <= Date.now()) {
    await finishNoResponse(requestId, "timeout");
  }
}

export function cancelCheck(requestId: string) {
  unwatch(requestId);
  return (async () => {
    const rec = await getOutgoing(requestId);
    if (!rec || rec.status !== "pending") return;
    await updateOutgoing(requestId, { status: "cancelled" });
    await markNonce(requestId);
    void services.relay.cancelRequest(requestId);
    await addHistory({
      kind: "checked",
      personLabel: rec.memberLabel,
      cancelled: true,
      reason: rec.request?.reason,
      amountInr: rec.request?.amountInr,
      at: Date.now(),
      memberDeviceId: rec.memberDeviceId,
      requestId,
      askedAt: rec.request?.createdAt,
    });
  })();
}

/** "Check again" / "Ask again": a new request with the same person and details. */
export async function checkAgain(requestId: string): Promise<string | null> {
  const rec = await getOutgoing(requestId);
  if (!rec?.memberId) return null;
  const member = await getMember(rec.memberId);
  if (!member) return null;
  return startCheck({ member, reason: rec.request?.reason, amountInr: rec.request?.amountInr });
}

// ─── Family alerts (G1 after DENIED, G2 from E3; 13.1) ─────────────────────

/** Every family member except the person the check was about. */
async function otherFamily(excludeDeviceId?: string) {
  const all = await listFamily();
  return all.filter((m) => m.deviceId !== excludeDeviceId);
}

async function sendFamilyAlert(
  rec: OutgoingRecord,
  type: FamilyAlert["type"],
  recipients: FamilyMember[],
): Promise<AlertDelivery[]> {
  const [profile, member] = await Promise.all([getProfile(), rec.memberId ? getMember(rec.memberId) : undefined]);
  const alert: FamilyAlert = {
    id: uid("alert"),
    type,
    aboutLabel: member?.name.split(" ")[0] ?? rec.memberLabel,
    victimName: profile?.name ?? "",
    createdAt: Date.now(),
    read: false,
  };
  if (rec.memberDeviceId) alert.aboutDeviceId = rec.memberDeviceId;
  if (profile?.phone) alert.victimPhone = profile.phone;
  if (rec.request?.amountInr) alert.amountInr = rec.request.amountInr;
  // One sealed envelope per recipient; each one's receipts drive its row (13.1).
  const sent = await services.relay.sendAlert(alert, recipients.map(recipientOf));
  const field = type === "impersonation" ? "alerts" : "checkOnAlerts";
  return sent.map(({ deviceId, msgId }) => {
    alertMsgs.set(msgId, { requestId: rec.requestId, field });
    const label = recipients.find((m) => m.deviceId === deviceId)?.label ?? "";
    return { deviceId, label, msgId, state: "sending" as const };
  });
}

export async function alertFamily(requestId: string) {
  const rec = await getOutgoing(requestId);
  if (!rec?.request || !rec.memberId || rec.alerts) return;
  const recipients = await otherFamily(rec.memberDeviceId);
  if (recipients.length === 0) {
    await updateOutgoing(requestId, { alertStatus: "none", alerts: [] });
    return;
  }
  await updateOutgoing(requestId, { alertStatus: "sending" });
  try {
    const alerts = await sendFamilyAlert(rec, "impersonation", recipients);
    await updateOutgoing(requestId, { alertStatus: "sent", alerts });
    await applyEarlyReceipts(alerts);
  } catch {
    await updateOutgoing(requestId, { alertStatus: "failed" });
  }
}

export async function askFamilyToReach(requestId: string): Promise<string[]> {
  const rec = await getOutgoing(requestId);
  if (!rec?.memberId) return [];
  const recipients = await otherFamily(rec.memberDeviceId);
  if (recipients.length === 0) return [];
  const checkOnAlerts = await sendFamilyAlert(rec, "check_on", recipients);
  await updateOutgoing(requestId, { checkOnAlerts });
  await applyEarlyReceipts(checkOnAlerts);
  return checkOnAlerts.map((a) => a.label);
}

// ─── Install once ──────────────────────────────────────────────────────────

let installed = false;
export function installVerificationController() {
  if (installed) return;
  installed = true;
  services.relay.onAnswer((a) => void onAnswer(a));
  services.relay.onReceipt((r) => void onReceipt(r));
  void resumePendingChecks();
}
