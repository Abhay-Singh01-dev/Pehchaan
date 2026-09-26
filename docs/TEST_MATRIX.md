# Test matrix

Every rule in `docs/BACKEND_SPEC.md` has a row: every Part E test ID, plus every "must", "never", limit, error code,
TTL and table row in Part C that Part E doesn't name (rows `C-…`). `scripts/check-test-matrix.mjs` fails if a row
is neither ✅ nor `manual`.

Status: ✅ passing · ⏳ planned (phase shown) · `manual` covered by the named E4 real-phone step.

Paths: `crypto` = `packages/crypto/test`, `protocol` = `packages/protocol/test`, `relay` = `apps/relay/test`,
`web` = `apps/web/tests/unit`, `e2e` = `tests/e2e`, `ops` = `tests/ops`, `sec` = `tests/security`, `chaos` = `tests/chaos`.

## CRY · packages/crypto (unit, 100% coverage)

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| CRY-01 | 10.1 | Canonical JSON: sorted keys (recursive), undefined omitted, no whitespace, non-integers throw, Devanagari raw | crypto/canonical.test.ts › canonical JSON | unit | 2 | ✅ |
| CRY-02 | 10.2 | The 10.2 vectors reproduce exactly (both canonicals, 4 challenges, rpIdHash) | crypto/vectors.test.ts › spec 10.2 vectors | unit | 2 | ✅ |
| CRY-03 | 10.2 | Property: changing any signed field or the decision changes the challenge | crypto/canonical.test.ts › challenge binds every field | property | 2 | ✅ |
| CRY-04 | 5.2 | deviceIdFrom: 22 chars, deterministic, distinct keys → distinct IDs | crypto/device-auth.test.ts › deviceIdFrom | unit | 2 | ✅ |
| CRY-05 | 7.3 | Login signature valid; wrong host/nonce/id, bad key length/prefix, id≠key → rejected | crypto/device-auth.test.ts › verifyAuth | unit | 2 | ✅ |
| CRY-06 | 10.6 | derToRaw round-trips 1,000 real signatures; rejects short, long, wrong tag, extra bytes, bad 33-byte int, zero length | crypto/der.test.ts › derToRaw | unit | 2 | ✅ |
| CRY-07 | 10.5 | Every 10.5 table row + crossOrigin, wrong type, wrong rpIdHash, UP missing, YES at expiresAt / +1 ms, malformed clientDataJSON, short authData, bad base64url, unknown decision | crypto/verifier.table.test.ts (independent agent) + verifier.test.ts | unit | 2 | ✅ |
| CRY-08 | 10.5 | Property: the reason is always the highest failed reason in the priority order | crypto/verifier.property.test.ts › reason priority | property | 2 | ✅ |
| CRY-09 | 10.5 | Property: 10,000 random mutations of a valid answer never VERIFIED unless nothing changed | crypto/verifier.property.test.ts › mutations | property | 2 | ✅ |
| CRY-10 | 9.2–9.3 | E2E round trip; each header field, ct, iv, epk, sig, alg changed → tampered; spoofed sender; saved-key mismatch; relay re-seal forgery; wrong recipient key | crypto/e2e.test.ts | unit | 2 | ✅ |
| CRY-11 | 9.5 | psig valid; payload changed; header changed → rejected | crypto/plain-sig.test.ts | unit | 2 | ✅ |
| CRY-12 | 6.3 | Safety words deterministic; 4 BIP-39 words; any key change → different words; PBKDF2 600,000; never read from the card | crypto/safety-words.test.ts | unit | 2 | ✅ |
| CRY-13 | 10.8 | Confirmation words identical on both sides; (r, n−s) rewrite doesn't change them | crypto/confirm-words.test.ts | unit | 2 | ✅ |
| CRY-14 | 6.1, 6.5 | Card v2 encode/decode; each 6.1 validation failure; every 6.5 guard row | crypto/card.test.ts | unit | 2 | ✅ |
| C-6.3a | 6.3 | The BIP-39 English list is vendored with its checksum and has 2048 entries | crypto/safety-words.test.ts › wordlist checksum | unit | 2 | ✅ |
| C-10.6a | 10.6, B5 | verifier.ts stays under ~150 lines with one comment per check | crypto/verifier.size.test.ts | unit | 2 | ✅ |
| C-4a | 4 | packages/crypto uses WebCrypto only and has no dependencies | crypto/package.test.ts › no dependencies | unit | 2 | ✅ |

