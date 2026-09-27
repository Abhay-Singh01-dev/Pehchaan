# Pehchaan

**Two-factor authentication for humans.** When a call says "Maa, it's me, I need money now", Pehchaan lets Maa ask
her son's own phone whether it's really him, and get an answer that nobody in between can fake.

Pehchaan is an installable web app (PWA) and a small relay server. The family's phones hold all the trust; the server
only carries sealed messages and can at worst delay them.

---

## Contents

1. [The problem](#1-the-problem)
2. [The solution](#2-the-solution)
3. [Security model](#3-security-model)
4. [Architecture](#4-architecture)
5. [Tech stack](#5-tech-stack)
6. [Repository layout](#6-repository-layout)
7. [Getting started](#7-getting-started)
8. [Testing](#8-testing)
9. [Deployment](#9-deployment)
10. [Operations](#10-operations)
11. [Key technical details](#11-key-technical-details)
12. [Documentation](#12-documentation)

---

## 1. The problem

Impersonation scams work because a voice is no longer proof of identity:

- **"Family emergency" calls.** A caller claims to be a son, daughter or grandchild in trouble: an accident, an arrest,
  a hospital bill. Voice cloning makes the voice convincing; panic does the rest.
- **"New phone" tricks.** "This is my new number, save it" — so every later check reaches the scammer.
- **Pressure.** The victim is kept on the line and rushed, so they never stop to verify.

Today's defences don't fit this moment. Calling back is easily talked around ("my phone is broken"), family code words
are forgotten or shared, and OTP-style tools verify accounts, not people.

## 2. The solution

Pehchaan turns "is this really Arjun?" into a one-tap question to **Arjun's own phone**, answered with **his
fingerprint or screen lock**:

1. **Set up once, face to face.** Family members add each other by scanning a QR "family card" and comparing four
   safety words. Each phone creates a passkey (WebAuthn) and device keys; no accounts, passwords, phone numbers or OTPs.
2. **During a suspicious call,** Maa taps *Verify → Arjun*. Her phone builds a request (random nonce, 60-second
   deadline, optional reason and amount), seals it end to end, and sends it through the relay.
3. **Arjun's phone buzzes,** even if the app is closed (Web Push). He sees "Maa is asking: are you on a call with
   her?" and answers **YES, IT'S ME** or **NO, NOT ME**; his passkey signs that exact request only after his
   fingerprint or PIN.
4. **Maa's phone runs 7 checks** on the answer and shows one of:
   - **Confirmed** — only if all 7 checks pass *and* the answer is ME;
   - **Not Arjun. Do not send money.** — a signed NOT ME (the rest of the family is alerted);
   - **Fake answer** — any check failed;
   - **Not confirmed yet** — no valid answer in time (with "Ask family" and "Call Arjun").

The 7 checks (spec 10.5), all run on Maa's phone with her own clock:

| # | Check | Catches |
|---|---|---|
| 1 | **Fresh** — received before the request's deadline | late or delayed answers |
| 2 | **Key** — signed by the passkey on Arjun's saved card | anyone else's key |
| 3 | **Exact** — the signature covers this exact request and decision | a changed amount, reason or decision |
| 4 | **Address** — signed for Pehchaan's own origin and rpId | look-alike sites |
| 5 | **Unlocked** — user present and verified (fingerprint/PIN) | an unlocked phone in someone else's hand |
| 6 | **Signature** — the ECDSA signature is valid | forgeries |
| 7 | **Unused** — the nonce was never answered before | replays of an old answer |

Also in the app: **Call Guard** (a laptop or second phone that suggests a check when a call sounds like a scam —
transparent keyword rules, no AI in the trust path), **family alerts**, **Hindi and English**, a **Diagnostics**
screen, and the **Security Lab** — a judging-session tool that tampers with, replays and forges answers on the relay
so anyone can watch the 7 checks catch them (0 false greens in 50 recorded attacks).

## 3. Security model

**The one-sentence claim:** as long as Maa runs the genuine app, nobody who controls the network, the relay or the
push services can make her phone show "Confirmed" unless Arjun himself unlocked his phone and approved that exact
request.

| Party | Can | Cannot |
|---|---|---|
| Maa's phone (asker) | Create requests, run the 7 checks, show verdicts | Make Arjun's passkey sign anything |
| Arjun's phone + passkey (answerer) | Sign ME / NOT ME for one exact request, after unlock | Sign without the unlock, or for a look-alike site |
| **The relay** (or anyone who breaks into it) | Delay or drop messages ("Not confirmed yet"), corrupt them ("Fake answer"), see metadata | Produce a green "Confirmed", read contents (E2E), learn names, numbers or amounts, forge a NOT ME |
| Push services (FCM, Apple) | Delay or drop notifications | Read payloads (encrypted twice) |
| The scammer | Pressure and rush; send a "new phone" link | Answer as Arjun, replay old answers, change a NOT ME; the new-phone link shows a red warning |

Design rules that never change:

- **The relay never decides who anyone is.** It has no verifier and never opens envelopes (enforced in CI by
  dependency rules: the relay may not import `packages/crypto/verifier` or `e2e`).
- **The server stores no names, phone numbers, amounts or message contents** — only pseudonymous device IDs, who may
  contact whom, and push endpoints. This keeps a breach survivable and DPDP (India) compliance simple.
- **Fail closed.** Any doubt ends in "Not confirmed yet", never in green.
- **Versioned wire formats** from day one (envelope, card, canonical request, subprotocol `pehchaan.v1`).

## 4. Architecture

```
                   ┌────────────────────────────────┐
                   │  Vercel · app.yourdomain.in    │  static PWA (HTML/JS + service worker)
                   └───────────────┬────────────────┘
          ┌────────────────────────┴───────────────────────┐
   ┌──────▼──────┐                                  ┌──────▼──────┐
   │ Maa's phone │                                  │Arjun's phone│
   │ PWA · 7-check verifier                         │ PWA · passkey│
   └──────┬──────┘                                  └──▲───┬──────┘
          │ wss (TLS)                     Web Push     │   │ wss (TLS)
   ┌──────▼──────────────────────────────────────┐ ┌──┴───────┐
   │ Oracle Cloud Always Free Arm VM · Mumbai    │ │ FCM /    │
   │ Docker Compose                              │ │ Apple    │
   │  Caddy (HTTPS, WebSocket balancing)         │ └──▲───────┘
   │   ├─ relay-a ─┐   (stateless gateways)      │    │
   │   └─ relay-b ─┴── web-push ─────────────────┼────┘
   │  Valkey: routes, pub/sub, 60 s inbox,       │
   │          request records, rate limits       │
   │  Postgres 16: devices, grants, bindings,    │
   │          push subscriptions, audit, Lab log │
   │  backup (nightly, encrypted) · Grafana Alloy│
   └─────────────────────────────────────────────┘
```

- **Gateways are stateless.** Any relay container can serve any phone; shared state lives in Valkey (seconds to
  minutes, disposable by design) or Postgres (the few durable facts).
- **Two relay containers** behind Caddy: a deploy or a crash never takes the relay down (containers drain
  gracefully; a check in progress survives because its record and inbox are in Valkey).
- **Cost: ₹0 a month** on free tiers (Oracle Always Free, Vercel Hobby, Cloudflare, Grafana Cloud, Sentry, GitHub);
  only the domain costs money.

## 5. Tech stack

| Layer | Technology | Why |
|---|---|---|
| App | React 19, Vite 8, TypeScript (strict), React Router 7, Zustand, Dexie (IndexedDB), i18next, Workbox, Motion | Installable PWA that works on Android and installed iPhone apps; offline start from cache |
| Security core | `packages/crypto`: **WebCrypto only** (no dependencies) — ECDSA/ECDH P-256, HKDF, AES-256-GCM, SHA-256, WebAuthn assertion parsing, DER | The same code runs in the browser, the relay's tests and Node; small enough to review line by line |
| Protocol | `packages/protocol`: **zod only** — one schema per message, shared by app and relay | Types are inferred from the schemas, so app and relay can't drift |
| Relay | Node.js 22, Fastify 5 (HTTP), `ws` 8 (WebSockets), ioredis, pg + Drizzle ORM, web-push (VAPID), pino, prom-client, hash-wasm (Argon2id), Sentry | Long-lived sockets, raw upgrade control (Origin, limits, subprotocol before accepting) |
| Stores | Valkey 8 (Redis protocol) with Lua scripts; PostgreSQL 16 with expand-only migrations | Atomic "first answer wins" and rate limits; constraints for bindings and revocations |
| Infrastructure | Docker (multi-arch arm64 + amd64), Docker Compose, Caddy 2, cloud-init, Grafana Alloy, age + rclone backups, supercronic | One file describes the whole server; the same stack runs on a laptop |
| CI/CD | GitHub Actions, pnpm 10 workspaces, Turborepo, Trivy, gitleaks, actionlint | Build once, scan, deploy to staging, approve, deploy to production |
| Observability | Prometheus metrics → Grafana Cloud (5 dashboards, 10 alert rules), Loki logs, Sentry, a canary every 10 minutes | SLOs from spec 19.4, runbook for every alert |
| Tests | Vitest, fast-check (property tests and fuzzing), Playwright (virtual WebAuthn authenticator), a WebSocket load generator | Unit, integration against real Valkey/Postgres, end to end, ops, chaos, load, security |

## 6. Repository layout

```
apps/
  web/          the PWA (React). Simulation mode or the real relay, chosen at build time
  relay/        the relay: src/ (ws handlers, core, push, lab, admin, store), lua/, migrations/, test/ (integration)
  canary/       synthetic check: two software devices log in, ask, answer, check receipts and timings
  loadgen/      WebSocket load generator: capacity ramp, reconnect storm, soak (worker threads)
packages/
  crypto/       the security core: canonical request, device auth, E2E seal/open, the 7-check verifier, cards, words
  protocol/     wire schemas (zod), error codes, limits and timings
tests/
  e2e/          Playwright journeys against the real relay (J-01 … J-17), CSP and offline checks
  unit/         the repository's own scripts, dashboards, runbooks
  ops/          OPS-01 … OPS-11: the production stack on this machine (compose, Caddy, deploy.sh, backups, images)
  chaos/        CHAOS-01 … CHAOS-05: failures injected mid-check
  load/         LOAD-01 … LOAD-03 (shortened) against the local stack at 1 CPU per relay
infra/
  docker/       Dockerfile.relay, Dockerfile.backup
  vm/           compose.yml, Caddyfile, cloud-init.yaml, deploy.sh, config.alloy, env.example
  backup/       backup.sh, restore.sh, retention.sql, crontab
  grafana/      dashboards/*.json, alerts.json, import.mjs
  compose/      docker-compose.dev.yml (Valkey + Postgres for development and tests)
  scripts/      vapid-keys.ts, lab-password-hash.ts
docs/           BACKEND_SPEC.md (the specification), FRONTEND_SPEC.md, RUNBOOKS.md, TEST_MATRIX.md, DECISIONS.md
scripts/        repository checks: banned words, migrations (expand-only), test matrix, security suite
```

## 7. Getting started

### Prerequisites

- **Node.js 22+** and **pnpm 10** (`corepack enable`)
- **Docker** (Docker Desktop on Windows/macOS) — Valkey and Postgres for development and tests
- Git Bash on Windows (for `deploy.sh` and the backup scripts in the ops tests)
- Microsoft Edge or Chrome for the Playwright suites (`PW_CHANNEL=msedge` uses the installed Edge)

### Install and run

```bash
git clone https://github.com/Abhay-Singh01-dev/Pehchaan.git
cd Pehchaan
pnpm install
docker compose -f infra/compose/docker-compose.dev.yml up -d --wait   # Valkey 8 + Postgres 16 on 127.0.0.1
pnpm dev                                                              # relay on :8080, app on :5180
```

Open <http://localhost:5180>. The development relay reads `apps/relay/.env.development` (no secrets; committed so
`pnpm dev` works after a clone) and applies its migrations at start-up on a laptop (deploys run them as a separate
step). Vite proxies `/relay` to the relay, so the app and relay share one origin.

### App modes (`apps/web/.env.example` → `.env.local`)

| Setting | Meaning |
|---|---|
| `VITE_SIMULATION=true` (default) | Everything simulated in the browser (relay, passkey, clock) — for UI work without a server |
| `VITE_SIM_RELAY=false` | Talk to the real relay at `VITE_RELAY_URL` |
| `VITE_SIM_KEY=false` | Use the phone's real passkey (needs HTTPS and a real `VITE_RP_ID`) |
| `VITE_SIM_VERIFIER=false` | Verify against `VITE_ORIGIN` / `VITE_RP_ID` |
| `VITE_VAPID_PUBLIC_KEY`, `VITE_VAPID_KEY_ID` | Web Push (must match the relay's pair from `pnpm tsx infra/scripts/vapid-keys.ts`) |
| `VITE_ENABLE_LAB`, `VITE_ENABLE_GUARD` | Security Lab and Call Guard screens |

**Real phones against a laptop:** passkeys and push need real HTTPS. Use a Cloudflare Tunnel
(`cloudflared tunnel run dev-<name>`), then set `VITE_RP_ID`, `VITE_RELAY_URL`, the relay's `PUBLIC_ORIGINS` and
`RELAY_HOST` to the tunnel host (spec 18.12).

### Relay configuration

Every variable is validated with zod at start-up; a missing or invalid value stops the relay (fail fast). The full
list with examples is in `infra/vm/env.example` and spec 18.7. Staging and production require `AUDIT_KEY`,
`IP_HASH_KEY` and a VAPID pair, and allow only `https://` origins.

## 8. Testing

Every rule of the specification has a row in [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md) (spec section, test file and
name, status); `pnpm check-matrix` fails while any row is neither ✅ nor covered by a named real-phone step.

| Command | What it runs |
|---|---|
| `pnpm turbo run lint typecheck test build` | **The fast gate:** ESLint, Prettier, TypeScript, unit tests with coverage (crypto 100%), builds |
| `pnpm test:integration` | The relay against **real Valkey and Postgres** (no fakes): login, routing, inbox, receipts, first-answer-wins, bindings, rate limits, push (a stand-in push service that verifies VAPID and decrypts RFC 8291 payloads), Lab, drain, metrics, fuzzing |
| `pnpm test:e2e:real` | Playwright journeys J-01 … J-17 against the real relay with a virtual WebAuthn authenticator (`E2E_REQUIRED=true pnpm test:e2e:real` refuses every readable envelope) |
| `pnpm test:e2e` | The above plus the frontend's own walkthrough in simulation mode |
| `pnpm test:security` | SEC-01 … SEC-12: fuzzing, scripted attacks, gitleaks (history), `pnpm audit`, Trivy |
| `pnpm test:ops` | OPS-01 … OPS-11 and J-14: builds the images, runs the **production compose stack on this machine** behind Caddy with its internal CA, rolling deploys under load (1,000 sockets, 2 checks/s, zero failures), a migration and a rollback, backup → restore, whole-stack restart, multi-arch images (arm64 boots under QEMU), shellcheck/hadolint/actionlint/cloud-init, Grafana import |
| `pnpm test:chaos` | CHAOS-01 … CHAOS-05: relay killed, VM reboot, Valkey restart, Postgres down 2 minutes, push service 5xx, a phone offline 5 s — each mid-check, each must end correct or "Not confirmed yet", never a false green |
| `pnpm test:load:short` | LOAD-01 … LOAD-03 shortened: capacity ramp, reconnect storm, soak, with each relay limited to 1 CPU |
| `pnpm check-matrix` · `pnpm check-migrations` · `pnpm banned-words` · `pnpm depcruise` | Repository rules: open matrix rows, expand-only migrations, the team's banned words, code boundaries |

The ops, chaos and load suites share one Docker project and ports 80/443: run them one at a time. The real-phone
script (Android and installed iPhone, carriers, battery settings) is in spec E4 and the matrix's "Manual" table.

### Verified results (on the development machine, September 2026)

| Suite | Result |
|---|---|
| Fast gate (lint, typecheck, unit with coverage, build) | 23 / 23 tasks green; `packages/crypto` at 100% coverage |
| Relay integration (real Valkey + Postgres) | 193 tests passing |
| Real-backend journeys (Playwright, virtual passkeys) | 34 / 34 with E2E optional, 33 / 33 with `E2E_REQUIRED=true` |
| Security Lab, J-12 | 50 attacks (change, replay, forge): **0 false greens** |
| Security suite | gitleaks (whole history), `pnpm audit` and Trivy: no high or critical findings |
| Ops (OPS-01 … OPS-11, J-14) | All passing: two rolling deploys (with a migration and a rollback) under 1,000 sockets and 2 checks/s with **zero failed checks**; backup → restore with identical row counts; whole stack healthy within 60 s of a restart; arm64 image boots under QEMU |
| Chaos (CHAOS-01 … CHAOS-05) | All passing: every injected failure ended in the correct verdict or "Not confirmed yet", never a false green |
| Offline start (F-27) | The production build opens from the service worker with the network cut |
| Load, one relay container at 1 CPU (LOAD-01 … 03, shortened) | p95 routing **10 / 9 / 9 ms at 500 / 1,000 / 1,500 sockets**, 0 failed checks; relay killed under 1,500 sockets → every socket back within 30 s, < 1% failed checks; 8-minute soak with memory growth under 15%. Docker Desktop's port forwarding stops at about 2,000 connections, so these are lower bounds: `MAX_SOCKETS` and the 12-hour soak come from staging (spec 21.4) |
| Test matrix | **227 rules: every one ✅ or covered by a named real-phone step** (`pnpm check-matrix`) |

## 9. Deployment

- **App:** Vercel (branch `main` → production, `staging` → staging), with security headers from `apps/web/vercel.json`
  and a build-time Content Security Policy.
- **Relay:** on every green `ci` run on `main`, [`.github/workflows/deploy-relay.yml`](.github/workflows/deploy-relay.yml)
  builds the relay and backup images **once** (linux/arm64 + linux/amd64), scans them with Trivy, pushes them to GHCR,
  deploys to the staging VM over SSH, runs the smoke test (the canary), waits for a reviewer to approve the
  `production` environment, deploys production with the same images, and runs the canary against it.
- **On the VM**, `infra/vm/deploy.sh <tag>` runs the expand-only migrations, then replaces `relay-a` and `relay-b` one
  at a time, waiting for each to be healthy; `deploy.log` keeps the tags for rollback.

**One-time human steps** (Oracle Cloud sign-up in Mumbai, the two Always Free Arm VMs with `cloud-init.yaml`, DNS,
GitHub environments and secrets, the backup key and bucket, Grafana Cloud) are in
[`docs/RUNBOOKS.md` → One-time setup](docs/RUNBOOKS.md#one-time-setup), including the exact list of secrets.

## 10. Operations

- **Health:** `/healthz` (process up) and `/readyz` (Valkey reachable, not draining, under `MAX_SOCKETS`); Caddy stops
  sending new connections to a container that isn't ready.
- **Metrics and logs:** `prom-client` metrics (connections, routing latency, receipts, push results, answer time, Lab
  false greens — must stay 0) and structured pino logs with no personal data, shipped by Grafana Alloy. Dashboards and
  alerts are code in `infra/grafana/`, loaded with `node infra/grafana/import.mjs`.
- **Canary:** every 10 minutes from GitHub Actions, two software devices do a full sealed round trip against
  production; three failures in a row page the team.
- **Backups:** nightly `pg_dump`, encrypted with `age` to a public key (the private key is offline), uploaded with
  rclone to another provider, 30 days kept; retention SQL runs right after. A monthly restore test is in the runbook.
- **Runbooks:** [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md) — deploy, rollback, the standby switch, one section per alert,
  security incidents, the judging-day checklist, deletion requests, abusive devices.

## 11. Key technical details

**Identity without accounts.** Each phone generates a P-256 signing key and an encryption key; its device ID is
derived from the public key (22 characters), so it is self-certifying. Login answers a fresh server nonce with a
signature over the relay host and nonce. Answers are signed by a **passkey** (WebAuthn) bound to the app's domain.

**The family card and safety words.** Contacts are added by QR card (card v2: device keys, passkey public key and
credential ID, a contact grant). Both people compare four safety words derived from the keys, so a swapped card is
visible. A card claiming to be a "new phone" for an existing contact gets a red warning (spec 6.5). A grant lets the
relay record a binding "A may contact B" without learning who A and B are; bindings can be revoked and blocks persist.

**The canonical request.** The answerer's passkey signs SHA-256 of a canonical JSON encoding of the exact request
(request ID, nonce, both device IDs, label, reason, amount, times) joined to the decision. Changing any field or the
decision changes the challenge. The spec's test vectors (10.2) reproduce byte for byte in CI.

**End-to-end encryption.** Every payload is sealed to the recipient's encryption key (ephemeral ECDH P-256 → HKDF →
AES-256-GCM) with the routing header as associated data, and signed by the sender's device key. With
`E2E_REQUIRED=true` the relay refuses readable envelopes; the app refuses them regardless (downgrade protection).

**Delivery.** JSON over WebSocket (`wss://…/v1/ws`, subprotocol `pehchaan.v1`), max 16 KiB per frame. Every message has
a ULID and gets receipts (accepted, pushed, delivered, seen, queued, failed, rejected). The app keeps an outbox and
re-sends with the same ID until confirmed; the relay deduplicates. Undelivered envelopes wait in a 60-second inbox
in Valkey and drain at the next login; if the recipient isn't connected, the relay sends Web Push (urgency high,
TTL 60 s). **First answer wins** is one atomic Lua script. The relay's clock sets deadlines; phones never compare
another device's timestamps with their own clock.

**Zero-downtime deploys.** On SIGTERM a relay marks itself not ready, waits for Caddy's health check to take it out,
asks every phone to reconnect (spread over up to 5 s), and closes the rest after 20 s. `pnpm test:ops` proves a
rolling deploy and a rollback under 1,000 sockets and 2 checks per second with zero failed checks.

**Abuse limits.** Per-device, per-pair and generous per-IP limits (Indian carriers put many users behind one address)
with a GCRA Lua script; Origin checks, unauthenticated-socket caps and a 10-second login deadline; SSRF-safe push
endpoints (only known push service hosts).

**Security Lab.** Loaded only in an event build, switched on at runtime (`admin lab on`, expires after 12 hours), with
an Argon2id password and per-device opt-in (4 hours). It can hold a message and let the Lab page change, replay or
forge it; every attack and its verdict is logged, and a false green raises an alert.

**Privacy (DPDP Act, 2023).** No names, numbers, amounts or contents on the server; IPs are only used as keyed hashes
for rate limits; logs and error reports are scrubbed; self-service deletion; retention: audit 1 year, Lab log 90 days,
dead push subscriptions 30 days, devices unseen for 12 months become tombstones.

## 12. Documentation

| Document | Contents |
|---|---|
| [`docs/BACKEND_SPEC.md`](docs/BACKEND_SPEC.md) | The complete specification: decisions, protocol, cryptography, delivery, data, hardening, privacy, infrastructure, observability, scaling, testing, failure modes |
| [`docs/FRONTEND_SPEC.md`](docs/FRONTEND_SPEC.md) | The app's screens and flows |
| [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md) | Setup, deploys, incidents, judging day |
| [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md) | Every rule → its test and status |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Choices made where the specification was silent, with reasons |
| [`CLAUDE.md`](CLAUDE.md) | The rules the coding agent follows in this repository |
