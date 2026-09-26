# Handover: replacing the simulations (spec Part E)

When the frontend passes the Part D walkthrough (`npm run e2e`), the team swaps the simulated
services for real ones. **No screen should need to change** — screens only use the interfaces in
`src/services/types.ts`.

## What to replace

| Replace | With | File to fill in |
| --- | --- | --- |
| `SimRelay` | WebSocket client to the team's relay | `src/services/real/RealRelay.ts` |
| `SimKey` | WebAuthn passkeys | `src/services/real/RealKey.ts` |
| `SimVerifier` | **written by the team** (~80 lines) | `src/services/real/RealVerifier.ts` |
| `SimLab` | the relay's test-environment lab channel | `src/services/real/RealLab.ts` |
| `SimGuard` (mic) | optional: a better speech-to-text engine | `src/services/real/RealGuard.ts` |
| Flags | `VITE_SIMULATION=false` | `.env` |
| Domain | one fixed HTTPS domain (passkeys are bound to it — never change it after keys exist) | hosting |

Each real file already contains a comment block describing its job. They currently throw
`Not implemented: team-owned`; `services/index.ts` never constructs them while simulating.

## Interface methods, including the documented extensions

Methods marked *ext* go beyond the spec's B3 listing; they are small and exist for Diagnostics,
the Lab and Call Guard. The screens depend on them, so the real classes must provide them too.

**RelayService** — `connect`, `onState`, `onPresence`, `sendRequest`, `onRequest`, `sendAnswer`,
`onAnswer`, `sendAlert`, `onAlert`, `sendGuardPrompt`, `onGuardPrompt`, plus *ext*:
`announce({ name, kind, canBeVerified })` (sent with the presence heartbeat), `onPeers(cb)`,
`getState()`, `ping()` (round-trip ms), `reconnect()`, `address()`, `lastMessageAt()`,
`reportVerdict({ requestId, verdict, invalidReason, failedChecks })` (send to the lab channel in the
test environment only; ignore it in production).

Requirements from the spec: reconnect with backoff 1, 2, 4, 8 s then every 8 s; heartbeat every
2 s; reachable = seen in the last 6 s; emit `reconnecting` while retrying, `offline` when the
browser is offline; while reconnecting, queue sends; while offline, reject sends
(`RelayError("offline")` from `services/errors.ts`) so the app fails closed.

**KeyService** — `checkSupport`, `createKey`, `signAnswer`, `deleteKey`, plus *ext*
`createPinKey({ deviceId, name, pin })` for A6's “6-digit Pehchaan PIN” fallback (optional: if
absent, the PIN path can't finish). Throw `KeyError("cancelled")` when the person cancels the
system sheet — F5 and A6 rely on it. Derive safety words with `safetyWordsFor(spkiBase64url)` from
`services/words.ts` so both phones show the same four words.

**VerifierService** — `verify(req, ans, member)`, plus *ext* `resetUsedNonces()` (Diagnostics).

**LabService** — the six spec methods plus *ext* `start`, `stop`, `onStatus`, `onPeers`,
`setRoles`, `attackLog`, `clearLog` (see `SimLab.ts` for the exact behaviour, e.g. an armed
attack fires on the next check and then disarms).

**GuardService** — the four spec methods plus *ext* `setNames`, `next` (scripted mode), `onLevel`
(0..1 audio level for the waveform), `micSupported`. Keep the keyword rules: pass each final
transcript line through `analyzeLine()` + `accumulate()` in `services/guard/rules.ts`.

**Data model extensions** (all optional fields): `Profile.keyCreatedAt / keyKind`,
`FamilyMember.lastCheckedAt`, `VerifyRequest.fromPhone`, `CheckResult.params`,
`VerdictResult.answeredAt`, `FamilyAlert.aboutDeviceId / victimDeviceId / aboutPhone / resolved`,
`HistoryEvent` timeline fields, `RelayEvent.kind: "guard"` and `requestId`.

## RealVerifier checklist (the Ownership centrepiece)

Build each check with `makeCheck(n, passed, { detail, params })` and finish with
`finalizeVerdict({ ...decideVerdict(checks, ans.decision, expired), … })` from
`services/verdict.ts`. That keeps every INVALID reason identical to the simulation, and it's the
only way a VERIFIED result can be stored (`assertMayPersist`).

1. **fresh** — the request is ours and still `pending` (`db.outgoing`), the answer's nonce equals
   the request's, and `now <= expiresAt`. Params: `{ n: secondsSinceCreated }`.
2. **key** — the credential id is the one saved for this member. Params: `{ name: member.label }`.
3. **exact** — recompute `challenge = SHA-256(canonical(request) ‖ "|" ‖ decision)` for the
   decision the answer claims; it must equal the challenge inside `clientDataJSON`.
4. **address** — `clientData.type === "webauthn.get"`, `clientData.origin === location.origin`,
   and `authenticatorData.rpIdHash === SHA-256(rpId)`.
5. **unlocked** — the UP and UV flags are set.
6. **signature** — ECDSA P-256/SHA-256 over `authenticatorData ‖ SHA-256(clientDataJSON)` with the
   member's SPKI key (convert the DER signature to raw r‖s first).
7. **unused** — the nonce isn't in `db.usedNonces`; then add it.

**Canonical request format** (the key and the verifier must agree): JSON with keys sorted
alphabetically, no whitespace, containing `v`, `requestId`, `nonce`, `fromDeviceId`, `toDeviceId`,
`claimedLabel`, `reason` (if set), `amountInr` (if set), `createdAt`, `expiresAt`. Append `|` and
the decision before hashing.

The unit tests in `tests/unit/verifier.test.ts` describe the required behaviour for every reason.
To run them against the real verifier, add a variant of that file that builds real WebAuthn-shaped
answers (or recorded test vectors).

## Before judging day

- Run `npm run e2e` against real phones on the real relay (Part D step 14 on actual devices).
- Run at least 50 attacks from the Security Lab and export the log.
- Every teammate walks through `RealVerifier` line by line.
- Build with `VITE_SIMULATION=false` and confirm the “Simulated network” badge is gone.
- Have a native Hindi speaker review `src/i18n/hi.json`.
