// A deliberate boundary violation (spec section 4): the relay must never import the verifier (or anything
// in packages/crypto other than device-auth). Only test/unit/depcruise.test.ts looks at this file.
import { CRYPTO_VERSION } from "@pehchaan/crypto";

export const forbidden = CRYPTO_VERSION;