## PRO · packages/protocol

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| PRO-01 | 7.2–7.4, 14.2, 16.2 | Every message and payload: valid sample passes; unknown fields, oversize strings, bad IDs rejected | protocol/schemas.test.ts | unit | 2 | ✅ |
| PRO-02 | 7.2 | Fuzz: random JSON never crashes the parser | protocol/fuzz.test.ts | property | 2 | ✅ |
| PRO-03 | 4, B5 | The relay and the app import the same schema module | protocol/single-source.test.ts | unit | 2 | ✅ |
| C-7.2a | 7.2 | Unknown `t` values are rejected by the outer envelope | protocol/schemas.test.ts › unknown t | unit | 2 | ✅ |
| PRO-02b | 7.2, E5 | Regression (found in Phase 2): a relay frame whose `t` names an Object prototype member ("toString") is ignored, not a crash | protocol/schemas.test.ts › returns null for unknown types, bad bodies and non-JSON | unit | 2 | ✅ |
| C-7.5a | 7.5 | Error and close code tables are exported exactly | protocol/codes.test.ts | unit | 2 | ✅ |
| C-16.2a | 16.2 | Limits (16 KiB frame, 8 KiB ct, 50 presence IDs, 50 inbox, ID formats) are exported constants | protocol/limits.test.ts | unit | 2 | ✅ |

