// A complete check at protocol level, verified exactly as Maa's phone verifies it: the asker seals a request, the
// answerer opens it and answers with a WebAuthn assertion (a software authenticator: the same bytes a passkey
// produces), and the asker opens the answer and runs the real 7-check verifier (packages/crypto) on it.
// Used where a whole browser can't go: through Caddy while containers are killed (J-14) and in the chaos tests.
// The verdict is what the person would see: VERIFIED only when all 7 checks pass and the decision is ME.
import type { Endpoint } from "@pehchaan/canary/client";
import { sealedSend } from "@pehchaan/canary/canary";
import { b64urlDecode } from "@pehchaan/crypto/bytes";
import { open } from "@pehchaan/crypto/e2e";
import { createSoftCredential, softAnswer, type SoftCredential } from "@pehchaan/crypto/soft-authenticator";
import type { CanonicalRequestFields, WireAnswer } from "@pehchaan/crypto";
import { verifyAnswer } from "@pehchaan/crypto/verifier";
import { newSession } from "@pehchaan/loadgen/fleet";
import type { Deliver, Session } from "@pehchaan/loadgen/session";
import { ulid } from "@pehchaan/protocol";
import { ORIGIN } from "./stack";

const RP_ID = new URL(ORIGIN).hostname;
/** The request window (8.1) and the relay's 30 s grace for late answers (10.7). */
const TTL_MS = 60_000;
const GRACE_MS = 30_000;

export interface Phone {
  session: Session;
  cred: SoftCredential;
}

/** A logged-in phone, retrying until it lands on a relay container whose name starts with `gateway` (if given).
 *  A container that just restarted gets new connections only after Caddy's next health check (every 5 s). */
