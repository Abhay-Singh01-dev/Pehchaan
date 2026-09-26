// RequestFactory: builds VerifyRequests (fresh requestId, 32-byte nonce, 60 s expiry, spec D2)
// and derives confirmation words. Shared by the simulated and real service sets.
import type { RequestFactory, VerifyRequest } from "./types";
import { randomBytes, randomId, toBase64Url } from "./crypto";
import { confirmationWordsFor } from "./words";

export const REQUEST_TTL_MS = 60_000;

export function createRequestFactory(): RequestFactory {
  return {
    create({ from, member, reason, amountInr }) {
      const createdAt = Date.now();
      const req: VerifyRequest = {
        requestId: randomId("req"),
        nonce: toBase64Url(randomBytes(32)),
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