## REL · relay (integration, real Valkey + Postgres, two gateways)

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| REL-01 | 7.1, 16.2 | Bad Origin 403; wrong subprotocol 426; binary 1003; 16–64 KiB `too_large`; >64 KiB 1009; 3 bad frames/min 4400; conn rate 4429; >1 MiB buffered 1008; no compression; MAX_SOCKETS → /readyz 503 + upgrade 503 | relay/upgrade.int.test.ts › REL-01 · accepting a WebSocket, MAX_SOCKETS | integration | 3 | ✅ |
| REL-02 | 7.3 | hello fields; valid auth.ok; bad sig 4401; reused nonce fails; 10 s → 4408; retired/blocked 4403; old client 4426; pre-auth `unauthenticated` | relay/login.int.test.ts › REL-02 · login | integration | 3 | ✅ |
| REL-03 | 7.1 | Ping every 25 s; 2 missed pongs → terminated; app ping → pong | relay/sockets.int.test.ts › REL-03 · heartbeats | integration | 3 | ✅ |
| REL-04 | 7.1 | ≤3 sockets per device; 4th closes oldest 4409; deliveries reach all; first ack counts | relay/sockets.int.test.ts › REL-04 · up to 3 sockets per device | integration | 3 | ✅ |
| REL-05 | 8.2, 15.4 | Same-gateway and cross-gateway routing; dead gateway cleaned lazily; routes rebuilt after Valkey restart | relay/delivery.int.test.ts › REL-05 · routing | integration | 3 | ✅ |
| REL-06 | 8.3, 8.5 | Offline → queued; drained soonest-expiry first; ack removes; expired dropped; 50 cap; ttlMs rewritten | relay/delivery.int.test.ts › REL-06 · the inbox | integration | 3 | ✅ |
| REL-07 | 8.4 | Every receipt state in its situation (pushed/failed: Phase 6) | relay/receipts.int.test.ts | integration | 3, 6 | ⏳ |
| REL-08 | 8.4 | Same message id re-sent → routed once, same receipt | relay/delivery.int.test.ts › REL-08 · the same message id re-sent | integration | 3 | ✅ |
| REL-09 | 8.1 | Record created; duplicate_request; deadline on relay clock clamped 10–60 s; record TTL | relay/requests.int.test.ts › REL-09 · request records | integration | 3 | ✅ |
| REL-10 | 8.6, 8.8 | Answer authorisation; not_allowed/already_answered/cancelled/expired; ok_late with late:true; 50-way race → one ok | relay/requests.int.test.ts › REL-10 · answers (incl. the 50-way race) | integration | 3 | ✅ |
| REL-11 | 8.6 | Cancel only by asker; targets get verify.cancel; state cancelled | relay/requests.int.test.ts › REL-11 · cancel | integration | 3 | ✅ |
| REL-12 | 8.3 | No ack in 1.5 s → push, only for kinds that allow it | relay/push-fallback.int.test.ts | integration | 6 | ⏳ |
| REL-13 | 18.9 | Drain: /readyz 503 → 6 s → spread reconnect → 1012; zero envelopes lost | relay/drain.int.test.ts › REL-13 · drain | integration | 3 | ✅ |
| REL-14 | 7.5 | Every error code produced by a test | relay/errors.int.test.ts (+ aggregation) | integration | 3, 7, 8 | ⏳ |
| REL-15 | 16.3 | One test per authorisation row | relay/authz.int.test.ts | integration | 3, 7, 8 | ⏳ |
| REL-16 | 16.1 | Every rate-limit row; GCRA burst then steady; CGNAT not blocked | relay/ratelimit.int.test.ts › REL-16 · the 16.1 table, GCRA over time, CGNAT | integration | 3 | ✅ |
| REL-17 | 16.1 | 4th open request refused | relay/requests.int.test.ts › REL-17 · a 4th open request | integration | 3 | ✅ |
| REL-18 | 9.5 | E2E_REQUIRED: plain → e2e_required unless both Lab-opted-in | relay/e2e-required.int.test.ts | integration | 8 | ⏳ |
| REL-19 | 15.5, 23 | Valkey down → unavailable; Postgres down cold → unavailable; warm → works | relay/health.int.test.ts › REL-19 · fail closed + errors.int.test.ts › unavailable | integration | 3 | ✅ |
| REL-20 | 18.7 | Invalid configuration exits with a clear message | relay/unit/config.test.ts › REL-20 · configuration | unit | 3 | ✅ |
| REL-21 | 16.2 | X-Forwarded-For honoured only from TRUST_PROXY | relay/upgrade.int.test.ts › REL-21 · X-Forwarded-For only from TRUST_PROXY | integration | 3 | ✅ |
| REL-22 | 16.7 | Logs during full flows contain no payload, nonce, signature, grant, endpoint, name, label, phone | relay/log-leak.int.test.ts › REL-22 · no personal data or secrets in logs | integration | 3, 9 | ✅ |
| REL-23 | 19.1 | /metrics exposes every 19.1 metric; no device-ID labels | relay/metrics.int.test.ts | integration | 9 | ⏳ |
| REL-24 | 18.9 | /healthz vs /readyz (readiness fails when draining or Valkey down) | relay/health.int.test.ts › REL-24 · health and readiness | integration | 3 | ✅ |
| C-7.3a | 7.3 | devices row upserted at login, at most one write per device per day | relay/login.int.test.ts › C-7.3a · the devices row | integration | 3 | ✅ |
| C-7.3b | 7.3 | relayHost comes from RELAY_HOST, never the Host header | relay/login.int.test.ts › C-7.3b · a login signed for another relay host fails | integration | 3 | ✅ |
| C-7.1a | 7.1 | Unauthenticated sockets ≤20 per IP (see SEC-07) | relay/upgrade.int.test.ts › C-7.1a / SEC-07 · caps unauthenticated sockets per IP | integration | 3 | ✅ |
| C-8.3a | 8.3 | Inbox TTL per kind (request: deadline; answer: +30 s; cancel 60 s; alert 24 h; prompt 2 min) | relay/delivery.int.test.ts › C-8.3a · how long each kind waits | integration | 3 | ✅ |
| C-8.4a | 8.4 | dd:<from>:<id> kept 5 min | relay/delivery.int.test.ts › REL-08 · re-sends are deduplicated for 5 minutes | integration | 3 | ✅ |
| C-8.6a | 8.6 | Other targets get verify.cancel{answered_elsewhere} | relay/requests.int.test.ts › C-8.6a · answered_elsewhere | integration | 3 | ✅ |
| C-15.1a | 15.1 | Keyspace TTLs: gw alive 30 s, rt 24 h, rq deadline+90 s, cfg:lab 12 h, oq 2 min, caches 10 min | relay/keyspace.int.test.ts › C-15.1a + data.int.test.ts › lab on/off (cfg:lab 12 h) | integration | 3, 4, 7 | ✅ |
| C-15.1b | 15.1 | Multi-key Lua scripts use hash-tagged keys | relay/keyspace.int.test.ts › C-15.1b · hash tags | integration | 3 | ✅ |
| C-15.1c | 15.1 | Pub/sub behind a bus interface (PUBLISH or SPUBLISH) | relay/keyspace.int.test.ts › C-15.1c · the bus | integration | 3 | ✅ |
| C-B5a | B5 | Every Lua script in its own file with a header comment, loaded with defineCommand | relay/unit/lua.test.ts › C-B5a · Lua scripts | unit | 3 | ✅ |
| C-B5b | B5 | Authorisation lives in core/authz.ts, one function per 16.3 row | relay/errors.int.test.ts › REL-15 / C-B5b · one function per row | unit | 3 | ✅ |
| C-4b | 4 | The relay never imports crypto/verifier or crypto/e2e (depcruise) | relay/unit/depcruise.test.ts › fails when the relay imports packages/crypto/verifier | static | 1 | ✅ |
| C-7.6a | 7.6 | Outbound notices: the app ignores unknown fields | web/relay-frames.test.ts › lenient outbound | unit | 5 | ⏳ |