export async function phone(ep: Endpoint, gateway?: string, withinMs = 30_000): Promise<Phone> {
  const end = Date.now() + withinMs;
  const seen = new Set<string>();
  while (Date.now() < end) {
    const session = await newSession(ep);
    const loggedIn = await Promise.race([
      session.start().then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), Math.max(0, end - Date.now()))),
    ]);
    if (!loggedIn) {
      session.stop();
      break;
    }
    if (!gateway || session.gateway.startsWith(gateway)) return { session, cred: await createSoftCredential() };
    seen.add(session.gateway);
    session.stop();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no socket landed on ${gateway} within ${withinMs} ms (only on ${[...seen].join(", ")})`);
}

/** Waits until the phone is logged in again (after its relay went away), optionally on a given container. */
export async function relogged(p: Phone, gateway: string, timeoutMs = 30_000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (p.session.ready && p.session.gateway.startsWith(gateway)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`not logged in on ${gateway} within ${timeoutMs} ms (now on ${p.session.gateway})`);
}

export interface Outcome {
  verdict: "VERIFIED" | "DENIED" | "INVALID" | "NO_RESPONSE";
  invalidReason?: string;
  /** What the asker's relay said about the request (accepted, or why not). */
  request: string;
  /** Every receipt state the asker saw for its request, in order (accepted, pushed, delivered, failed…). */
  receipts: string[];
}

const header = (f: Deliver, to: string) => ({ kind: f.body.kind, id: f.id, from: f.body.from, to, re: f.body.re });

export async function realCheck(o: {
  asker: Phone;
  answerer: Phone;
  decision: "ME" | "NOT_ME";
  /** The request window (8.1: 10–60 s); 60 s by default, as the app sends. */
  ttlMs?: number;
  /** The answerer's own phone doesn't answer (it is closed or offline): only the asker's side runs. */
  noAnswer?: boolean;
  /** Runs on the answerer's phone after it has opened the request and before it answers. */
  beforeAnswer?: () => Promise<void>;
  /** Runs on the asker's phone right after the relay accepted the request. */
  afterAccepted?: () => Promise<void>;
}): Promise<Outcome> {
  const asker = o.asker.session;
  const answerer = o.answerer.session;
  const ttl = o.ttlMs ?? TTL_MS;
  const now = Date.now();
  const req: CanonicalRequestFields = {
    requestId: ulid(),
    nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
    fromDeviceId: asker.device.deviceId,
    toDeviceId: answerer.device.deviceId,
    claimedLabel: "Ops test",
    createdAt: now,
    expiresAt: now + ttl,
  };
  const usedNonces = new Set<string>();

  return new Promise<Outcome>((resolve, reject) => {
    let request = "pending";
    const receipts: string[] = [];
    const done = (r: Omit<Outcome, "request" | "receipts">) => {
      clearTimeout(timer);
      resolve({ ...r, request, receipts });
    };
    // No verdict by the end of the window plus the grace: "Not confirmed yet" (10.7).
    const timer = setTimeout(() => done({ verdict: "NO_RESPONSE" }), ttl + GRACE_MS);
    asker.onReceipt = (r) => {
      if (r.of === req.requestId) receipts.push(r.state);
    };

    answerer.onDeliver = (f) => {
      if (o.noAnswer || f.body.kind !== "verify.request" || f.body.re !== req.requestId || !f.body.e2e) return;
      void (async () => {
        const d = answerer.device;
        const got = await open<{ spk: string; req: CanonicalRequestFields & { v: 1 } }>(
          f.body.e2e as Parameters<typeof open>[0],
          header(f, d.deviceId),
          d.encKey,
          b64urlDecode(d.ek),
          asker.device.dk,
        );
        await o.beforeAnswer?.();
        const { v: _v, ...fields } = got.req;
        const ans = await softAnswer({
          req: fields,
          decision: o.decision,
          credId: o.answerer.cred.credId,
          privateKey: o.answerer.cred.privateKey,
          rpId: RP_ID,
          origin: ORIGIN,
        });
        const id = ulid();
        const body = await sealedSend(d, asker.device, "verify.answer", { spk: d.dk, ans }, { id, re: req.requestId });
        await answerer.send("send", body, id);
      })().catch(reject);
    };

    asker.onDeliver = (f) => {
      if (f.body.kind !== "verify.answer" || f.body.re !== req.requestId || !f.body.e2e) return;
      const receivedAt = Date.now();
      void (async () => {
        const d = asker.device;
        const got = await open<{ spk: string; ans: WireAnswer }>(
          f.body.e2e as Parameters<typeof open>[0],
          header(f, d.deviceId),
          d.encKey,
          b64urlDecode(d.ek),
          answerer.device.dk,
        );
        const r = await verifyAnswer({
          req,
          ans: got.ans,
          envFrom: f.body.from,
          member: {
            deviceId: answerer.device.deviceId,
            credId: o.answerer.cred.credId,
            passkeyPub: o.answerer.cred.publicKey,
          },
          expected: { origin: ORIGIN, rpId: RP_ID },
          receivedAt,
          isNonceUsed: async (n) => usedNonces.has(n),
        });
        usedNonces.add(req.nonce);
        if (r.verdict === "INVALID") done({ verdict: "INVALID", invalidReason: r.invalidReason });
        else done({ verdict: r.verdict === "NO_RESPONSE" ? "NO_RESPONSE" : r.verdict });
      })().catch(reject);
    };

    void (async () => {
      const payload = { spk: asker.device.dk, sek: asker.device.ek, fromName: "Ops test", req: { v: 1, ...req } };
      const body = await sealedSend(asker.device, answerer.device, "verify.request", payload, {
        id: req.requestId,
        re: req.requestId,
        ttlMs: ttl,
      });
      const rc = await asker.send("send", body, req.requestId);
      request = rc.state === "accepted" ? "accepted" : `${rc.state}: ${rc.reason ?? ""}`;
      if (rc.state !== "accepted") return done({ verdict: "NO_RESPONSE" });
      await o.afterAccepted?.();
    })().catch(reject);
  });
}
