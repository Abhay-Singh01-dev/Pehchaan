// SimKey (spec B3): behaves like the real passkey-backed key, including every failure.
//   - createKey waits 1.2 s (as if the fingerprint sheet were open), then returns a random
//     keyId/publicKey and four safety words from SHA-256 of the public key.
//   - signAnswer opens the simulated unlock sheet (F2) and then signs request + decision.
//   - Failure states for A6 are forced from Diagnostics → Simulation panel ("Key creation").
import type { Decision, KeyOutcome, KeyService, Profile, SignedAnswer, VerifyRequest } from "../types";
import { KeyError } from "../errors";
import { randomBytes, randomId, toBase64Url } from "../crypto";
import { safetyWordsFor } from "../words";
import { makeSignedAnswer } from "./simSign";
import { requestUnlock } from "./unlockBridge";
import { sleep } from "./bus";

export interface SimKeyDeps {
  getProfile: () => Promise<Profile | null>;
  getOutcome: () => Promise<KeyOutcome>;
  setOutcome: (o: KeyOutcome) => Promise<void>;
}

async function newKeyMaterial() {
  const keyId = randomId("key", 16);
  // Shaped like an uncompressed P-256 public key (65 bytes), base64url.
  const publicKey = toBase64Url(randomBytes(65));
  return { keyId, publicKey, safetyWords: await safetyWordsFor(publicKey) };
}

export function createSimKey(deps: SimKeyDeps): KeyService {
  return {
    async checkSupport() {
      const outcome = await deps.getOutcome();
      // Support problems are one-shot: after showing the error once, the next attempt succeeds,
      // as if the person had fixed their phone's settings.
      if (outcome === "no_screen_lock" || outcome === "no_passkeys") await deps.setOutcome("success");
      return {
        passkeys: outcome !== "no_passkeys",
        screenLock: outcome === "no_screen_lock" ? "no" : "yes",
      };
    },

    async createKey() {
      const outcome = await deps.getOutcome();
      await sleep(1200);
      if (outcome === "cancelled") {
        await deps.setOutcome("success");
        throw new KeyError("cancelled");
      }
      return newKeyMaterial();
    },

    async createPinKey() {
      await sleep(700);
      return newKeyMaterial();
    },

    async signAnswer(req: VerifyRequest, decision: Decision): Promise<SignedAnswer> {
      const profile = await deps.getProfile();
      if (!profile?.keyId) throw new KeyError("no_key");
      // Every answer, including NO, NOT ME, needs an unlock (spec B9 #4).
      await requestUnlock(req, decision);
      return makeSignedAnswer({ keyId: profile.keyId, req, decision, fromDeviceId: profile.deviceId });
    },

    async deleteKey() {
      // The simulated key lives only in the profile record, which the caller clears.
    },
  };
}
