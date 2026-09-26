// `send`: one envelope from this device to one device (spec 7.4, 8.1–8.6, 16.3).
//
//   dedupe → rate limits → plain allowed? → authorise by kind → build the deliver frame (same id)
//   → (Security Lab interception, test environment only) → inbox + route → receipts to the sender
//
// The relay never looks inside `e2e`, and never judges an answer: it only enforces who may send what to
// whom, and when.
import { TIMING, ulid, type ClientFrame, type RelayBody } from "@pehchaan/protocol";
import type { Hub } from "../../hub";
import { mayAlertOrPrompt, mayAnswer, mayRequest, plainAllowed } from "../../core/authz";
import type { StoredFrame } from "../../core/inbox";
import { deadlineFor } from "../../core/requests";
import { RETRYABLE, refuse, toRefusal } from "../../core/refusal";
import type { Connection } from "../connection";

type SendFrame = Extract<ClientFrame, { t: "send" }>;

/** How long each kind waits in the inbox (8.3). */
export const INBOX_TTL = {
  alert: TIMING.INBOX_TTL_ALERT_MS,
  "guard.prompt": TIMING.INBOX_TTL_PROMPT_MS,
} as const;

export async function handleSend(hub: Hub, conn: Connection, f: SendFrame): Promise<void> {
  const me = conn.deviceId!;
  const b = f.body;
  // Idempotency first: a re-send with the same id gets the original outcome and is never routed twice.
  const claim = await hub.dedupe.claim(me, f.id);
  if (!claim.first) {
    if (claim.outcome?.receipt) conn.send("receipt", claim.outcome.receipt);
    if (claim.outcome?.error) conn.send("error", claim.outcome.error);
    return;
  }
  try {
    await accept(hub, conn, f);
  } catch (e) {
    const r = toRefusal(e);
    if (RETRYABLE.has(r.code)) {
      // Rate-limited or unavailable: the app may try again with the same id.
      await hub.dedupe.release(me, f.id).catch(() => {});
      throw r;
    }
    const error: RelayBody<"error"> = { code: r.code, of: f.id };
    const receipt: RelayBody<"receipt"> = {
      of: f.id,
      to: b.to,
      ...(b.re ? { re: b.re } : {}),
      state: "rejected",
      reason: r.code,
    };
    await hub.dedupe.record(me, f.id, { receipt, error }).catch(() => {});
    hub.metrics.receipts.inc({ state: "rejected" });
    conn.send("receipt", receipt);
    throw r;
  }
}

