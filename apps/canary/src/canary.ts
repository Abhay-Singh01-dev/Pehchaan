// The canary run (spec 19.4, 19.6): the relay path end to end, from outside the relay's network.
//   1. both synthetic devices log in (the availability SLO: within 5 s);
//   2. the asker sends a sealed request with the answerer's grant; the relay accepts it;
//   3. the answerer receives it, acks, and sends a sealed answer; the asker receives it;
//   4. the receipts and timings are checked (the round trip SLO: p95 < 3 s; one run fails above 10 s).
// Envelopes are sealed exactly as the app seals them (packages/crypto e2e): the canary works with E2E_REQUIRED.
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { seal } from "@pehchaan/crypto/e2e";
import { ulid } from "@pehchaan/protocol";
import { RelayClient, type Endpoint } from "./client";
import type { CanaryDevice } from "./device";

export const LIMITS = {
  /** 19.4: "canary logs in within 5 s". */
  loginMs: 5_000,
  /** One run's round trip may be slower than the 3 s p95, but never this slow. */
  roundTripMs: 10_000,
  /** Every single step. */
  stepMs: 10_000,
} as const;

export interface CanaryResult {
  ok: boolean;
  timings: { loginMs: number; acceptedMs: number; deliveredMs: number; roundTripMs: number };
  error?: string;
}

/** A pass or a failure from the measured timings (pure, so it can be tested on its own). */
export function evaluate(t: CanaryResult["timings"]): string | null {
  if (t.loginMs > LIMITS.loginMs) return `login took ${t.loginMs} ms (limit ${LIMITS.loginMs})`;
  if (t.roundTripMs > LIMITS.roundTripMs) return `round trip took ${t.roundTripMs} ms (limit ${LIMITS.roundTripMs})`;
  return null;
}

async function sealedSend(
  from: CanaryDevice,
  to: CanaryDevice,
  kind: "verify.request" | "verify.answer",
  payload: object,
  o: { id: string; re: string },
) {
  const e2e = await seal(
    payload,
    { kind, id: o.id, from: from.deviceId, to: to.deviceId, re: o.re },
    b64urlDecode(to.ek),
    from.signKey,
  );
  return {
    kind,
    to: to.deviceId,
    re: o.re,
    ttlMs: kind === "verify.request" ? 30_000 : 0,
    ...(kind === "verify.request" ? { grant: to.cardGrant } : {}),
    e2e,
  };
}

export async function runCanary(ep: Endpoint, asker: CanaryDevice, answerer: CanaryDevice): Promise<CanaryResult> {
  const timings = { loginMs: 0, acceptedMs: 0, deliveredMs: 0, roundTripMs: 0 };
  let a: RelayClient | null = null;
  let b: RelayClient | null = null;
  try {
    const t0 = Date.now();
    [a, b] = await Promise.all([RelayClient.open(ep), RelayClient.open(ep)]);
    await Promise.all([a.login(asker, ep, LIMITS.stepMs), b.login(answerer, ep, LIMITS.stepMs)]);
    timings.loginMs = Date.now() - t0;

    // A request as the app builds it (payload fields per 7.4), sealed to the answerer.
    const requestId = ulid();
    const now = Date.now();
    const request = {
      spk: asker.dk,
      sek: asker.ek,
      fromName: "Canary",
      req: {
        v: 1,
        requestId,
        nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
        fromDeviceId: asker.deviceId,
        toDeviceId: answerer.deviceId,
        claimedLabel: "Canary",
        createdAt: now,
        expiresAt: now + 30_000,
      },
    };
    const t1 = Date.now();
    a.send(
      "send",
      await sealedSend(asker, answerer, "verify.request", request, { id: requestId, re: requestId }),
      requestId,
    );
    await a.accepted(requestId, LIMITS.stepMs, "request");
    timings.acceptedMs = Date.now() - t1;

    const got = await b.next(
      (f) => f.t === "deliver" && f.body.re === requestId,
      LIMITS.stepMs,
      "the request on the answerer",
    );
    b.send("ack", { of: got.id });
    timings.deliveredMs = Date.now() - t1;

    // The answer: a canary can't hold a passkey, and the relay never judges answers, so an opaque sealed answer.
    const answerId = ulid();
    const answer = { spk: answerer.dk, ans: { requestId, decision: "NOT_ME", canary: true } };
    b.send(
      "send",
      await sealedSend(answerer, asker, "verify.answer", answer, { id: answerId, re: requestId }),
      answerId,
    );
    await b.accepted(answerId, LIMITS.stepMs, "answer");
    await a.next(
      (f) => f.t === "deliver" && f.body.kind === "verify.answer" && f.body.re === requestId,
      LIMITS.stepMs,
      "the answer on the asker",
    );
    // The asker saw its request delivered.
    await a.next(
      (f) => f.t === "receipt" && f.body.of === requestId && f.body.state === "delivered",
      LIMITS.stepMs,
      "the delivered receipt",
    );
    timings.roundTripMs = Date.now() - t1;
    const problem = evaluate(timings);
    return { ok: problem === null, timings, ...(problem ? { error: problem } : {}) };
  } catch (e) {
    return { ok: false, timings, error: (e as Error).message };
  } finally {
    a?.close();
    b?.close();
  }
}
