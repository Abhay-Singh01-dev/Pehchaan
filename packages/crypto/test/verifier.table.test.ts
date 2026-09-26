// CRY-07: the 7-check verifier against spec 10.5 (the checks and the attack table) and 10.7 (the late policy).
// Written from the spec alone, without reading the implementation. Every answer below is genuinely signed with a
// real P-256 key through Node's WebCrypto, exactly as a passkey would sign it; nothing is mocked.
import { beforeAll, describe, expect, it } from "vitest";
import { verifyAnswer } from "../src/verifier";
import { b64url, b64urlDecode, concat, sha256, utf8 } from "../src/bytes";
import { canonicalRequest, challengeFor } from "../src/canonical";
import { derToRaw, rawToDer } from "../src/der";
import type { CanonicalRequestFields, Decision, InvalidReason, MemberKey, WireAnswer } from "../src/types";

type Result = Awaited<ReturnType<typeof verifyAnswer>>;

// ---------------------------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------------------------

const RP_ID = "app.yourdomain.in";
const ORIGIN = "https://app.yourdomain.in";
const LOOKALIKE_RP_ID = "app.yourd0main.in";
const LOOKALIKE_ORIGIN = "https://app.yourd0main.in";

const UP = 0x01; // user present
const UV = 0x04; // user verified (fingerprint, face or screen PIN)
const BE = 0x08; // backup eligible (synced passkey)
const BS = 0x10; // backed up (synced passkey)

const MAA = "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S";
const ARJUN = "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F";
const PRIYA = "Pr5Tq8Mz1Xc4Vb7Nk0Lj3H";
const ATTACKER = "Ak6Rw9Ds2Fg5Hj8Kq1Zx4C";

/** Request A of the 10.2 test vectors: Maa asks whether the caller really is Arjun. */
const REQ: CanonicalRequestFields = {
  requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
  nonce: "q3v0Yb7kP1sR9tXw2Zc5Hn8Ld4Fg6Jm0Ae3Uo7Iy1Qk",
  fromDeviceId: MAA,
  toDeviceId: ARJUN,
  claimedLabel: "Arjun",
  reason: "money",
  amountInr: 50000,
  createdAt: 1761900000000,
  expiresAt: 1761900060000,
};

/** Request B of 10.2: a Devanagari label, with no reason and no amount. */
const REQ_B: CanonicalRequestFields = {
  requestId: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
  nonce: "q3v0Yb7kP1sR9tXw2Zc5Hn8Ld4Fg6Jm0Ae3Uo7Iy1Qk",
  fromDeviceId: MAA,
  toDeviceId: ARJUN,
  claimedLabel: "बेटा",
  createdAt: 1761900000000,
  expiresAt: 1761900060000,
};

/** Yesterday's request, whose genuine YES an attacker kept for replay. */
const OLD_REQ: CanonicalRequestFields = {
  ...REQ,
  requestId: "01JB5K2M7P9R3T6V8X0Z1B4D6F",
  nonce: "Hx2Lp9Qa4Rt7Ws1Yd6Fk3Nm8Bv5Cz0Ej2Gu4Io6Pq9",
  createdAt: REQ.createdAt - 86_400_000,
  expiresAt: REQ.expiresAt - 86_400_000,
};

const ON_TIME = REQ.createdAt + 5_000;
const NINE_S_LATE = REQ.expiresAt + 9_000;
const TAMPERED_NONCE = "Tm4Pq8Rs2Uv6Wx0Yz3Ab7Cd1Ef5Gh9Ij2Kl6Mn0Op4";
const TAMPERED_REQUEST_ID = "01JB7Y8Q3Z6N4V5W2K9C0D1E2G";

interface Passkey {
  deviceId: string;
  credId: string;
  passkeyPub: string;
  privateKey: CryptoKey;
}

async function makePasskey(deviceId: string): Promise<Passkey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    deviceId,
    credId: b64url(crypto.getRandomValues(new Uint8Array(16))),
    passkeyPub: b64url(raw),
    privateKey: pair.privateKey,
  };
}

/** The card Maa saved for a member: device ID, credential ID and raw public key. */
const cardOf = (k: Passkey): MemberKey => ({ deviceId: k.deviceId, credId: k.credId, passkeyPub: k.passkeyPub });

let arjun: Passkey;
let priya: Passkey;
let attacker: Passkey;

