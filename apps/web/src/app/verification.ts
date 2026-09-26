// The asker's side of a check (Maa's phone): D2 → D3 → E1–E5.
//
// Lives outside the screens so a check keeps running if the person navigates away:
// timers, relay-state watching and answer handling are owned here, and screens simply
// render the OutgoingRecord from the database.
//
// Safety rules enforced here (spec B9):
//   #1 only VerifierService produces VERIFIED (assertMayPersist)
//   #2 a late answer after NO_RESPONSE is ignored (the request is no longer pending)
//   #5 requests expire after 60 s
//   #6 silence, offline and errors fail closed → NO_RESPONSE, never green
import { services } from "@/services";
import { assertMayPersist, failedChecks } from "@/services/verdict";
import { isRelayError } from "@/services/errors";
import type {
  AskReason,
  ConnectionState,
  FamilyAlert,
  FamilyMember,
  NoResponseReason,
  SignedAnswer,
  VerdictResult,
} from "@/services/types";
import { db, type OutgoingRecord } from "@/store/db";
import { getOutgoing, saveOutgoing, updateOutgoing } from "@/store/requests";
import { getMember, listFamily, updateMember } from "@/store/family";
import { getProfile } from "@/store/profile";
import { addHistory } from "@/store/history";
import { setMeta } from "@/store/meta";
import { uid } from "@/lib/uid";
import { useSession } from "./session";

const RELAY_UNREACHABLE_MS = 5000;
const inflight = new Set<string>();
const watchers = new Map<string, () => void>();

function myDeviceId(): string {
  const id = useSession.getState().deviceId;
  if (!id) throw new Error("Device not ready");
  return id;
}

// ─── Starting a check ──────────────────────────────────────────────────────

export async function startCheck(p: {
  member: FamilyMember;
  reason?: AskReason;
  amountInr?: number;
}): Promise<string> {
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

  services.relay.sendRequest(req).catch((err: unknown) => {
    // Fail closed: couldn't send → amber. A short pause keeps the waiting screen legible.
    const reason: NoResponseReason = isRelayError(err, "offline") ? "offline" : "relay_unreachable";
    window.setTimeout(() => void finishNoResponse(req.requestId, reason), 1400);
  });
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
  let expiryTimer = 0;
  let offlineTimer = 0;

  void getOutgoing(requestId).then((rec) => {
    if (!rec?.request || rec.status !== "pending") return stop();
    const left = rec.request.expiresAt - Date.now();
    if (left <= 0) {
      void finishNoResponse(requestId, "timeout");
      return;
    }
    expiryTimer = window.setTimeout(() => void finishNoResponse(requestId, "timeout"), left);
  });

  const onState = (s: ConnectionState) => {
    if (s === "offline") {
      if (!offlineTimer) {
        offlineTimer = window.setTimeout(
          () => void finishNoResponse(requestId, "relay_unreachable"),
          RELAY_UNREACHABLE_MS,
        );
      }
    } else if (offlineTimer) {
      window.clearTimeout(offlineTimer);
      offlineTimer = 0;
    }
  };
  const unsub = services.relay.onState(onState);

  const stop = () => {
    window.clearTimeout(expiryTimer);
    window.clearTimeout(offlineTimer);
    unsub();
    watchers.delete(requestId);
  };
  watchers.set(requestId, stop);
}

function unwatch(requestId: string) {
  watchers.get(requestId)?.();
}

/** On launch: finalize checks that expired while the app was closed; re-watch the rest. */
export async function resumePendingChecks() {
  const pending = await db.outgoing.where("status").equals("pending").toArray();
  for (const rec of pending) {
    if (!rec.request) continue;
    if (rec.request.expiresAt <= Date.now()) await finishNoResponse(rec.requestId, "timeout");
    else watch(rec.requestId);
  }
}

// ─── Finishing ─────────────────────────────────────────────────────────────

async function persistResult(rec: OutgoingRecord, result: VerdictResult) {
  assertMayPersist(result);
  unwatch(rec.requestId);
  await updateOutgoing(rec.requestId, { status: "done", result });
  const memberDeviceId = rec.memberDeviceId;
  await addHistory({
    kind: "checked",
    personLabel: rec.memberLabel,
    verdict: result.verdict,
    invalidReason: result.invalidReason,
    noResponseReason: result.noResponseReason,
    reason: rec.request?.reason,
    amountInr: rec.request?.amountInr,
    at: result.decidedAt,
    checks: result.checks.length ? result.checks : undefined,
    elapsedMs: result.elapsedMs,
    memberDeviceId,
    requestId: rec.requestId,
    askedAt: rec.request?.createdAt,
    answeredAt: result.answeredAt,
  });
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
  services.relay.reportVerdict({ requestId, verdict: "NO_RESPONSE", failedChecks: [] });
}

