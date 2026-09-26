// SimVerifier (D-008): the SAME 7 checks as RealVerifier (services/verifier.ts over @pehchaan/crypto). The only
// difference is the address it expects: this page's own origin and host, so simulation works wherever the app
// is served (a laptop, a preview URL) without a production domain.
import type { PehchaanDB } from "@/store/db";
import type { VerifierService } from "../types";
import { createVerifier } from "../verifier";

export function createSimVerifier(db: PehchaanDB): VerifierService {
  return createVerifier(db, () => ({ origin: location.origin, rpId: location.hostname }));
}
