// The Simulation panel's "Auto-answer my requests" (frontend spec B3 item 5): lets one device test every verdict
// without a second tab. The simulated family member answers after 2 s with a GENUINE passkey-format answer
// signed by their simulated key (from the shared vault), or the answer is tampered with the way the Security
// Lab would. The one real verifier checks it (D-008).
import { softAnswer, createSoftCredential } from "@pehchaan/crypto/soft-authenticator";
import { b64url } from "@pehchaan/crypto/bytes";
import { ulid } from "@pehchaan/protocol";
import { appConfig } from "@/app/config";
import type { AutoAnswerMode, VerifyRequest, WireAnswer } from "../types";
import type { PehchaanDB } from "@/store/db";
import { getVaultCred } from "./vault";
import { sleep } from "./bus";

export type Deliver = (ans: WireAnswer) => void;

export function createAutoResponder(db: PehchaanDB) {
  /** The member's own simulated key, or (if their phone's key isn't in this browser) a stranger's. */
  async function keyFor(deviceId: string) {
    const m = await db.family.where("deviceId").equals(deviceId).first();
    const cred = m?.keyId ? await getVaultCred(m.keyId) : undefined;
    if (cred) return { credId: cred.credId, privateKey: cred.privateKey };
    const fresh = await createSoftCredential();
    return { credId: m?.keyId ?? fresh.credId, privateKey: fresh.privateKey };
  }

  const sign = async (
    req: Pick<VerifyRequest, "requestId" | "nonce"> & VerifyRequest,
    decision: "ME" | "NOT_ME",
    key: { credId: string; privateKey: CryptoKey },
    answeredAt?: number,
  ) =>
    softAnswer({
      req,
      decision,
      credId: key.credId,
      privateKey: key.privateKey,
      rpId: appConfig.rpId,
      origin: location.origin,
      ...(answeredAt ? { answeredAt } : {}),
    });

  async function lastYes(deviceId: string): Promise<WireAnswer | null> {
    const row = await db.meta.get("sim:lastYes");
    return ((row?.value ?? {}) as Record<string, WireAnswer>)[deviceId] ?? null;
  }

  async function rememberYes(deviceId: string, ans: WireAnswer) {
    const row = await db.meta.get("sim:lastYes");
    const map = (row?.value ?? {}) as Record<string, WireAnswer>;
    map[deviceId] = ans;
    await db.meta.put({ key: "sim:lastYes", value: map });
  }

  return async function respond(req: VerifyRequest, mode: AutoAnswerMode, deliver: Deliver) {
    if (mode === "off" || mode === "never") return;
    await sleep(2000);
    const from = req.toDeviceId;

    switch (mode) {
      case "yes": {
        const ans = await sign(req, "ME", await keyFor(from));
        await rememberYes(from, ans);
        deliver(ans);
        return;
      }
      case "not_me":
        deliver(await sign(req, "NOT_ME", await keyFor(from)));
        return;
      case "tamper_changed": {
        // A genuine NOT ME whose decision is flipped on the way (check 3).
        const genuine = await sign(req, "NOT_ME", await keyFor(from));
        deliver({ ...genuine, decision: "ME" });
        return;
      }
      case "tamper_reused": {
        // An old genuine "Yes" re-sent for this new request (checks 1, 3, 7).
        let old = await lastYes(from);
        if (!old) {
          const oldReq = {
            ...req,
            requestId: ulid(Date.now() - 5 * 60_000),
            nonce: b64url(crypto.getRandomValues(new Uint8Array(32))),
          };
          old = await sign(oldReq, "ME", await keyFor(from), Date.now() - 5 * 60_000);
          // It was accepted once before, so its nonce is already spent.
          await db.usedNonces.put({ nonce: old.nonce, requestId: oldReq.requestId, usedAt: old.answeredAt });
        }
        deliver({ ...old, requestId: req.requestId });
        return;
      }
      case "tamper_wrong_key": {
        // A perfect-looking "Yes" signed with an attacker's own key (checks 2, 6).
        const attacker = await createSoftCredential();
        deliver(await sign(req, "ME", { credId: attacker.credId, privateKey: attacker.privateKey }));
        return;
      }
    }
  };
}
