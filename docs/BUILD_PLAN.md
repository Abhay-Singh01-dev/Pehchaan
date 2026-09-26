# Build plan

The phases of `docs/BACKEND_SPEC.md` Part D, as concrete files in this repository. Each phase ends with its gate
green and one commit (D-006). The test IDs are those of Part E; `docs/TEST_MATRIX.md` tracks each one.

## 1. Repository layout (spec section 4)

```
apps/web            @pehchaan/web       the finished frontend (copied in, D-001)
apps/relay          @pehchaan/relay     Fastify + ws relay, Valkey, Postgres (Drizzle), Web Push, Security Lab
apps/loadgen        @pehchaan/loadgen   WebSocket load generator (21.4)
apps/canary         @pehchaan/canary    synthetic check: `canary` and `smoke` (19.6)
packages/protocol   @pehchaan/protocol  zod schemas, error and close codes, limits, ULIDs
packages/crypto     @pehchaan/crypto    WebCrypto only: canonical JSON, device auth, E2E, psig, verifier, cards, words
infra/              docker/, vm/, compose/, grafana/, scripts/
tests/e2e           Playwright journeys J-01 … J-17 against the real relay (three contexts, virtual authenticators)
tests/ops, tests/security, tests/chaos   OPS, SEC and CHAOS suites
scripts/            claude/ hooks, banned words, test-matrix check
```

## 2. Frontend spec names → code names (D-007)

| Frontend spec | In `apps/web` |
|---|---|
| `SIMULATION` flag | `src/app/flags.ts` → `SIM_RELAY`, `SIM_KEY`, `SIM_VERIFIER` (FC-1; `VITE_SIMULATION` stays as the default for all three) |
| `services/types.ts` B3/B4 interfaces | `src/services/types.ts` (EXTENSION comments mark additions) |
| `SimRelay` / `RealRelay` | `src/services/sim/SimRelay.ts` / `src/services/real/relay/*` (`RealRelay.ts` is the facade) |
| `SimKey` / `RealKey` | `src/services/sim/SimKey.ts` (software authenticator, D-008) / `src/services/real/RealKey.ts` |
| `SimVerifier` / `RealVerifier` | `src/services/sim/SimVerifier.ts` / `src/services/real/RealVerifier.ts`, both over `src/services/verifier.ts` → `@pehchaan/crypto` `verifyAnswer` |
| `SimLab` / relay Lab | `src/services/sim/SimLab.ts` / `src/services/real/RealLab.ts` |
| `CardService` | `src/services/card.ts` over `@pehchaan/crypto/card` |
| Request builder | `src/services/requests.ts` (`RequestFactory`) |
| Asker controller (D2 → D3 → E) | `src/app/verification.ts` |
| Answerer controller (F1 → F3) | `src/app/answering.ts` |
| Device identity (FC-2) | `src/services/identity.ts` + Dexie table `identity` |
| Used-nonce store (10.9) | Dexie table `usedNonces` (`src/store/nonces.ts`) |
| Push inbox (11.5) | Dexie table `pushInbox`, written by `src/sw.ts` |
| Screens A0–A8 | `src/screens/setup/*`: Splash (A0), Install (A1), Language (A2), Welcome (A3), NameStep (A4), RoleStep (A5), KeyStep (A6), Done (A7), Notifications (A8) |
| B1 Home, B2 Guard banner | `src/screens/home/Home.tsx`, `src/app/Banners.tsx` |
| C1–C9 | `src/screens/family/*`: FamilyList, AddFamily, MyCode, Scan, ConfirmMember (C5), MemberDetail (C6 + C7), Join (C8), FarAway (C9) |
| D1–D5 | `src/screens/verify/*`: Who, What, Waiting, Official, PaymentCheck |
| E1–E7 | `src/screens/verify/Result.tsx` + `src/components/VerdictScreen.tsx`, `ChecksList.tsx` (E6) |
| F1–F5 | `src/screens/answer/Incoming.tsx` (F1, F4, F5 states), `src/components/UnlockSheet.tsx` (F2, simulated key), `src/screens/answer/Sent.tsx` (F3) |
| G0–G2 | `src/screens/alerts/Alerts.tsx`, `src/components/AlertCard.tsx`, `src/app/Banners.tsx` |
| H1–H2 | `src/screens/history/*` |
| I1–I6 | `src/screens/settings/*`, `src/screens/help/*`; new `Privacy.tsx`, `Contacts.tsx`, `Alerts` settings (FC-9, FC-18) |
| J1 Lab, J2 Guard, J3 Diagnostics | `src/screens/lab/*`, `src/screens/guard/*`, `src/screens/diagnostics/Diagnostics.tsx` |

## 3. Where section 22.1 touches `apps/web`