beforeAll(async () => {
  [arjun, priya, attacker] = await Promise.all([makePasskey(ARJUN), makePasskey(PRIYA), makePasskey(ATTACKER)]);
});

// ---------------------------------------------------------------------------------------------------------------
// Building genuine answers
// ---------------------------------------------------------------------------------------------------------------

async function authDataFor(rpId: string, flags: number): Promise<Uint8Array<ArrayBuffer>> {
  // rpIdHash (32) ‖ flags (1) ‖ signCount (4, zero as synced passkeys report)
  return concat(await sha256(utf8(rpId)), new Uint8Array([flags]), new Uint8Array(4));
}

/** The challenge a phone signs: challengeFor for ME / NOT_ME, the same construction for any other decision. */
async function challengeOf(req: CanonicalRequestFields, decision: string): Promise<Uint8Array> {
  if (decision === "ME" || decision === "NOT_ME") return challengeFor(req, decision);
  return sha256(utf8(canonicalRequest(req) + "|" + decision));
}

interface SignSpec {
  /** Whose passkey signs (default Arjun's). */
  key?: Passkey;
  /** The request as the signing phone saw it (default REQ). */
  req?: CanonicalRequestFields;
  /** The decision signed over and placed in the answer (default ME). */
  decision?: string;
  /** The rpId hashed into authenticatorData (default RP_ID). */
  rpId?: string;
  /** The authenticatorData flags byte (default UP | UV). */
  flags?: number;
  /** Replaces the whole authenticatorData before signing. */
  authData?: Uint8Array;
  /** Fields merged over the genuine clientData before signing; a value of undefined removes the field. */
  clientData?: Record<string, unknown>;
  /** Replaces the whole clientDataJSON before signing. */
  clientDataJSON?: Uint8Array;
}

/** A WireAnswer produced exactly as 10.4 describes, signed by a real key. Tampering is applied afterwards. */
async function sign(spec: SignSpec = {}): Promise<WireAnswer> {
  const key = spec.key ?? arjun;
  const req = spec.req ?? REQ;
  const decision = spec.decision ?? "ME";
  const authData = spec.authData ?? (await authDataFor(spec.rpId ?? RP_ID, spec.flags ?? UP | UV));
  const clientData = {
    type: "webauthn.get",
    challenge: b64url(await challengeOf(req, decision)),
    origin: ORIGIN,
    crossOrigin: false,
    ...spec.clientData,
  };
  const clientDataJSON = spec.clientDataJSON ?? utf8(JSON.stringify(clientData));
  const signed = concat(authData, await sha256(clientDataJSON));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, signed));
  return {
    requestId: req.requestId,
    nonce: req.nonce,
    decision: decision as Decision,
    keyType: "pk",
    credId: key.credId,
    authenticatorData: b64url(authData),
    clientDataJSON: b64url(clientDataJSON),
    signature: b64url(rawToDer(raw)),
    answeredAt: req.createdAt + 4_000,
  };
}

const asDecision = (s: string): Decision => s as Decision;

/** Changes authenticatorData bytes after signing (tampering in transit). */
function withAuthData(ans: WireAnswer, change: (ad: Uint8Array) => void): WireAnswer {
  const ad = b64urlDecode(ans.authenticatorData);
  change(ad);
  return { ...ans, authenticatorData: b64url(ad) };
}

/** Flips one bit in the last byte of s: still well-formed DER, no longer a valid signature. */
function corruptSignature(ans: WireAnswer): WireAnswer {
  const der = b64urlDecode(ans.signature);
  der[der.length - 1] = der[der.length - 1]! ^ 0x01;
  return { ...ans, signature: b64url(der) };
}

/** Same bytes, non-canonical text: sets a trailing bit that no byte string produces. */
function withStrayBits(s: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  if (s.length % 4 === 0) throw new Error("fixture: no spare bits in a length that is a multiple of 4");
  return s.slice(0, -1) + alphabet[alphabet.indexOf(s[s.length - 1]!) ^ 1]!;
}

// ---------------------------------------------------------------------------------------------------------------
// Running the verifier as Maa's phone does
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  /** Maa's stored pending request (default REQ). */
  req?: CanonicalRequestFields;
  /** Relay-authenticated sender (default Arjun's device). */
  envFrom?: string;
  /** The saved card of req.toDeviceId (default Arjun's). */
  member?: MemberKey;
  expected?: { origin: string; rpId: string };
  receivedAt?: number;
  usedNonces?: string[];
}