async function onAnswer(ans: SignedAnswer) {
  if (inflight.has(ans.requestId)) return;
  const rec = await getOutgoing(ans.requestId);
  // Unknown, cancelled, finished or expired requests: the answer is ignored (B9 #2).
  if (!rec?.request || rec.status !== "pending" || !rec.memberId) return;
  const member = await getMember(rec.memberId);
  if (!member) return;
  inflight.add(ans.requestId);
  try {
    const result = await services.verifier.verify(rec.request, ans, member);
    await persistResult(rec, result);
    services.relay.reportVerdict({
      requestId: rec.requestId,
      verdict: result.verdict,
      invalidReason: result.invalidReason,
      failedChecks: failedChecks(result.checks),
    });
    if (result.verdict === "DENIED") void alertFamily(rec.requestId);
  } finally {
    inflight.delete(ans.requestId);
  }
}

export function cancelCheck(requestId: string) {
  unwatch(requestId);
  return (async () => {
    const rec = await getOutgoing(requestId);
    if (!rec || rec.status !== "pending") return;
    await updateOutgoing(requestId, { status: "cancelled" });
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

// ─── Family alerts (G1 after DENIED, G2 from E3) ───────────────────────────

async function otherFamily(excludeDeviceId?: string) {
  const all = await listFamily();
  return all.filter((m) => m.deviceId !== excludeDeviceId);
}

export async function alertFamily(requestId: string) {
  const rec = await getOutgoing(requestId);
  if (!rec?.request || !rec.memberId) return;
  const [profile, member] = await Promise.all([getProfile(), getMember(rec.memberId)]);
  const recipients = await otherFamily(rec.memberDeviceId);
  if (recipients.length === 0) {
    await updateOutgoing(requestId, { alertStatus: "none", alertedLabels: [] });
    return;
  }
  await updateOutgoing(requestId, { alertStatus: "sending" });
  const alert: FamilyAlert = {
    id: uid("alert"),
    type: "impersonation",
    aboutLabel: member?.name.split(" ")[0] ?? rec.memberLabel,
    aboutDeviceId: rec.memberDeviceId,
    victimLabel: profile?.name ?? "",
    victimDeviceId: myDeviceId(),
    createdAt: Date.now(),
    read: false,
  };
  if (profile?.phone) alert.victimPhone = profile.phone;
  if (rec.request.amountInr) alert.amountInr = rec.request.amountInr;
  try {
    await services.relay.sendAlert(
      alert,
      recipients.map((m) => m.deviceId),
    );
    await updateOutgoing(requestId, { alertStatus: "sent", alertedLabels: recipients.map((m) => m.label) });
  } catch {
    await updateOutgoing(requestId, { alertStatus: "failed" });
  }
}

export async function askFamilyToReach(requestId: string): Promise<string[]> {
  const rec = await getOutgoing(requestId);
  if (!rec?.memberId) return [];
  const [profile, member] = await Promise.all([getProfile(), getMember(rec.memberId)]);
  const recipients = await otherFamily(rec.memberDeviceId);
  if (recipients.length === 0) return [];
  const alert: FamilyAlert = {
    id: uid("alert"),
    type: "check_on",
    aboutLabel: member?.name.split(" ")[0] ?? rec.memberLabel,
    aboutDeviceId: rec.memberDeviceId,
    victimLabel: profile?.name ?? "",
    victimDeviceId: myDeviceId(),
    createdAt: Date.now(),
    read: false,
  };
  if (profile?.phone) alert.victimPhone = profile.phone;
  if (member?.phone) alert.aboutPhone = member.phone;
  if (rec.request?.amountInr) alert.amountInr = rec.request.amountInr;
  await services.relay.sendAlert(
    alert,
    recipients.map((m) => m.deviceId),
  );
  const labels = recipients.map((m) => m.label);
  await updateOutgoing(requestId, { checkOnSentTo: labels });
  return labels;
}

// ─── Install once ──────────────────────────────────────────────────────────

let installed = false;
export function installVerificationController() {
  if (installed) return;
  installed = true;
  services.relay.onAnswer((ans) => void onAnswer(ans));
  void resumePendingChecks();
}