| FC | Files |
|---|---|
| FC-1 | `app/flags.ts`, `services/index.ts`, `components/SimulationBadge.tsx`, `.env.example` |
| FC-2 | `services/identity.ts` (new), `store/db.ts` (v2: `identity`, `pushInbox`, `outbox` tables), `app/bootstrap.ts`, `app/device.ts` |
| FC-3 | `services/card.ts`, `@pehchaan/crypto/card` + `safety-words`, `screens/family/{ConfirmMember,Scan,Join,MyCode}.tsx`, `store/family.ts` |
| FC-4 | `services/real/RealKey.ts`, `services/sim/SimKey.ts`, `app/answering.ts` (no `await` before `get()`), `screens/answer/Incoming.tsx` (precompute on open) |
| FC-5 | `services/verifier.ts`, `services/real/RealVerifier.ts`, `services/sim/SimVerifier.ts`, `app/verification.ts` (late window, nonce timing), `components/ChecksList.tsx` (`skipped`) |
| FC-6 | `services/real/relay/{socket,outbox,frames,envelope,RealRelay}.ts` |
| FC-7 | `services/real/relay/envelope.ts` (`@pehchaan/crypto/e2e`, `plain-sig`) |
| FC-8 | `src/sw.ts` (injectManifest), `vite.config.ts`, `screens/setup/Notifications.tsx` (A8), `services/push.ts`, Diagnostics "Send test alert" |
| FC-9 | `screens/settings/AlertsSettings.tsx` (brand guidance) |
| FC-10 | `screens/setup/Install.tsx`, `app/startRoute.ts`, `screens/family/Join.tsx` |
| FC-11 | `services/identity.ts` (`persistStorage`), Diagnostics |
| FC-12 | `screens/verify/Waiting.tsx` (status line from receipts) |
| FC-13 | `app/verification.ts` (`not_allowed`), `screens/verify/Result.tsx` |
| FC-14 | `app/answering.ts`, `store/requests.ts` (`localDeadline`), `screens/answer/Incoming.tsx` |
| FC-15 | `app/answering.ts` (`onCancel`), `screens/answer/Incoming.tsx` |
| FC-16 | `app/verification.ts`, `screens/verify/Result.tsx` |
| FC-17 | `screens/verify/Who.tsx` |
| FC-18 | `screens/settings/{Settings,Privacy,Contacts}.tsx` |
| FC-19 | `screens/family/MemberDetail.tsx` (C7 revoke + reset checkbox), `screens/family/ConfirmMember.tsx` (unrevoke) |
| FC-20 | `screens/diagnostics/Diagnostics.tsx`, `app/LabBanner.tsx` |
| FC-21 | `services/real/RealLab.ts`, `@pehchaan/crypto/soft-authenticator` (forge), `screens/lab/*` (join form) |
| FC-22 | `screens/guard/*` ("+ Add a phone", consent line), `store/guardTargets.ts` |
| FC-23 | `app/pwa.ts`, `app/session.ts`, `app/UpdateRequired.tsx` |
| FC-24 | `screens/setup/KeyStep.tsx` |
| FC-25 | `vite.config.ts` (meta CSP plugin), `vercel.json`, `src/app/sentry.ts` (scrubber) |
| FC-26 | `i18n/en.json`, `i18n/hi.json` |
| FC-27 | `services/real/relay/RealRelay.ts` (drop mis-addressed requests), `app/answering.ts` |
| FC-28 | `docs/`, J1 copy |

## 4. Phases