## CON · contacts, devices, data

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| CON-01 | 6.4 | grant.set stores only the hash; rotate revokes older grants | relay/contacts.int.test.ts › CON-01 · grants | integration | 3 | ✅ |
| CON-02 | 6.4 | Valid grant creates binding; invalid or none → not_allowed | relay/contacts.int.test.ts › CON-02 · first contact | integration | 3 | ✅ |
| CON-03 | 6.4 | Revoked sender refused even with valid grant; unrevoke works; revoked row survives the blocked device retiring | relay/contacts.int.test.ts › CON-03 · revocation | integration | 3, 4 | ✅ |
| CON-04 | 6.6 | Retire: tombstone; logins 4403; exact deletions; revoked rows kept | relay/data.int.test.ts › CON-04 · retire | integration | 4 | ✅ |
| CON-05 | 6.4 | 50 bindings per target; 20 new per day per target and per sender | relay/data.int.test.ts › CON-05 · binding limits | integration | 4 | ✅ |
| CON-06 | 12 | Presence online/push/offline; strangers offline; no timestamps | relay/data.int.test.ts › CON-06 / SEC-12 · presence | integration | 4 | ✅ |
| CON-07 | 6.4, 17 | contact.list correct; schema has no name or phone columns | relay/data.int.test.ts › CON-07 · contact.list, and no personal data in the schema | integration | 4 | ✅ |
| CON-08 | 15.5 | Caches invalidated on change; cold-cache DB error fails closed | relay/data.int.test.ts › CON-08 · caches + health.int.test.ts › REL-19 | integration | 4 | ✅ |
| CON-09 | 15.3 | Retention job per 15.3; inactive devices tombstoned after 12 months | relay/data.int.test.ts › CON-09 · retention (time travel) | integration | 4 | ✅ |
| CON-10 | 15.2 | Migrations apply from empty; destructive migrations rejected unless marked contract | relay/data.int.test.ts › CON-10 · migrations + scripts/check-migrations.mjs (CI) | integration | 4 | ✅ |
| CON-11 | 15.4 | Wipe Valkey → recovers; wipe allowed bindings → rebuilt from the grant | relay/data.int.test.ts › CON-11 · self-healing + delivery.int.test.ts › REL-05 | integration | 4 | ✅ |
| CON-12 | 16.8 | Admin: block (4403 on every gateway), unblock, retire, stats, lab on/off | relay/data.int.test.ts › CON-12 · admin CLI | integration | 4 | ✅ |
| CON-13 | 15.2, 16.7 | Every audit event kind written with an HMAC subject | relay/data.int.test.ts › CON-13 · audit events | integration | 4 | ✅ |
| C-6.4a | 6.4 | A revoked binding can't be recreated with any grant; only contact.unrevoke by the target | relay/contacts.int.test.ts › CON-03 · a revoked sender is refused … unrevoke | integration | 3 | ✅ |
| C-6.4b | 6.4 | Answers need no binding (authorised by the request record) | relay/requests.int.test.ts › C-6.4b · the answerer needs no binding | integration | 3 | ✅ |
| C-16.8a | 16.8 | Automatic abuse signals written to audit_events (rate-limit burst, >10 bindings/day) | relay/data.int.test.ts › C-16.8a · automatic abuse signals | integration | 4 | ✅ |

## PSH · Web Push (mock push service)

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| PSH-01 | 11.3 | Allowlisted hosts accepted; http:, localhost, 169.254.169.254, internal names rejected | relay/push.int.test.ts › allowlist | integration | 6 | ⏳ |
| PSH-02 | 11.3 | TTL, Urgency high, Topic only with re (≤32 url-safe); VAPID JWT valid; payload decrypts (RFC 8291) | relay/push.int.test.ts › headers | integration | 6 | ⏳ |
| PSH-03 | 11.3 | 201, 404/410, 413 (wake), 429 (Retry-After), 403, 400, 5xx/timeout handled per table | relay/push.int.test.ts › responses | integration | 6 | ⏳ |
| PSH-04 | 11.4 | ≤3,000 B inside push; larger → wake; /v1/inbox/fetch signed, fresh, rate-limited, CORS app origin only | relay/push.int.test.ts › wake + fetch | integration | 6 | ⏳ |
| PSH-05 | 11.8 | push.test arrives after 10 s; 4th in an hour refused | relay/push.int.test.ts › push.test | integration | 6 | ⏳ |
| PSH-06 | 11.9 | Each subscription pushed with its own VAPID key; mismatch → re-subscribe | relay/push.int.test.ts › rotation + web/push.test.ts | integration | 6 | ⏳ |
| PSH-07 | 11.5–11.6 | SW notification options per kind; silent and vibrate never together; tag and URL | web/sw-describe.test.ts | unit | 6 | ⏳ |
| PSH-08 | 11.6 | Lock-screen text never contains an amount or reason | web/sw-describe.test.ts › no amounts | property | 6 | ⏳ |
| C-11.2a | 11.2 | auth.ok pushStatus expired/missing + permission granted → silent re-subscribe | web/push.test.ts › refresh | unit | 6 | ⏳ |
| C-11.2b | 11.2 | pushsubscriptionchange → POST /v1/push/resubscribe (signed) | relay/push.int.test.ts › resubscribe | integration | 6 | ⏳ |
| C-11.5a | 11.5 | Every push shows a notification; the app closes it once F1 is shown | web/sw-describe.test.ts › always notify | unit | 6 | ⏳ |
| C-11.3a | 11.3 | topicFor = first 32 chars of b64url(SHA-256(requestId)); cancel shares the request's topic | relay/push.int.test.ts › topic | integration | 6 | ⏳ |

