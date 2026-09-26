// A genuine answer and everything the verifier needs, built with real WebCrypto (never mocked).
import { b64url } from "../src/bytes";
import { createSoftCredential, softAnswer, type SoftCredential } from "../src/soft-authenticator";
import type { CanonicalRequestFields, Decision, WireAnswer } from "../src/types";
import type { VerifyInput } from "../src/verifier";

export const RP_ID = "app.yourdomain.in";
export const ORIGIN = "https://app.yourdomain.in";
export const MAA = "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S";
export const ARJUN = "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F";
export const PRIYA = "Pr1Ya7Sh4Rm9Aq2Wx5Lk8Z";

export function request(over: Partial<CanonicalRequestFields> = {}): CanonicalRequestFields {
  return {
    requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
    nonce: b64url(crypto.getRandomValues(new Uint8Array(32))),
    fromDeviceId: MAA,
    toDeviceId: ARJUN,
    claimedLabel: "Arjun",
    reason: "money",
    amountInr: 50000,
    createdAt: 1761900000000,
    expiresAt: 1761900060000,
    ...over,
  };
}

export interface Fixture {
  req: CanonicalRequestFields;
  ans: WireAnswer;
  cred: SoftCredential;
  input: (over?: Partial<VerifyInput>) => VerifyInput;
}

let shared: SoftCredential | null = null;
export async function credential(): Promise<SoftCredential> {
  shared ??= await createSoftCredential();
  return shared;
}

export async function genuine(
  decision: Decision = "ME",
  opts: { req?: CanonicalRequestFields; flags?: number; origin?: string; rpId?: string; cred?: SoftCredential } = {},
): Promise<Fixture> {
  const req = opts.req ?? request();
  const cred = opts.cred ?? (await credential());
  const ans = await softAnswer({
    req,
    decision,
    credId: cred.credId,
    privateKey: cred.privateKey,
    rpId: opts.rpId ?? RP_ID,
    origin: opts.origin ?? ORIGIN,
    ...(opts.flags === undefined ? {} : { flags: opts.flags }),
    answeredAt: req.createdAt + 4000,
  });
  const input = (over: Partial<VerifyInput> = {}): VerifyInput => ({
    req,
    ans,
    envFrom: req.toDeviceId,
    member: { deviceId: req.toDeviceId, credId: cred.credId, passkeyPub: cred.publicKey },
    expected: { origin: ORIGIN, rpId: RP_ID },
    receivedAt: req.createdAt + 5000,
    isNonceUsed: async () => false,
    ...over,
  });
  return { req, ans, cred, input };
}

export const failedOf = (r: { checks: Array<{ n: number; passed: boolean }> }) =>
  r.checks.filter((c) => !c.passed).map((c) => c.n);
