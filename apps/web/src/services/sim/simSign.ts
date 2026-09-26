// The simulated signature (spec B3, SimKey):
//   signature  = hex(SHA-256(keyId | requestId | nonce | decision | origin))
//   clientData = { requestId, nonce, decision, origin, type: 'answer' }
//
// It stands in for a WebAuthn ECDSA signature: it binds the key, the exact request and the
// decision together, so the verifier can detect a changed decision (check 3), a different key
// (check 2 / 6) and a different website (check 4) exactly like the real one.
import type { Decision, SignedAnswer, VerifyRequest } from "../types";
import { sha256Hex } from "../crypto";

export interface SimClientData {
  requestId: string;
  nonce: string;
  decision: Decision;
  origin: string;
  type: "answer";
}

export function simSignature(keyId: string, cd: Pick<SimClientData, "requestId" | "nonce" | "decision" | "origin">) {
  return sha256Hex(`${keyId}|${cd.requestId}|${cd.nonce}|${cd.decision}|${cd.origin}`);
}

export function parseClientData(raw: string): SimClientData | null {
  try {
    const cd = JSON.parse(raw) as Partial<SimClientData>;
    if (
      typeof cd.requestId === "string" &&
      typeof cd.nonce === "string" &&
      (cd.decision === "ME" || cd.decision === "NOT_ME") &&
      typeof cd.origin === "string" &&
      cd.type === "answer"
    ) {
      return cd as SimClientData;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Signs an answer as the given key would (used by SimKey, the auto-answerer and the Lab's forge). */
export async function makeSignedAnswer(p: {
  keyId: string;
  req: Pick<VerifyRequest, "requestId" | "nonce">;
  decision: Decision;
  fromDeviceId: string;
  origin?: string;
  answeredAt?: number;
}): Promise<SignedAnswer> {
  const origin = p.origin ?? location.origin;
  const clientData: SimClientData = {
    requestId: p.req.requestId,
    nonce: p.req.nonce,
    decision: p.decision,
    origin,
    type: "answer",
  };
  return {
    requestId: p.req.requestId,
    nonce: p.req.nonce,
    decision: p.decision,
    keyId: p.keyId,
    signature: await simSignature(p.keyId, clientData),
    clientData: JSON.stringify(clientData),
    userPresent: true,
    userVerified: true,
    answeredAt: p.answeredAt ?? Date.now(),
    fromDeviceId: p.fromDeviceId,
  };
}