## APP · frontend with the real backend

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| APP-01 | 22 FC-1 | Every SIM_RELAY/SIM_KEY/SIM_VERIFIER combination works | web/services-matrix.test.ts + e2e/combinations.spec.ts | unit+e2e | 5 | ⏳ |
| APP-02 | 5.1–5.4 | deviceId derived from key; keys non-extractable, persisted; storage.persist() called | web/identity.test.ts | unit | 5 | ⏳ |
| APP-03 | 6.1 | Card v2 QR/link round trip; each validation error message; words derived locally | web/card.test.ts + e2e/cards.spec.ts | unit+e2e | 5 | ⏳ |
| APP-04 | 6.5 | Every new-phone guard row in the UI | e2e/new-phone.spec.ts | e2e | 5 | ⏳ |
| APP-05 | 10.3–10.4 | Passkey created (virtual authenticator); UV required; errors map to A6/F5; no await before credentials.get | web/real-key.test.ts + e2e/passkey.spec.ts | unit+e2e | 5 | ⏳ |
| APP-06 | 10.5, 9.4 | Every verdict and reason reachable; skipped checks for an unreadable seal (Phase 8) | web/verification.test.ts + e2e/verdicts.spec.ts | unit+e2e | 5, 8 | ⏳ |
| APP-07 | 10.5, 10.9 | Nonce marked right after verdict/cancel; after timeout only when the late window closes; pruned after 30 days | web/nonces.test.ts | unit | 5 | ⏳ |
| APP-08 | 8.4–8.10 | Backoff with jitter; outbox same id; sendRequest resolves on accepted / rejects after 5 s; receipts drive D3 and "Family alerted"; tombstones; dedupe; push inbox; clock offset display-only | web/real-relay.test.ts | unit | 5, 6, 7 | ⏳ |
| APP-09 | 22.1 | Every new state: D3 status line, not_allowed ending, F1 skew, F1 cancelled, E3 late line, E2 late meta, D1 hint, Privacy, C7 revoke/reset, Diagnostics fields, 4426 update prompt, A6 checks-only, F1 drops mis-addressed | e2e/states.spec.ts + web units | e2e | 5 | ⏳ |
| APP-10 | 10.8 | Confirmation words identical on both phones | e2e/journeys.spec.ts › J-02 | e2e | 5 | ⏳ |
| APP-11 | B0 | Every i18n key in en and hi; no banned word | web/i18n.test.ts + scripts/check-banned-words.mjs | unit | 5 | ⏳ |
| APP-12 | 16.5 | Security headers; meta CSP names the relay; fonts self-hosted; no third-party requests except relay + Sentry | web/headers.test.ts + e2e/third-party.spec.ts | unit+e2e | 9 | ⏳ |
| APP-13 | 16.7 | Sentry scrubber removes every 16.7 field | web/sentry.test.ts | unit | 9 | ⏳ |
| APP-14 | 21.3 | The whole frontend Part D walkthrough against the real backend | e2e/walkthrough.spec.ts | e2e | 5 | ⏳ |
| C-5.4a | 5.4 | "Delete my key" calls signalUnknownCredential where supported | web/real-key.test.ts › signalUnknownCredential | unit | 5 | ⏳ |
| C-8.9a | 8.9 | Reconnect immediately on online, visibility visible, notification click; reconnect{afterMs} honoured | web/real-relay.test.ts › reconnect triggers | unit | 5 | ⏳ |
| C-8.9b | 8.9 | After auth.ok: grant.set + push.subscribe, then outbox flush | web/real-relay.test.ts › after login | unit | 5 | ⏳ |
| C-8.9c | 8.9 | connected / reconnecting (<30 s) / offline (onLine false or ≥30 s) | web/real-relay.test.ts › states | unit | 5 | ⏳ |
| C-7.1b | 7.1 | App ping every 25 s in foreground; no pong in 10 s → reconnect | web/real-relay.test.ts › heartbeat | unit | 5 | ⏳ |
| C-10.4a | 10.4 | Challenges precomputed when F1 opens | web/real-key.test.ts › precompute | unit | 5 | ⏳ |
| C-10.5a | 10.5 | The verifier runs only for a waiting request or one timed out <30 s ago | web/verification.test.ts › window | unit | 5 | ⏳ |
| C-10.5b | 10.5 | Member card looked up by req.toDeviceId, never the sender | web/verification.test.ts › member lookup | unit | 5 | ⏳ |
| C-10.9a | 10.9 | "Reset used request numbers" hidden in production | web/diagnostics.test.ts | unit | 5 | ⏳ |
| C-12a | 12 | Presence asked on demand, at most every 30 s per screen | web/presence.test.ts | unit | 5 | ⏳ |
| C-9.5a | 9.5 | The app refuses incoming plain unless its own Lab opt-in is on | web/envelope.test.ts › refuse plain | unit | 8 | ⏳ |

