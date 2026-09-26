// A deliberate boundary violation (spec section 4): the relay must never import the verifier.
// Only test/unit/depcruise.test.ts looks at this file, to prove `pnpm depcruise` catches it.
import { verifyAnswer } from "@pehchaan/crypto/verifier";

export const forbidden = verifyAnswer;
