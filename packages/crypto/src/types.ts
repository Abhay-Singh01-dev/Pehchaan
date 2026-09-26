// Types shared by the security core. They mirror the wire payloads of spec 7.4 and the verifier of 10.5.

export type Decision = "ME" | "NOT_ME";

/** The signed part of a request (10.2). Display-only fields (fromName, fromLabel, channel) are not here. */
export interface CanonicalRequestFields {
  requestId: string;
  nonce: string;
  fromDeviceId: string;
  toDeviceId: string;
  claimedLabel: string;
  reason?: string;
  amountInr?: number;
  createdAt: number;
  expiresAt: number;
}

/** A signed answer as it travels (22.2). The UP/UV flags are read from authenticatorData, never trusted as fields. */
export interface WireAnswer {
  requestId: string;
  nonce: string;
  decision: Decision;
  keyType: "pk" | "pin";
  /** Passkey credential ID, base64url. */
  credId: string;
  /** base64url of the raw authenticatorData bytes. */
  authenticatorData: string;
  /** base64url of the raw clientDataJSON bytes. */
  clientDataJSON: string;
  /** base64url of the ASN.1 DER ECDSA signature, as WebAuthn returns it. */
  signature: string;
  answeredAt: number;
}

export type CheckKey = "fresh" | "key" | "exact" | "address" | "unlocked" | "signature" | "unused";
export type CheckNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type InvalidReason =
  "reused" | "wrong_key" | "wrong_app" | "changed" | "not_unlocked" | "bad_signature" | "expired";

export interface VerifierCheck {
  n: CheckNumber;
  key: CheckKey;
  passed: boolean;
}

export type VerifierResult =
  | { verdict: "VERIFIED" | "DENIED"; checks: VerifierCheck[]; late?: true }
  | { verdict: "NO_RESPONSE"; noResponseReason: "late"; checks: VerifierCheck[] }
  | { verdict: "INVALID"; invalidReason: InvalidReason; checks: VerifierCheck[] };

/** What the asker saved for the person the request went to (their card). */
export interface MemberKey {
  deviceId: string;
  credId: string;
  passkeyPub: string;
}