## J · end-to-end journeys (Playwright; Maa, Arjun, Papa, judge/Lab)

| ID | Spec § | Journey | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| J-01 | 6 | Set up both; add each other in person; words identical | e2e/journeys.spec.ts › J-01 | e2e | 5 | ⏳ |
| J-02 | 10 | Genuine YES → VERIFIED, same two confirmation words | e2e/journeys.spec.ts › J-02 | e2e | 5 | ⏳ |
| J-03 | 13.1 | NOT ME → DENIED; Papa receives G1 | e2e/journeys.spec.ts › J-03 | e2e | 5, 7 | ⏳ |
| J-04 | 13.1 | No answer → NO_RESPONSE at 60 s; Ask family → Papa gets G2 | e2e/journeys.spec.ts › J-04 | e2e | 5, 7 | ⏳ |
| J-05 | 23 | Maa offline / relay down → offline / relay_unreachable | e2e/journeys.spec.ts › J-05 | e2e | 5 | ⏳ |
| J-06 | 11 | Arjun's page closed → mock push → notification URL → answer | e2e/push.spec.ts › J-06 | e2e | 6 | ⏳ |
| J-07 | 8.6 | Maa cancels → "Maa stopped waiting" | e2e/journeys.spec.ts › J-07 | e2e | 5 | ⏳ |
| J-08 | 10.7 | Late NOT ME → DENIED (late); late YES → Not confirmed yet + late line | e2e/late.spec.ts › J-08 | e2e | 5 | ⏳ |
| J-09 | 6.4 | The judge opens Arjun's family link and checks him | e2e/journeys.spec.ts › J-09 | e2e | 5 | ⏳ |
| J-10 | 6.5 | A "new phone" link with Arjun's name → red warning | e2e/new-phone.spec.ts › J-10 | e2e | 5 | ⏳ |
| J-11 | 6.4 | Arjun removes Maa (+ reset) → "isn't accepting checks"; new person with old card refused | e2e/journeys.spec.ts › J-11 | e2e | 5 | ⏳ |
| J-12 | 14.3 | 50 Lab attacks (change, replay, forge, forge with copied credId) → all INVALID, 0 false greens | e2e/lab.spec.ts › J-12 | e2e | 7 | ⏳ |
| J-13 | 13.2 | Call Guard scripted call → prompt → D2 prefilled | e2e/guard.spec.ts › J-13 | e2e | 7 | ⏳ |
| J-14 | 18.9 | relay-a killed while a request is pending (through Caddy) → relay-b takes over | ops/failover.spec.ts › J-14 | e2e | 10 | ⏳ |
| J-15 | 8.6 | Double tap on NOT ME → one answer, no duplicate verdict | e2e/journeys.spec.ts › J-15 | e2e | 5 | ⏳ |
| J-16 | 9 | Every journey with E2E_REQUIRED=true; captured frames hold no personal data | e2e (E2E_REQUIRED=true) + relay/frame-capture.int.test.ts | e2e | 8 | ⏳ |
| J-17 | 7.1 | Arjun open in two tabs; answering in one closes the other | e2e/journeys.spec.ts › J-17 | e2e | 5 | ⏳ |

## OPS · infrastructure (local)

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| OPS-01 | 18.6 | compose config valid for production and staging example env; profiles right | ops/compose.test.ts | ops | 10 | ⏳ |
| OPS-02 | 18.6 | Full production stack runs locally behind Caddy (internal CA) | ops/stack.test.ts | ops | 10 | ⏳ |
| OPS-03 | 18.8 | Rolling deploy.sh under load: zero failed checks | ops/rolling.test.ts | ops | 10 | ⏳ |
| OPS-04 | 15.2, 18.8 | Migrations run during a deploy; rollback to previous tag works | ops/rolling.test.ts › rollback | ops | 10 | ⏳ |
| OPS-05 | 18.10 | Backup → restore → identical counts incl. revoked bindings; unreadable without the age key | ops/backup.test.ts | ops | 10 | ⏳ |
| OPS-06 | 18.10 | Whole-stack restart healthy within 60 s | ops/stack.test.ts › restart | ops | 10 | ⏳ |
| OPS-07 | 18.5 | Image manifest has arm64 and amd64; arm64 boots | ops/image.test.ts | ops | 10 | ⏳ |
| OPS-08 | 18 | shellcheck, hadolint, actionlint, cloud-init schema clean | ops/lint.test.ts | ops | 10 | ⏳ |
| OPS-09 | 18.6 | Only ports 80 and 443 published | ops/compose.test.ts › ports | ops | 10 | ⏳ |
| OPS-10 | 19.6 | The canary passes against the local stack | ops/canary.test.ts | ops | 10 | ⏳ |
| OPS-11 | 19.3–19.5 | Dashboards and alert rules valid | ops/grafana.test.ts | ops | 10 | ⏳ |
| C-18.7a | 18.7 | env.example lists names only, no values that look like secrets | ops/compose.test.ts › env.example | ops | 10 | ⏳ |
| C-18.6a | 18.6 | Valkey runs with a password, no persistence, 768mb, noeviction | ops/compose.test.ts › valkey | ops | 10 | ⏳ |

