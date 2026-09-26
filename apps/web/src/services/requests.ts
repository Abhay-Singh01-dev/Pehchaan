// RequestFactory: builds VerifyRequests (a ULID request ID, a 32-byte nonce, a 60 s expiry, frontend spec D2)
// and derives the confirmation words (backend spec 10.8). Shared by every service set.
import { confirmationWordsFor } from "@pehchaan/crypto/confirm-words";
import { b64url } from "@pehchaan/crypto/bytes";
import { ulid } from "@pehchaan/protocol";
import type { RequestFactory, VerifyRequest } from "./types";

export const REQUEST_TTL_MS = 60_000;

/** A URL-safe random id for local records, e.g. "unk_3fZq…" (12 random bytes). */
export function randomId(prefix = ""): string {
  return (prefix ? prefix + "_" : "") + b64url(crypto.getRandomValues(new Uint8Array(12)));
}

export function createRequestFactory(): RequestFactory {
  return {
    create({ from, member, reason, amountInr }) {
      const createdAt = Date.now();
      const req: VerifyRequest = {
        // A ULID: it is also the id of the `send` frame that carries the request (D-009).
        requestId: ulid(createdAt),
        nonce: b64url(crypto.getRandomValues(new Uint8Array(32))),
        fromDeviceId: from.deviceId,
        fromLabel: from.name,
        fromName: from.name,
        toDeviceId: member.deviceId,
        claimedLabel: member.label,
        channel: "call",
        createdAt,
        expiresAt: createdAt + REQUEST_TTL_MS,
      };
      if (from.phone) req.fromPhone = from.phone;
      if (reason) req.reason = reason;
      if (reason === "money" && amountInr && amountInr > 0) req.amountInr = Math.round(amountInr);
      return req;
    },
    confirmationWords: (ans) => confirmationWordsFor(ans),
    randomId: (prefix) => randomId(prefix),
  };
}