function verify(ans: WireAnswer, ctx: Ctx = {}): Promise<Result> {
  const used = new Set(ctx.usedNonces ?? []);
  return verifyAnswer({
    req: ctx.req ?? REQ,
    ans,
    envFrom: ctx.envFrom ?? ARJUN,
    member: ctx.member ?? cardOf(arjun),
    expected: ctx.expected ?? { origin: ORIGIN, rpId: RP_ID },
    receivedAt: ctx.receivedAt ?? ON_TIME,
    isNonceUsed: async (nonce) => used.has(nonce),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------------------------

const CHECKS = [
  [1, "fresh"],
  [2, "key"],
  [3, "exact"],
  [4, "address"],
  [5, "unlocked"],
  [6, "signature"],
  [7, "unused"],
];

interface Outcome {
  verdict: Result["verdict"];
  reason?: string;
  late?: true;
  failed: number[];
}

function summary(r: Result): Outcome {
  return {
    verdict: r.verdict,
    reason: r.verdict === "INVALID" ? r.invalidReason : r.verdict === "NO_RESPONSE" ? r.noResponseReason : undefined,
    late: r.verdict === "VERIFIED" || r.verdict === "DENIED" ? r.late : undefined,
    failed: r.checks.filter((c) => !c.passed).map((c) => c.n),
  };
}

function expectShape(r: Result): void {
  expect(r.checks.map((c) => [c.n, c.key])).toEqual(CHECKS);
  for (const c of r.checks) expect(typeof c.passed).toBe("boolean");
}

async function expectOutcome(pending: Promise<Result>, want: Outcome): Promise<void> {
  const r = await pending;
  expect(summary(r)).toEqual({ reason: undefined, late: undefined, ...want });
  expectShape(r);
}

const invalid = (reason: InvalidReason, failed: number[]): Outcome => ({ verdict: "INVALID", reason, failed });
const VERIFIED: Outcome = { verdict: "VERIFIED", failed: [] };
const DENIED: Outcome = { verdict: "DENIED", failed: [] };
const DENIED_LATE: Outcome = { verdict: "DENIED", late: true, failed: [1] };
const NO_RESPONSE_LATE: Outcome = { verdict: "NO_RESPONSE", reason: "late", failed: [1] };

const PRIORITY: InvalidReason[] = ["reused", "wrong_key", "wrong_app", "changed", "not_unlocked", "bad_signature"];
const REASON_OF: Record<number, InvalidReason> = {
  2: "wrong_key",
  3: "changed",
  4: "wrong_app",
  5: "not_unlocked",
  6: "bad_signature",
  7: "reused",
};
/** The highest-priority reason among failed checks 2..7 (check 1 passing). */
const topReason = (failed: number[]): InvalidReason | undefined =>
  PRIORITY.find((reason) => failed.some((n) => REASON_OF[n] === reason));

interface Case {
  name: string;
  run: () => Promise<Result>;
  want: Outcome;
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------

describe("verifier fixture", () => {
  it("request A and B reproduce the 10.2 challenge vectors and rpIdHash", async () => {
    expect(b64url(await challengeFor(REQ, "ME"))).toBe("AkKq6W7rOUy1nHaSjPrvv6mvzTN5GRnjzFU_PO_me48");
    expect(b64url(await challengeFor(REQ, "NOT_ME"))).toBe("G1-ucjqOjawjZo4jWCsqh_pcXUU-tBzduGo4HTRtORU");
    expect(b64url(await challengeFor(REQ_B, "ME"))).toBe("PyFYvQ_1wBKrA4UzlF_mWCzD34oXoKpH51dNzrVeXu8");
    expect(b64url(await challengeFor(REQ_B, "NOT_ME"))).toBe("6OjlO8SRU1RPEshRJhofgvJsR6bz97XngSQTYLp6dZg");
    expect(b64url(await sha256(utf8(RP_ID)))).toBe("zL2KHaulGgG03y83xSbj2v_f_X8quk0vYIHkQ0CRCAg");
  });
});

describe("CRY-07: the 10.5 attack table", () => {
  it("change NOT_ME→ME in transit: only check 3 fails → INVALID changed", async () => {
    const ans = await sign({ decision: "NOT_ME" });
    await expectOutcome(verify({ ...ans, decision: "ME" }), invalid("changed", [3]));
  });

  it("replay of Arjun's old YES for a new request: checks 1, 3, 7 fail → INVALID reused", async () => {
    const old = await sign({ req: OLD_REQ, decision: "ME" });
    const replay = { ...old, requestId: REQ.requestId }; // re-labelled for the new request; the old nonce was used
    await expectOutcome(verify(replay, { usedNonces: [OLD_REQ.nonce] }), invalid("reused", [1, 3, 7]));
  });

  it("forged YES with an attacker key, sent from the attacker's phone: checks 2, 6 fail → INVALID wrong_key", async () => {
    const ans = await sign({ key: attacker });
    await expectOutcome(verify(ans, { envFrom: ATTACKER }), invalid("wrong_key", [2, 6]));
  });

  it("forged YES with an attacker key, sender spoofed as Arjun: checks 2, 6 fail → INVALID wrong_key", async () => {
    const ans = await sign({ key: attacker });
    await expectOutcome(verify(ans, { envFrom: ARJUN }), invalid("wrong_key", [2, 6]));
  });

  it("signed on a look-alike origin: only check 4 fails → INVALID wrong_app", async () => {
    const ans = await sign({ rpId: LOOKALIKE_RP_ID, clientData: { origin: LOOKALIKE_ORIGIN } });
    await expectOutcome(verify(ans), invalid("wrong_app", [4]));
  });

  it("signed without unlock (UP only): only check 5 fails → INVALID not_unlocked", async () => {
    await expectOutcome(verify(await sign({ flags: UP })), invalid("not_unlocked", [5]));
  });

  it("UV bit set in transit on an answer signed without unlock: only check 6 fails → INVALID bad_signature", async () => {
    const ans = withAuthData(await sign({ flags: UP }), (ad) => {
      ad[32] = ad[32]! | UV;
    });
    await expectOutcome(verify(ans), invalid("bad_signature", [6]));
  });

  it("the answer's unsigned nonce field altered: only check 1 fails → INVALID reused (not the late policy)", async () => {
    const ans = await sign();
    await expectOutcome(verify({ ...ans, nonce: TAMPERED_NONCE }), invalid("reused", [1]));
  });

  it("request misrouted to another family member who answers YES: checks 2, 6 fail → INVALID wrong_key", async () => {
    const ans = await sign({ key: priya }); // Priya's phone signs the request it was shown
    await expectOutcome(verify(ans, { envFrom: PRIYA }), invalid("wrong_key", [2, 6])); // card is still Arjun's
  });

  it("genuine NOT ME arriving 9 s late: only check 1 (time) fails → DENIED late", async () => {
    await expectOutcome(verify(await sign({ decision: "NOT_ME" }), { receivedAt: NINE_S_LATE }), DENIED_LATE);
  });

  it("genuine YES arriving 9 s late: only check 1 (time) fails → NO_RESPONSE late", async () => {
    await expectOutcome(verify(await sign({ decision: "ME" }), { receivedAt: NINE_S_LATE }), NO_RESPONSE_LATE);
  });
});

describe("CRY-07: genuine answers", () => {
  it("genuine YES → VERIFIED with all 7 checks passed", async () => {
    await expectOutcome(verify(await sign({ decision: "ME" })), VERIFIED);
  });

  it("genuine NOT ME → DENIED with all 7 checks passed", async () => {
    await expectOutcome(verify(await sign({ decision: "NOT_ME" })), DENIED);
  });

  it("request B (Devanagari label, no reason, no amount): YES → VERIFIED, NOT ME → DENIED", async () => {
    await expectOutcome(verify(await sign({ req: REQ_B, decision: "ME" }), { req: REQ_B }), VERIFIED);
    await expectOutcome(verify(await sign({ req: REQ_B, decision: "NOT_ME" }), { req: REQ_B }), DENIED);
  });

  it("synced passkey (BE and BS flags set alongside UP and UV) → VERIFIED", async () => {
    await expectOutcome(verify(await sign({ flags: UP | UV | BE | BS })), VERIFIED);
  });

  it("clientData without a crossOrigin field (crossOrigin !== true) → VERIFIED", async () => {
    await expectOutcome(verify(await sign({ clientData: { crossOrigin: undefined } })), VERIFIED);
  });

  it("clientData with an extra field a browser may add → VERIFIED", async () => {
    const ans = await sign({ clientData: { other_keys_can_be_added_here: "do not compare clientDataJSON" } });
    await expectOutcome(verify(ans), VERIFIED);
  });

  it("checks against the expected origin and rpId it is given", async () => {
    const staging = { origin: "https://staging.yourdomain.in", rpId: "staging.yourdomain.in" };
    const ans = await sign({ rpId: staging.rpId, clientData: { origin: staging.origin } });
    await expectOutcome(verify(ans, { expected: staging }), VERIFIED);
    await expectOutcome(verify(await sign(), { expected: staging }), invalid("wrong_app", [4]));
  });
});

describe("CRY-07: a NOT ME must pass all 7 checks to show DENIED", () => {
  const cases: Case[] = [
    {
      name: "a YES changed to NOT ME in transit",
      run: async () => verify({ ...(await sign({ decision: "ME" })), decision: "NOT_ME" }),
      want: invalid("changed", [3]),
    },
    {
      name: "signed without unlock",
      run: async () => verify(await sign({ decision: "NOT_ME", flags: UP })),
      want: invalid("not_unlocked", [5]),
    },
    {
      name: "signed on a look-alike origin",
      run: async () => verify(await sign({ decision: "NOT_ME", clientData: { origin: LOOKALIKE_ORIGIN } })),
      want: invalid("wrong_app", [4]),
    },
    {
      name: "forged with an attacker key",
      run: async () => verify(await sign({ decision: "NOT_ME", key: attacker }), { envFrom: ATTACKER }),
      want: invalid("wrong_key", [2, 6]),
    },
    {
      name: "sent by someone other than the member asked",
      run: async () => verify(await sign({ decision: "NOT_ME" }), { envFrom: PRIYA }),
      want: invalid("wrong_key", [2]),
    },
    {
      name: "signature corrupted",
      run: async () => verify(corruptSignature(await sign({ decision: "NOT_ME" }))),
      want: invalid("bad_signature", [6]),
    },
    {
      name: "nonce already used",
      run: async () => verify(await sign({ decision: "NOT_ME" }), { usedNonces: [REQ.nonce] }),
      want: invalid("reused", [7]),
    },
    {
      name: "unsigned nonce field altered",
      run: async () => verify({ ...(await sign({ decision: "NOT_ME" })), nonce: TAMPERED_NONCE }),
      want: invalid("reused", [1]),
    },
    {
      name: "late and signed without unlock",
      run: async () => verify(await sign({ decision: "NOT_ME", flags: UP }), { receivedAt: NINE_S_LATE }),
      want: invalid("not_unlocked", [1, 5]),
    },
  ];
  for (const c of cases) {
    it(`NOT ME ${c.name} → INVALID ${c.want.reason}`, async () => {
      await expectOutcome(c.run(), c.want);
    });
  }
});

describe("CRY-07: check 1 (fresh) and the late policy (10.7)", () => {
  it("YES received at exactly expiresAt → VERIFIED", async () => {
    await expectOutcome(verify(await sign(), { receivedAt: REQ.expiresAt }), VERIFIED);
  });

  it("YES received 1 ms after expiresAt → NO_RESPONSE late", async () => {
    await expectOutcome(verify(await sign(), { receivedAt: REQ.expiresAt + 1 }), NO_RESPONSE_LATE);
  });

  it("NOT ME received at exactly expiresAt → DENIED, not late", async () => {
    await expectOutcome(verify(await sign({ decision: "NOT_ME" }), { receivedAt: REQ.expiresAt }), DENIED);
  });

  it("NOT ME received 1 ms after expiresAt → DENIED late", async () => {
    await expectOutcome(verify(await sign({ decision: "NOT_ME" }), { receivedAt: REQ.expiresAt + 1 }), DENIED_LATE);
  });

  it("freshness uses this phone's receive time, never the answer's answeredAt", async () => {
    const ans = await sign();
    await expectOutcome(verify({ ...ans, answeredAt: REQ.expiresAt + 60_000 }, { receivedAt: ON_TIME }), VERIFIED);
    await expectOutcome(
      verify({ ...ans, answeredAt: REQ.createdAt }, { receivedAt: REQ.expiresAt + 1 }),
      NO_RESPONSE_LATE,
    );
  });

  it("requestId altered in transit: only check 1 fails → INVALID reused", async () => {
    await expectOutcome(verify({ ...(await sign()), requestId: TAMPERED_REQUEST_ID }), invalid("reused", [1]));
  });

  it("nonce already used: only check 7 fails → INVALID reused", async () => {
    await expectOutcome(verify(await sign(), { usedNonces: [REQ.nonce] }), invalid("reused", [7]));
  });
});

describe("CRY-07: check 2 (key)", () => {
  it("envelope sender is not the request's toDeviceId → INVALID wrong_key", async () => {
    await expectOutcome(verify(await sign(), { envFrom: PRIYA }), invalid("wrong_key", [2]));
  });

  it("saved card's deviceId is not the request's toDeviceId → INVALID wrong_key", async () => {
    await expectOutcome(
      verify(await sign(), { member: { ...cardOf(arjun), deviceId: PRIYA } }),
      invalid("wrong_key", [2]),
    );
  });

  it("answer's credId does not match the saved credId → INVALID wrong_key", async () => {
    const ans = { ...(await sign()), credId: b64url(crypto.getRandomValues(new Uint8Array(16))) };
    await expectOutcome(verify(ans), invalid("wrong_key", [2]));
  });
});

describe("CRY-07: check 3 (exact)", () => {
  const unknownDecisions: Case[] = [
    {
      name: "MAYBE, signed over its own challenge",
      run: async () => verify(await sign({ decision: "MAYBE" })),
      want: invalid("changed", [3]),
    },
    {
      name: "MAYBE, relabelled from a signed YES",
      run: async () => verify({ ...(await sign({ decision: "ME" })), decision: asDecision("MAYBE") }),
      want: invalid("changed", [3]),
    },
    {
      name: "lower-case me, signed over its own challenge",
      run: async () => verify(await sign({ decision: "me" })),
      want: invalid("changed", [3]),
    },
    {
      name: "empty decision, signed over its own challenge",
      run: async () => verify(await sign({ decision: "" })),
      want: invalid("changed", [3]),
    },
  ];
  for (const c of unknownDecisions) {
    it(`unknown decision value (${c.name}) → INVALID changed`, async () => {
      await expectOutcome(c.run(), c.want);
    });
  }

  const alteredBeforeSigning: [string, Partial<CanonicalRequestFields>][] = [
    ["amountInr changed", { amountInr: 500 }],
    ["claimedLabel changed", { claimedLabel: "Arjun (new number)" }],
    ["expiresAt extended", { expiresAt: REQ.expiresAt + 600_000 }],
    ["fromDeviceId changed", { fromDeviceId: ATTACKER }],
  ];
  for (const [name, change] of alteredBeforeSigning) {
    it(`the request Arjun signed had its ${name}: checked against Maa's stored copy → INVALID changed`, async () => {
      await expectOutcome(verify(await sign({ req: { ...REQ, ...change } })), invalid("changed", [3]));
    });
  }

  it("clientData without a challenge → INVALID changed", async () => {
    await expectOutcome(verify(await sign({ clientData: { challenge: undefined } })), invalid("changed", [3]));
  });
});

describe("CRY-07: check 4 (address)", () => {
  it("crossOrigin: true → INVALID wrong_app", async () => {
    await expectOutcome(verify(await sign({ clientData: { crossOrigin: true } })), invalid("wrong_app", [4]));
  });

  for (const type of ["webauthn.create", undefined]) {
    it(`clientData type ${type ?? "missing"} → INVALID wrong_app`, async () => {
      await expectOutcome(verify(await sign({ clientData: { type } })), invalid("wrong_app", [4]));
    });
  }

  for (const origin of [
    "https://app.yourdomain.in.evil.example",
    "http://app.yourdomain.in",
    "https://app.yourdomain.in:8443",
    "https://yourdomain.in",
    undefined,
  ]) {
    it(`clientData origin ${origin ?? "missing"} → INVALID wrong_app`, async () => {
      await expectOutcome(verify(await sign({ clientData: { origin } })), invalid("wrong_app", [4]));
    });
  }

  for (const rpId of ["evil.example", "yourdomain.in", ORIGIN]) {
    it(`authenticatorData rpIdHash of "${rpId}" (signed that way) → INVALID wrong_app`, async () => {
      await expectOutcome(verify(await sign({ rpId })), invalid("wrong_app", [4]));
    });
  }

  it("rpIdHash altered in transit: checks 4, 6 fail → INVALID wrong_app", async () => {
    const ans = withAuthData(await sign(), (ad) => {
      ad[0] = ad[0]! ^ 0x80;
    });
    await expectOutcome(verify(ans), invalid("wrong_app", [4, 6]));
  });
});

describe("CRY-07: check 5 (unlocked)", () => {
  it("UP missing (UV only) → INVALID not_unlocked", async () => {
    await expectOutcome(verify(await sign({ flags: UV })), invalid("not_unlocked", [5]));
  });

  it("no flags at all → INVALID not_unlocked", async () => {
    await expectOutcome(verify(await sign({ flags: 0 })), invalid("not_unlocked", [5]));
  });

  it("UP cleared in transit on a genuine answer: checks 5, 6 fail → INVALID not_unlocked", async () => {
    const ans = withAuthData(await sign(), (ad) => {
      ad[32] = ad[32]! & ~UP;
    });
    await expectOutcome(verify(ans), invalid("not_unlocked", [5, 6]));
  });
});

describe("CRY-07: check 6 (signature)", () => {
  it("one bit of the signature flipped → INVALID bad_signature", async () => {
    await expectOutcome(verify(corruptSignature(await sign())), invalid("bad_signature", [6]));
  });

  it("signature taken from Arjun's genuine NOT ME for the same request → INVALID bad_signature", async () => {
    const yes = await sign({ decision: "ME" });
    const no = await sign({ decision: "NOT_ME" });
    await expectOutcome(verify({ ...yes, signature: no.signature }), invalid("bad_signature", [6]));
  });

  it("raw r‖s instead of DER → INVALID bad_signature", async () => {
    const ans = await sign();
    const raw = derToRaw(b64urlDecode(ans.signature));
    await expectOutcome(verify({ ...ans, signature: b64url(raw) }), invalid("bad_signature", [6]));
  });

  it("DER signature with a trailing extra byte → INVALID bad_signature", async () => {
    const ans = await sign();
    const der = concat(b64urlDecode(ans.signature), new Uint8Array([0]));
    await expectOutcome(verify({ ...ans, signature: b64url(der) }), invalid("bad_signature", [6]));
  });

  it("empty signature → INVALID bad_signature", async () => {
    await expectOutcome(verify({ ...(await sign()), signature: "" }), invalid("bad_signature", [6]));
  });

  it("verified against the saved key only: a card holding another key → INVALID bad_signature", async () => {
    const card = { ...cardOf(arjun), passkeyPub: priya.passkeyPub };
    await expectOutcome(verify(await sign(), { member: card }), invalid("bad_signature", [6]));
  });
});

describe("CRY-07: malformed clientDataJSON (genuinely signed, so only checks 3 and 4 can fail)", () => {
  const malformed: [string, () => Promise<Uint8Array>][] = [
    ["not JSON at all", async () => utf8("not json")],
    [
      "truncated JSON",
      async () => {
        const full = JSON.stringify({
          type: "webauthn.get",
          challenge: b64url(await challengeFor(REQ, "ME")),
          origin: ORIGIN,
          crossOrigin: false,
        });
        return utf8(full.slice(0, -1));
      },
    ],
    ["JSON null", async () => utf8("null")],
    ["a JSON array", async () => utf8("[]")],
    ["a JSON string", async () => utf8('"webauthn.get"')],
    ["a JSON number", async () => utf8("42")],
    ["bytes that are not UTF-8", async () => new Uint8Array([0xff, 0xfe, 0xfd])],
    ["empty", async () => new Uint8Array(0)],
  ];
  for (const [name, bytes] of malformed) {
    it(`clientDataJSON ${name} → INVALID wrong_app, never throws`, async () => {
      await expectOutcome(verify(await sign({ clientDataJSON: await bytes() })), invalid("wrong_app", [3, 4]));
    });
  }
});

describe("CRY-07: authenticatorData under 37 bytes (genuinely signed)", () => {
  for (const len of [0, 1, 31, 32, 33, 36]) {
    it(`authenticatorData of ${len} bytes → INVALID, never throws`, async () => {
      const full = await authDataFor(RP_ID, UP | UV);
      const r = await verify(await sign({ authData: full.slice(0, len) }));
      const s = summary(r);
      expect(s.verdict).toBe("INVALID");
      expect(s.failed.filter((n) => n === 1 || n === 2 || n === 3 || n === 7)).toEqual([]); // they never read it
      if (len < 32) expect(s.failed).toContain(4); // no complete rpIdHash
      if (len <= 32) expect(s.failed).toContain(5); // no flags byte
      expect(s.reason).toBe(topReason(s.failed));
      expectShape(r);
    });
  }
});

describe("CRY-07: invalid base64url never verifies and never throws", () => {
  const badText: [string, (v: string) => string][] = [
    ["a character outside the alphabet", (v) => v.slice(0, 4) + "!" + v.slice(5)],
    ["a standard-base64 '+'", (v) => v.slice(0, 4) + "+" + v.slice(5)],
    ["'=' padding appended", (v) => v + "="],
    ["a leading space", (v) => " " + v],
    ["a non-ASCII character", (v) => v.slice(0, 4) + "é" + v.slice(5)],
    ["an impossible length", () => "AAAAA"],
  ];
  const fields: ["signature" | "clientDataJSON" | "authenticatorData", Outcome][] = [
    ["signature", invalid("bad_signature", [6])],
    ["clientDataJSON", invalid("wrong_app", [3, 4, 6])],
    ["authenticatorData", invalid("wrong_app", [4, 5, 6])],
  ];
  for (const [field, want] of fields) {
    for (const [name, spoil] of badText) {
      it(`${field} with ${name} → INVALID ${want.reason}`, async () => {
        const ans = await sign();
        await expectOutcome(verify({ ...ans, [field]: spoil(ans[field]) }), want);
      });
    }
  }

  it("authenticatorData with non-canonical trailing bits (same bytes under a lenient decoder) → INVALID", async () => {
    const ans = await sign();
    const spoiled = { ...ans, authenticatorData: withStrayBits(ans.authenticatorData) };
    await expectOutcome(verify(spoiled), invalid("wrong_app", [4, 5, 6]));
  });
});

describe("CRY-07: the reason is the highest-priority failure (reused › wrong_key › wrong_app › changed › …)", () => {
  const cases: Case[] = [
    {
      name: "reused › wrong_key: used nonce and a mismatched credId",
      run: async () => verify({ ...(await sign()), credId: attacker.credId }, { usedNonces: [REQ.nonce] }),
      want: invalid("reused", [2, 7]),
    },
    {
      name: "reused › wrong_key: altered requestId from the wrong sender",
      run: async () => verify({ ...(await sign()), requestId: TAMPERED_REQUEST_ID }, { envFrom: PRIYA }),
      want: invalid("reused", [1, 2]),
    },
    {
      name: "wrong_key › wrong_app: mismatched credId and crossOrigin true",
      run: async () => verify({ ...(await sign({ clientData: { crossOrigin: true } })), credId: attacker.credId }),
      want: invalid("wrong_key", [2, 4]),
    },
    {
      name: "wrong_app › changed: decision flipped on an answer of the wrong type",
      run: async () =>
        verify({ ...(await sign({ decision: "NOT_ME", clientData: { type: "webauthn.create" } })), decision: "ME" }),
      want: invalid("wrong_app", [3, 4]),
    },
    {
      name: "changed › not_unlocked: decision flipped on an answer signed without unlock",
      run: async () => verify({ ...(await sign({ decision: "NOT_ME", flags: UP })), decision: "ME" }),
      want: invalid("changed", [3, 5]),
    },
    {
      name: "not_unlocked › bad_signature: signed without unlock and signature corrupted",
      run: async () => verify(corruptSignature(await sign({ flags: UP }))),
      want: invalid("not_unlocked", [5, 6]),
    },
    {
      name: "bad_signature › expired: a late YES with a corrupted signature",
      run: async () => verify(corruptSignature(await sign()), { receivedAt: NINE_S_LATE }),
      want: invalid("bad_signature", [1, 6]),
    },
    {
      name: "reused › expired: a late YES whose nonce is already used",
      run: async () => verify(await sign(), { receivedAt: NINE_S_LATE, usedNonces: [REQ.nonce] }),
      want: invalid("reused", [1, 7]),
    },
    {
      name: "a late answer with an altered nonce is reused, not late",
      run: async () => verify({ ...(await sign()), nonce: TAMPERED_NONCE }, { receivedAt: NINE_S_LATE }),
      want: invalid("reused", [1]),
    },
    {
      name: "everything wrong at once → reused",
      run: async () => {
        const forged = await sign({
          key: attacker,
          decision: "NOT_ME",
          flags: 0,
          clientData: { origin: LOOKALIKE_ORIGIN },
        });
        return verify(
          { ...forged, decision: "ME", nonce: TAMPERED_NONCE },
          { envFrom: ATTACKER, receivedAt: NINE_S_LATE, usedNonces: [TAMPERED_NONCE] },
        );
      },
      want: invalid("reused", [1, 2, 3, 4, 5, 6, 7]),
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      await expectOutcome(c.run(), c.want);
    });
  }
});