## LOAD, CHAOS, SEC

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| LOAD-01 | 21.4 | Capacity per container at p95 < 150 ms; sets MAX_SOCKETS | apps/loadgen capacity (short) | load | 11 | ⏳ |
| LOAD-02 | 21.4 | Reconnect storm: all back within 30 s, errors < 1% | apps/loadgen storm | load | 11 | ⏳ |
| LOAD-03 | 21.4 | Soak: no memory growth (short locally) | apps/loadgen soak | load | 11 | ⏳ |
| CHAOS-01 | 21.5 | Kill a relay container mid-check → safe outcome | chaos/chaos.test.ts › kill relay | chaos | 11 | ⏳ |
| CHAOS-02 | 21.5 | Restart Redis mid-check → safe outcome | chaos/chaos.test.ts › restart valkey | chaos | 11 | ⏳ |
| CHAOS-03 | 21.5 | Postgres down 2 min → safe outcome | chaos/chaos.test.ts › postgres down | chaos | 11 | ⏳ |
| CHAOS-04 | 21.5 | Mock push 5xx → safe outcome | chaos/chaos.test.ts › push 5xx | chaos | 11 | ⏳ |
| CHAOS-05 | 21.5 | Phone offline 5 s mid-check → recovers | chaos/chaos.test.ts › airplane | chaos | 11 | ⏳ |
| SEC-01 | 21.7 | Envelope parser fuzzing: no crash, no unhandled rejection | sec/fuzz.test.ts | security | 9 | ⏳ |
| SEC-02 | 21.7 | A replayed login is refused | relay/login.int.test.ts › SEC-02 · the server nonce is single-use | security | 9 | ✅ |
| SEC-03 | 21.7 | Answer from a non-target refused | relay/requests.int.test.ts › only the target may answer, and only to the asker (SEC-03) | security | 9 | ✅ |
| SEC-04 | 21.7 | Binding bypass (revoked + valid grant; new identity with rotated grant) refused | relay/contacts.int.test.ts › SEC-04 + a revoked sender is refused even with a valid grant | security | 9 | ✅ |
| SEC-05 | 9.5 | Downgrade: relay strips e2e and sends plain → the app refuses | web/envelope.test.ts › downgrade + e2e | security | 8 | ⏳ |
| SEC-06 | 16.2 | Oversized and binary frames handled | relay/upgrade.int.test.ts › binary 1003, too_large, 1009 | security | 9 | ✅ |
| SEC-07 | 16.2 | Never-login sockets close at 10 s; pending unauthenticated per IP capped | sec/attacks.test.ts › slowloris | security | 9 | ⏳ |
| SEC-08 | 11.3 | SSRF push subscriptions refused | sec/attacks.test.ts › ssrf | security | 9 | ⏳ |
| SEC-09 | 14.1 | Lab off → lab.* refused; not opted in → not intercepted; password attempts limited | relay/lab.int.test.ts › safety | security | 7 | ⏳ |
| SEC-10 | 16.4 | gitleaks: no secrets in the repo or history | sec/gitleaks (CI + local) | security | 9 | ⏳ |
| SEC-11 | 21.7 | pnpm audit and Trivy: no critical/high | sec/audit (CI) | security | 9 | ⏳ |
| SEC-12 | 12 | Presence never reveals strangers | relay/data.int.test.ts › CON-06 / SEC-12 · presence | security | 9 | ✅ |
| C-14.3a | 14.3 | Held message: 10 s without Lab reply → original forwarded, disarmed, "Lab didn't respond" | relay/lab.int.test.ts › hold timeout | integration | 7 | ⏳ |
| C-14.1a | 14.1 | cfg:lab expires after 12 h; opt-ins and sessions after 4 h | relay/lab.int.test.ts › ttls | integration | 7 | ⏳ |
| C-14.4a | 14.4 | Every attack written to lab_attacks; false_green counter stays 0 | relay/lab.int.test.ts › records | integration | 7 | ⏳ |

## Failure modes (section 23) → proving test

