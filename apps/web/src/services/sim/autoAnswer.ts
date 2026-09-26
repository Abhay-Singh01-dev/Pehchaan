// The Simulation panel's "Auto-answer my requests" (spec B3 item 5): lets one device test
// every verdict without a second tab. The simulated family member answers after 2 s, or the
// answer is tampered with the way the Security Lab would.
import type { AutoAnswerMode, SignedAnswer, VerifyRequest } from "../types";
import type { PehchaanDB } from "@/store/db";
import { randomBytes, randomId, toBase64Url } from "../crypto";
import { makeSignedAnswer } from "./simSign";
import { sleep } from "./bus";

export type Deliver = (ans: SignedAnswer) => void;

export function createAutoResponder(db: PehchaanDB) {
  async function memberKey(deviceId: string): Promise<string | null> {
    const m = await db.family.where("deviceId").equals(deviceId).first();
    return m?.keyId ?? null;
  }

  async function lastYes(deviceId: string): Promise<SignedAnswer | null> {
    const row = await db.meta.get("sim:lastYes");
    const map = (row?.value ?? {}) as Record<string, SignedAnswer>;
    return map[deviceId] ?? null;
  }

  async function rememberYes(deviceId: string, ans: SignedAnswer) {
    const row = await db.meta.get("sim:lastYes");
    const map = (row?.value ?? {}) as Record<string, SignedAnswer>;
    map[deviceId] = ans;
    await db.meta.put({ key: "sim:lastYes", value: map });
  }

  return async function respond(req: VerifyRequest, mode: AutoAnswerMode, deliver: Deliver) {
    if (mode === "off" || mode === "never") return;
    await sleep(2000);
    const keyId = await memberKey(req.toDeviceId);
    const genuineKey = keyId ?? randomId("key", 16);
    const from = req.toDeviceId;

    switch (mode) {
      case "yes": {
        const ans = await makeSignedAnswer({ keyId: genuineKey, req, decision: "ME", fromDeviceId: from });
        await rememberYes(from, ans);
        deliver(ans);
        return;
      }
      case "not_me":
        deliver(await makeSignedAnswer({ keyId: genuineKey, req, decision: "NOT_ME", fromDeviceId: from }));
        return;
      case "tamper_changed": {
        // A genuine NOT ME whose decision is flipped on the way.
        const genuine = await makeSignedAnswer({ keyId: genuineKey, req, decision: "NOT_ME", fromDeviceId: from });
        deliver({ ...genuine, decision: "ME" });
        return;
      }
      case "tamper_reused": {
        // An old genuine "Yes" re-sent for this new request.
        let old = await lastYes(from);
        if (!old) {
          const oldReq = { requestId: randomId("req"), nonce: toBase64Url(randomBytes(32)) };
          old = await makeSignedAnswer({
            keyId: genuineKey,
            req: oldReq,
            decision: "ME",
            fromDeviceId: from,
            answeredAt: Date.now() - 5 * 60_000,
          });
          // It was accepted once before, so its nonce is already spent.
          await db.usedNonces.put({ nonce: old.nonce, at: old.answeredAt });
        }
        deliver({ ...old, requestId: req.requestId });
        return;
      }
      case "tamper_wrong_key": {
        const attackerKey = randomId("key_attacker", 16);
        deliver(await makeSignedAnswer({ keyId: attackerKey, req, decision: "ME", fromDeviceId: from }));
        return;
      }
    }
  };
}
