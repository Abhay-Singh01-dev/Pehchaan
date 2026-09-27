// One check between two simulated phones (spec 21.4), with the same frames as a real check:
//   the asker sends a sealed verify.request with the answerer's grant → the relay accepts it → the answerer
//   receives it, acks it and replies with a sealed verify.answer → the asker receives the answer.
// The check passes when that answer arrives within the request's 60 s. A refusal, a failed receipt or silence
// fails it. The answer is opaque (a load generator can't hold a passkey, and the relay never judges answers).
import { ulid } from "@pehchaan/protocol";
import { sealedSend } from "@pehchaan/canary/canary";
import type { Deliver, Session } from "./session";

/** The app's request window (8.1: the relay clamps ttlMs to 10–60 s). */
export const CHECK_TTL_MS = 60_000;

export interface CheckResult {
  ok: boolean;
  /** send → `accepted` receipt on the asker. */
  acceptedMs: number;
  /** send → the request delivered on the answerer (the routing latency of 21.4). */
  routedMs: number;
  /** send → the answer delivered on the asker. */
  roundTripMs: number;
  error?: string;
}

interface Waiting {
  t0: number;
  acceptedMs: number;
  routedMs: number;
  finish: (r: Partial<CheckResult> & { ok: boolean }) => void;
}

export class Pair {
  private waiting = new Map<string, Waiting>();

  constructor(
    readonly asker: Session,
    readonly answerer: Session,
  ) {
    answerer.onDeliver = (f) => void this.onRequest(f);
    asker.onDeliver = (f) => this.onAnswer(f);
  }

  async check(): Promise<CheckResult> {
    const { asker, answerer } = this;
    const requestId = ulid();
    const now = Date.now();
    const payload = {
      spk: asker.device.dk,
      sek: asker.device.ek,
      fromName: "Load test",
      req: {
        v: 1,
        requestId,
        nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
        fromDeviceId: asker.device.deviceId,
        toDeviceId: answerer.device.deviceId,
        claimedLabel: "Load test",
        createdAt: now,
        expiresAt: now + CHECK_TTL_MS,
      },
    };
    const body = await sealedSend(asker.device, answerer.device, "verify.request", payload, {
      id: requestId,
      re: requestId,
      ttlMs: CHECK_TTL_MS,
    });
    const t0 = performance.now();
    return new Promise<CheckResult>((resolve) => {
      const w: Waiting = {
        t0,
        acceptedMs: -1,
        routedMs: -1,
        finish: (r) => {
          clearTimeout(timer);
          this.waiting.delete(requestId);
          resolve({ acceptedMs: w.acceptedMs, routedMs: w.routedMs, roundTripMs: -1, ...r });
        },
      };
      const timer = setTimeout(() => w.finish({ ok: false, error: "no answer within 60 s" }), CHECK_TTL_MS);
      this.waiting.set(requestId, w);
      asker.send("send", body, requestId).then(
        (rc) => {
          if (rc.state !== "accepted") return w.finish({ ok: false, error: `request ${rc.state} (${rc.reason})` });
          w.acceptedMs = performance.now() - t0;
        },
        (e: Error) => w.finish({ ok: false, error: e.message }),
      );
    });
  }

  /** On the answerer: every request gets an answer, as a phone whose owner taps at once would send. */
  private async onRequest(f: Deliver): Promise<void> {
    const re = f.body.re;
    if (f.body.kind !== "verify.request" || !re) return;
    const w = this.waiting.get(re);
    if (w && w.routedMs < 0) w.routedMs = performance.now() - w.t0;
    const answerId = ulid();
    const answer = { spk: this.answerer.device.dk, ans: { requestId: re, decision: "NOT_ME", load: true } };
    const body = await sealedSend(this.answerer.device, this.asker.device, "verify.answer", answer, {
      id: answerId,
      re,
    });
    const rc = await this.answerer.send("send", body, answerId).catch((e: Error) => e);
    if (rc instanceof Error) this.waiting.get(re)?.finish({ ok: false, error: `answer: ${rc.message}` });
    else if (rc.state !== "accepted") this.waiting.get(re)?.finish({ ok: false, error: `answer ${rc.state}` });
  }

  /** On the asker: the answer closes the check. */
  private onAnswer(f: Deliver): void {
    const re = f.body.re;
    if (f.body.kind !== "verify.answer" || !re) return;
    const w = this.waiting.get(re);
    if (w) w.finish({ ok: true, roundTripMs: performance.now() - w.t0 });
  }
}