| ID | Situation | Test | Phase | Status |
|---|---|---|---|---|
| F-01 | Arjun's phone off / no data → Not confirmed yet at 60 s | J-04 | 5 | ⏳ |
| F-02 | Arjun's app closed → notification | J-06 | 6 | ⏳ |
| F-03 | Battery saver delays push | manual: E4 step 12 | 6 | manual |
| F-04 | iPhone not installed / alerts refused → reachability hint | APP-09 (D1 hint), FC-10 | 5 | ⏳ |
| F-05 | Maa offline → relay_unreachable | J-05 | 5 | ⏳ |
| F-06 | Network flicker while waiting → reconnect + drain | CHAOS-05 | 11 | ⏳ |
| F-07 | Maa backgrounded when answer arrives → push to Maa | REL-06 + PSH-02 | 6 | ⏳ |
| F-08 | Relay container crash / deploy mid-check | J-14, OPS-03 | 10 | ⏳ |
| F-09 | Whole VM down → Not confirmed yet; restart | OPS-06 | 10 | ⏳ |
| F-10 | Redis unavailable → fail closed | REL-19 | relay/health.int.test.ts › REL-19 (Valkey down → unavailable) | ✅ |
| F-11 | Redis restarted → routes self-heal | REL-05, CON-11 | relay/delivery.int.test.ts › REL-05 (Valkey wipe) + data.int.test.ts › CON-11 | ✅ |
| F-12 | Postgres unavailable → warm caches keep working | REL-19, CON-08 | relay/health.int.test.ts › REL-19 (warm caches keep working) | ✅ |
| F-13 | Push service outage → failed receipts | PSH-03, CHAOS-04 | 6 | ⏳ |
| F-14 | Push subscription expired → deleted, re-subscribed | PSH-03 | 6 | ⏳ |
| F-15 | Wrong phone clock → nothing | APP-09 (F1 skew) | 5 | ⏳ |
| F-16 | Duplicate delivery → nothing | REL-08, APP-08 | 5 | ⏳ |
| F-17 | Double tap / two devices → first answer counts | J-15, J-17, REL-10 | 5 | ⏳ |
| F-18 | Maa cancels → Arjun sees "stopped waiting" | J-07 | 5 | ⏳ |
| F-19 | Arjun answers after 60 s → late policy | J-08 | 5 | ⏳ |
| F-20 | Arjun cancels the fingerprint prompt → F5 | APP-05 | 5 | ⏳ |
| F-21 | Passkey deleted from the password manager → F5 then "key is missing" | APP-05 | 5 | ⏳ |
| F-22 | Storage cleared → fresh start | APP-02 | 5 | ⏳ |
| F-23 | Phone lost → UV required | CRY-07 (check 5) | 2 | ✅ |
| F-24 | Family link leaks → rate limits, Remove, Reset my code | REL-16, J-11 | 5 | ⏳ |
| F-25 | Scammer's "new phone" link → red warning | J-10 | 5 | ⏳ |
| F-26 | Relay compromised → never a false green | J-12, CRY-09 | 7 | ⏳ |
| F-27 | Vercel down → installed app opens from cache | web e2e offline start | 5 | ⏳ |
| F-28 | App too old → "Update Pehchaan" (4426) | APP-09 | 5 | ⏳ |
| F-29 | Lab left on → only opted-in phones, banner; TTLs | C-14.1a, SEC-09 | 7 | ⏳ |

## Manual (E4, real phones)

| ID | Rule | E4 step | Status |
|---|---|---|---|
| E4-01 | Install, set up, create keys with fingerprint | 1 | manual |
| E4-02 | QR face to face: same four words | 2 | manual |
| E4-03 | Diagnostics: connected, storage protected, push on, right relay/build | 3 | manual |
| E4-04 | Genuine YES on real phones < 5 s after fingerprint | 4 | manual |
| E4-05 | NOT ME; third phone gets the alert | 5 | manual |
| E4-06 | No answer at 60 s | 6 | manual |
| E4-07 | Maa cancels | 7 | manual |
| E4-08 | Airplane mode 5 s on Maa | 8 | manual |
| E4-09 | Test alert with screens locked < 5 s | 9 | manual |
| E4-10 | Android app swiped away, locked → notification → verdict | 10 | manual |
| E4-11 | iPhone installed app, locked → notification → verdict | 11 | manual |
| E4-12 | Battery saver vs Unrestricted delivery times | 12 | manual |
| E4-13 | Judge's phone via family link, no install | 13 | manual |
| E4-14 | "New phone" link → red warning | 14 | manual |
| E4-15 | Lab: change, replay, forge on real phones | 15 | manual |
| E4-16 | Call Guard prompt → D2 prefilled | 16 | manual |
| E4-17 | Deploy during a pending check (staging) | 17 | manual |
| E4-18 | VM reboot (staging) → back within 2 min | 18 | manual |
| E4-19 | Standby switch rehearsal ≤ 30 min | 19 | manual |
| E4-20 | Hindi on one phone for steps 4–7 | 20 | manual |