### Phase 1 · Monorepo, tooling, test harness
- Root: `package.json` (scripts: test, test:integration, test:e2e, test:ops, test:security, test:load:short, test:chaos, depcruise, lint, format), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`, `eslint.config.js`, `.prettierrc`, `.dependency-cruiser.cjs`, `vitest.config.ts` (projects + coverage thresholds from B1).
- `packages/protocol`, `packages/crypto`, `apps/relay`, `apps/loadgen`, `apps/canary`: compiling skeletons.
- `apps/web`: renamed `@pehchaan/web`, unchanged behaviour; its unit and Playwright suites still pass.
- `infra/compose/docker-compose.dev.yml`; `apps/relay/test/helpers/{env,prefix,pg}.ts` (per-file key prefix and schema).
- `tests/e2e/{playwright.config.ts,fixtures/webauthn.ts,webauthn.spec.ts}`: three contexts, CDP virtual authenticator.
- `.github/workflows/ci.yml` (18.8 minus the E2E_REQUIRED step) with gitleaks and actionlint.
- Proofs: depcruise fixture violation fails; the hook reports a failing test.

### Phase 2 · Protocol and crypto
- `packages/crypto/src/`: `bytes.ts`, `canonical.ts`, `device-auth.ts`, `e2e.ts`, `plain-sig.ts`, `verifier.ts`, `der.ts`, `authdata.ts`, `safety-words.ts` + `bip39-english.ts` (checksum-verified), `confirm-words.ts`, `card.ts`, `soft-authenticator.ts`, `types.ts`, `index.ts`.
- `packages/crypto/test/`: `vectors.json` and CRY-01 … CRY-14 (CRY-07's table written by a separate agent from 10.5 alone).
- `packages/protocol/src/`: `ids.ts`, `limits.ts`, `errors.ts`, `envelope.ts`, `messages/*.ts`, `payloads.ts`, `lab.ts`, `ulid.ts`, `index.ts`; tests PRO-01 … PRO-03.

### Phase 3 · Relay core
- `apps/relay/src/`: `config.ts`, `main.ts`, `relay.ts` (factory), `log.ts`, `metrics.ts`, `http/{server,routes}.ts`, `ws/{upgrade,session,sessions,dispatch}.ts`, `ws/handlers/*.ts`, `core/{router,bus,inbox,requests,receipts,dedupe,authz,ratelimit,contacts,devices,frame,clock}.ts`, `store/{redis,db,schema}.ts`, `store/lua/{inbox-put,answer-check,gcra,request-create,cancel,arm-take}.lua`, `store/migrations/*.sql`, `drain.ts`, `migrate.ts`.
- `apps/relay/test/*.int.test.ts`: REL-01 … REL-24 (deferred rows marked), CON-01 … CON-03, two gateways, the 50-way race, drain, log capture.

### Phase 4 · Contacts, data, presence, admin
- `core/{presence,retire,audit,caches}.ts`, `push/subscriptions.ts` (host allowlist), `jobs/retention.ts`, `admin.ts`, `scripts/check-migrations.mjs`.
- Tests CON-04 … CON-13.

### Phase 5 · Connect the frontend
- `apps/web`: FC-1 … FC-6, FC-11 … FC-20, FC-23, FC-24, FC-26, FC-27 and the 22.2 types (Sim* services gain the same additions).
- Tests: unit tests for each real service; journeys J-01, J-02, J-05, J-07 … J-11, J-15, J-17; F1 with a 2-minute clock skew; APP-14 (Part D against the real backend); APP-11.

### Phase 6 · Web Push
- `apps/relay/src/push/{sender,topic,allowlist,wake}.ts`, `http/push-routes.ts` (`/v1/inbox/fetch`, `/v1/push/resubscribe`), `infra/scripts/vapid-keys.ts`.
- `apps/web`: `src/sw.ts` + `src/sw/{describe,notify,store}.ts`, A8, iOS install-first, test alert, battery guidance.
- Tests: `apps/relay/test/helpers/mock-push.ts` (VAPID JWT + RFC 8291 decryption), PSH-01 … PSH-08, J-06.

### Phase 7 · Alerts, Call Guard, Security Lab
- `apps/relay/src/lab/{lab,held,state,report}.ts`; `infra/scripts/lab-password-hash.ts`.
- `apps/web`: alerts with per-recipient receipts, Guard pairing and prompts, `RealLab`, J1 join form, opt-in banner.
- Tests: J-12 (50 attacks), SEC-09, J-13, the alert steps of J-03/J-04; `docs/lab-log-phase7.json`.

### Phase 8 · End-to-end encryption
- `apps/web` seals everything (plain + psig only between Lab-opted-in devices); receivers refuse downgrades; relay `E2E_REQUIRED`.
- Tests: J-16, the frame-capture test, SEC-05; CI's `E2E_REQUIRED=true` step.

### Phase 9 · Hardening and observability
- `apps/web/vercel.json`, meta CSP plugin, Sentry + scrubbers (web and relay), every 19.1 metric, pino fields, `infra/grafana/{dashboards,alerts}`, `apps/canary`, privacy texts.
- Tests: SEC-01 … SEC-12, APP-12, APP-13, REL-22, REL-23, canary unit tests, third-party request check.

### Phase 10 · Infrastructure
- `infra/docker/{Dockerfile.relay,Dockerfile.backup}`, `infra/backup/{backup.sh,retention.sql,crontab}`, `infra/vm/{compose.yml,Caddyfile,cloud-init.yaml,deploy.sh,config.alloy,env.example}`, `.github/workflows/{deploy-relay,canary}.yml`, `docs/RUNBOOKS.md`.
- Tests OPS-01 … OPS-11 (`tests/ops`), J-14 through Caddy.

### Phase 11 · Load, chaos, final verification
- `apps/loadgen` scenarios, `tests/chaos/*`, `scripts/check-test-matrix.mjs`.
- LOAD-01 … LOAD-03 (short), CHAOS-01 … CHAOS-05, the whole suite with E2E on and off, `TEST_MATRIX.md` fully green or "manual".
