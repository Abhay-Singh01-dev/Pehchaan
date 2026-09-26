// RealVerifier (backend spec 10.5–10.7, FC-5): the 7 checks against the CONFIGURED origin and rpId
// (VITE_ORIGIN, VITE_RP_ID): a passkey answer signed on any other website fails check 4. The checks themselves
// are packages/crypto/src/verifier.ts, which every teammate can walk through line by line.
import type { PehchaanDB } from "@/store/db";
import { appConfig } from "@/app/config";
import type { VerifierService } from "../types";
import { createVerifier } from "../verifier";

export function createRealVerifier(db: PehchaanDB): VerifierService {
  return createVerifier(db, () => ({ origin: appConfig.origin, rpId: appConfig.rpId }));
}
