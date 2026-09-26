// SimKey (frontend spec B3; backend D-008): behaves like the real passkey, including every failure, but the
// key is a software P-256 key behind the simulated unlock sheet (F2). Its answers are genuine WebAuthn-format
// assertions, so the one real verifier checks them.
//   - createKey waits 1.2 s (as if the fingerprint sheet were open), then makes a software credential.
//   - signAnswer opens the simulated unlock sheet, then signs request + decision (the challenge of 10.2).
//   - Failures for A6 are forced from Diagnostics → Simulation panel ("Key creation").
import { challengeFor } from "@pehchaan/crypto/canonical";
import { createSoftCredential, softAnswer } from "@pehchaan/crypto/soft-authenticator";
import { appConfig } from "@/app/config";
import type { PehchaanDB } from "@/store/db";
import type { KeyOutcome, KeyService } from "../types";
import { KeyError } from "../errors";
import { requestUnlock } from "./unlockBridge";
import { deleteVaultCred, putVaultCred } from "./vault";
import { sleep } from "./bus";

export interface SimKeyDeps {
  db: PehchaanDB;
  getOutcome: () => Promise<KeyOutcome>;
  setOutcome: (o: KeyOutcome) => Promise<void>;
}

export function createSimKey(deps: SimKeyDeps): KeyService {
  return {
    async checkSupport() {
      const outcome = await deps.getOutcome();
      // Support problems are one-shot: after showing the error once, the next attempt succeeds, as if the
      // person had fixed their phone's settings.
      if (outcome === "no_screen_lock" || outcome === "no_passkeys") await deps.setOutcome("success");
      return {
        passkeys: outcome !== "no_passkeys",
        screenLock: outcome === "no_screen_lock" ? "no" : "yes",
      };
    },

    async createKey({ deviceId }) {
      const outcome = await deps.getOutcome();
      await sleep(1200);
      if (outcome === "cancelled") {
        await deps.setOutcome("success");
        throw new KeyError("cancelled");
      }
      const cred = await createSoftCredential();
      await deps.db.simKey.put({
        id: "me",
        credId: cred.credId,
        publicKey: cred.publicKey,
        privateKey: cred.privateKey,
      });
      await putVaultCred({ credId: cred.credId, deviceId, publicKey: cred.publicKey, privateKey: cred.privateKey });
      return { keyId: cred.credId, publicKey: cred.publicKey };
    },

    async prepareAnswer(req) {
      // Nothing to precompute for a software key, but keep the timing identical to the real one.
      await Promise.all([challengeFor(req, "ME"), challengeFor(req, "NOT_ME")]);
    },

    async signAnswer(req, decision) {
      const key = await deps.db.simKey.get("me");
      if (!key) throw new KeyError("no_key");
      // Every answer, including NO, NOT ME, needs an unlock (frontend spec B9 #4).
      await requestUnlock(req, decision);
      return softAnswer({
        req,
        decision,
        credId: key.credId,
        privateKey: key.privateKey,
        // Signed like a real passkey: this page's origin, the configured rpId.
        rpId: appConfig.rpId,
        origin: location.origin,
      });
    },

    async deleteKey() {
      const key = await deps.db.simKey.get("me");
      if (key) {
        await deps.db.simKey.delete("me");
        await deleteVaultCred(key.credId);
      }
    },
  };
}