async function accept(hub: Hub, conn: Connection, f: SendFrame): Promise<void> {
  const me = conn.deviceId!;
  const b = f.body;
  const now = Date.now();

  // Rate limits (16.1).
  if (b.kind === "verify.request") {
    await hub.limiter.take("request_device_min", me);
    await hub.limiter.take("request_device_hour", me);
    await hub.limiter.take("request_pair", `${me}>${b.to}`);
  } else if (b.kind === "verify.answer") {
    await hub.limiter.take("answer_device", me);
  } else if (b.kind === "alert") {
    await hub.limiter.take("alert_device", me);
  } else {
    await hub.limiter.take("prompt_device", me);
  }

  // Readable envelopes only where allowed (9.5).
  if (b.plain !== undefined && !(await plainAllowed(hub, me, b.to))) refuse("e2e_required");

  // Authorise by kind (16.3) and work out how long the envelope may wait.
  let expiresAt: number;
  let late = false;
  let otherTargets: string[] = [];
  if (b.kind === "verify.request") {
    await mayRequest(hub, me, b);
    const deadline = deadlineFor(now, b.ttlMs);
    await hub.requests.create(b.re!, me, [b.to], deadline, now);
    expiresAt = deadline;
  } else if (b.kind === "verify.answer") {
    // For answers the sender's ttlMs is ignored: the request record's deadline and grace apply.
    const a = await mayAnswer(hub, me, b, now);
    late = a.late;
    expiresAt = a.deadline + TIMING.ANSWER_GRACE_MS;
    otherTargets = a.to.filter((t) => t !== me);
    hub.metrics.requests.inc({ outcome: late ? "answered_late" : "answered" });
  } else {
    await mayAlertOrPrompt(hub, me, b);
    expiresAt = now + INBOX_TTL[b.kind];
  }

  const stored: StoredFrame = {
    frame: {
      v: 1,
      t: "deliver",
      id: f.id, // the sender's id is kept, so an E2E header rebuilds identically on the other side (9.2)
      sts: now,
      body: {
        from: me,
        kind: b.kind,
        ...(b.re ? { re: b.re } : {}),
        ttlMs: expiresAt - now,
        ...(late ? { late: true } : {}),
        ...(b.e2e ? { e2e: b.e2e } : { plain: b.plain!, psig: b.psig! }),
      },
    },
    expiresAt,
  };

  // The Security Lab may hold this envelope, only when both ends are opted in (14.1).
  if (hub.lab && (await hub.lab.intercept(stored, b.to))) {
    await sendAccepted(hub, conn, f);
    return;
  }

  const outcome = await hub.router.route(b.to, stored, { inbox: true, push: true });
  if (outcome === "full") {
    // An inbox with 50 undelivered envelopes: someone is flooding the target. `queued` becomes `failed` (8.5).
    await hub.audit.record("rate_limited_burst", b.to, { reason: "inbox_full" });
    const receipt: RelayBody<"receipt"> = {
      of: f.id,
      to: b.to,
      ...(b.re ? { re: b.re } : {}),
      state: "failed",
      reason: "inbox_full",
    };
    await hub.dedupe.record(me, f.id, { receipt });
    hub.metrics.receipts.inc({ state: "failed" });
    conn.send("receipt", receipt);
    return;
  }
  await sendAccepted(hub, conn, f);
  if (outcome !== "routed") receiptToSender(hub, conn, f, outcome);

  // Multi-device (8.6, 8.11): the other targets stop showing the request.
  // The notice is about the ASKER's request (b.to), so it names the asker as its sender.
  for (const t of otherTargets) await sendCancel(hub, b.to, b.re!, t, "answered_elsewhere");
}

async function sendAccepted(hub: Hub, conn: Connection, f: SendFrame): Promise<void> {
  const receipt: RelayBody<"receipt"> = { of: f.id, ...(f.body.re ? { re: f.body.re } : {}), state: "accepted" };
  await hub.dedupe.record(conn.deviceId!, f.id, { receipt });
  hub.metrics.receipts.inc({ state: "accepted" });
  conn.send("receipt", receipt);
}

function receiptToSender(hub: Hub, conn: Connection, f: SendFrame, state: "pushed" | "queued" | "failed"): void {
  hub.metrics.receipts.inc({ state });
  conn.send("receipt", { of: f.id, to: f.body.to, ...(f.body.re ? { re: f.body.re } : {}), state });
}

/** A relay-made notice (not end-to-end): verify.cancel { reason } for one target (7.4, 8.6). It waits in
 *  the inbox for 60 s and may be pushed, replacing the request's notification (same Topic, 11.3). */
export async function sendCancel(
  hub: Hub,
  asker: string,
  requestId: string,
  target: string,
  reason: "asker_cancelled" | "answered_elsewhere" | "expired",
): Promise<void> {
  const now = Date.now();
  const stored: StoredFrame = {
    frame: {
      v: 1,
      t: "deliver",
      id: ulid(now),
      sts: now,
      body: {
        from: asker,
        kind: "verify.cancel",
        re: requestId,
        ttlMs: TIMING.INBOX_TTL_CANCEL_MS,
        system: { reason },
      },
    },
    expiresAt: now + TIMING.INBOX_TTL_CANCEL_MS,
  };
  await hub.router.route(target, stored, { inbox: true, push: true });
}
