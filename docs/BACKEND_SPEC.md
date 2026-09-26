# Pehchaan: Backend Build Prompt for Claude Code

**Version 1.2 · the complete backend specification plus step-by-step build-and-test instructions for Claude Code**

This file has two jobs. It is the full specification of Pehchaan's backend, and it is the prompt pack that Claude Code (or a similar coding agent) follows to build that backend, connect it to the finished frontend, and test every part of it *while* building. It is the backend companion to *Pehchaan_Frontend_Build_Prompt.md*.

*Changes:*
- *v1.1 moved the relay to a free Oracle Cloud VM (section 18).*
- *v1.2 turned the specification into a build prompt: Parts A, B, D and E were added.*

**The five parts**

| Part | For | What it is |
|---|---|---|
| **A** How to use this file | The team (don't paste) | Setup, the working loop, what only humans can do |
| **B** Rules for Claude Code | Claude Code (it becomes `CLAUDE.md`) | Non-negotiable rules, the test-as-you-build discipline, the automatic test hooks |
| **C** The specification (sections 0–27) | Claude Code and the team | The single source of truth for every behaviour |
| **D** Build phases 0–11 | Claude Code (paste one at a time) | What to build in each phase, the tests to write alongside it, and the gate that must be green before moving on |
| **E** The complete test plan | Claude Code and the team | Every behaviour mapped to an automated test, plus the final real-phone script |

---

# PART A: HOW TO USE THIS FILE (team notes, do not paste)

### A1. What Claude Code will and won't do

| Claude Code does | Only you can do (A5) |
|---|---|
| Write every line of backend code, the frontend integration, the tests, Docker/Compose/Caddy/CI files and the documentation | Create accounts (Oracle Cloud, Vercel, Cloudflare, GitHub environments, Sentry, Grafana Cloud, the backup bucket), buy the domain, enter card details |
| Run every automated test (unit, integration against real Valkey and Postgres in Docker, browser end-to-end with a virtual passkey, load, chaos) on its own machine | Put real secrets into the VM's `.env` and GitHub Environment secrets |
| Keep a live test matrix (`docs/TEST_MATRIX.md`) so you can see what is tested | Test on real phones (Android + iPhone), with real fingerprints and real push notifications |
| Stop and ask when the specification is silent on something that matters | Answer its questions, review each phase's changes, and approve production deploys |

### A2. One-time setup (about 20 minutes)

1. **Create the monorepo** (section 4 layout) and put the finished frontend code into `apps/web`. If you still edit the frontend in the no-code builder, read the note at the end of section 4 first.
2. **Copy the documents into the repo:** this file as `docs/BACKEND_SPEC.md`, and the frontend pack as `docs/FRONTEND_SPEC.md`.
3. **Create `CLAUDE.md`** at the repository root with exactly the block in B0. Claude Code reads it automatically at the start of every session.
4. **Create `.claude/settings.json`** and the two hook scripts from B3. They make Claude Code run the related tests after every file edit, and send it back to work when it tries to finish while the fast test suite is red. The scripts do nothing until Phase 1 has created the monorepo, so Phase 0 isn't blocked.
5. Install Docker on the machine where Claude Code runs. The integration tests need real Valkey and Postgres containers.
6. Create `scripts/banned-words.txt` with the words the UI and docs must never use (one per line), then commit. Every phase starts from a clean, committed tree.

**Using another coding agent** (Cursor, Codex and similar): put the B0 block in that tool's rules file (for example `AGENTS.md`) and run the gate commands by hand, since the B3 hooks are specific to Claude Code.

### A3. The working loop, one phase at a time

1. Start Claude Code in the repository root. Begin each phase in a **fresh session** (or run `/clear`), so the context is only this phase.
2. Paste the phase prompt from Part D, word for word. Use **plan mode** first: Claude Code proposes its plan for the phase. Check it against the phase's "Build" and "Tests" lists, then let it proceed.
3. Let it work. The hooks keep testing continuously; you don't need to ask.
4. At the end, Claude Code prints the **phase report**: tests added and passing, coverage, test-matrix rows closed, decisions made, and open questions. Read it.
5. **Check the gate yourself:** run the phase's gate commands in your own terminal. Skim the diff, especially anything under `packages/crypto` and `packages/protocol`.
6. Commit with the phase name (for example `phase-3: relay core`). Only then start the next phase.

If a phase report lists an open question, answer it (update `docs/DECISIONS.md`) before the next phase.

### A4. How you know nothing was missed

- `docs/TEST_MATRIX.md` lists **every** rule in this specification with a test ID (Part E). The final gate requires every row to be green or explicitly marked "manual" with a real-phone check.
- Every phase ends with a gate of exact commands that must pass: no red tests, no skipped tests, coverage thresholds met.
- Phase 11 runs everything together: all automated suites, load, chaos, and the rolling-deploy-under-load test. Then you run the real-phone script (E4).

### A5. Tasks only humans can do, and when

| When | Task | Needed by |
|---|---|---|
| Day 1 | Sign up for Oracle Cloud (Mumbai home region), upgrade to Pay As You Go, add a budget alert, create two Arm VMs with `cloud-init.yaml` (18.4). Card checks and capacity can take days. | Phase 10 |
| Day 1 | Generate the CI deploy key pair (`ssh-keygen -t ed25519 -C pehchaan-ci-deploy`). The public key goes into `cloud-init.yaml`; the private key becomes the `DEPLOY_SSH_KEY` secret. | Oracle VM creation |
| Day 1 | Buy the domain; point it to Cloudflare; turn on DNSSEC and the registrar lock | Phase 5 (the rpId is decided by the domain) |
| Week 1 | GitHub repository with `staging` and `production` Environments; enable 2FA everywhere (16.6) | Phase 1 |
| Week 1 | Vercel project connected to the repo, with production and staging domains | Phase 5 |
| Week 2 | Generate VAPID keys (`pnpm tsx infra/scripts/vapid-keys.ts`), the Lab password hash, and the other random secrets; put them into each VM's `.env` and the GitHub secrets | Phase 6 |
| Week 3 | Sentry, Grafana Cloud, uptime monitor and backup bucket accounts; generate the backup `age` key pair and keep the private key offline (two people) | Phases 9–10 |
| Every phase from 5 on | Try the new features on two real phones | continuous |
| Now | Ask the GDG CRCE organisers in writing what "from scratch" allows (25.1) | before the event |

### A6. Ownership still matters

Claude Code writes the code, but the judges will ask **you** how it works.
- After Phase 2, every teammate walks through `packages/crypto/src/verifier.ts` line by line and can explain each of the 7 checks without notes (section 26).
- Keep that file short, commented and free of cleverness. B5 tells Claude Code to write it that way.

---

# PART B: RULES FOR CLAUDE CODE

### B0. `CLAUDE.md` (create this file at the repository root, exactly as below)

```markdown
# Pehchaan backend: rules for Claude Code

## Source of truth
- docs/BACKEND_SPEC.md (this project's specification). Part C holds every behaviour; Part D the phase you are on;
  Part E the tests. docs/FRONTEND_SPEC.md describes the existing frontend in apps/web.
- If the code and the spec disagree, the spec wins. If the spec is silent, choose the SAFER behaviour
  (fail closed; "Not confirmed yet" rather than any green), record it in docs/DECISIONS.md, and mention it in
  the phase report. If it changes security, a wire format or a screen, STOP and ask.
- Never change a signed or wire format (canonical request, card v2, envelope, auth message, E2E, psig) beyond
  what the spec says. Test vectors in spec 10.2 must keep reproducing exactly.

## Test as you build (mandatory)
- For every change: write or extend the tests for the spec rule FIRST, see them fail, implement, see them pass.
- After every edit, the PostToolUse hook runs the related tests. If it reports a failure you did not
  expect (a regression rather than a test you just wrote), fix it before touching anything else.
- Before saying a step or phase is done, run the phase's gate commands (Part D). The Stop hook
  also runs the fast gate when you try to finish; if it is red, keep working until it is green.
  Never end a phase with a red gate: if you truly cannot fix something, say so in the report.
- Run independent suites in parallel (turbo, Vitest workers, Playwright workers). When a phase allows it,
  use a separate subagent to write tests from the spec independently of the implementation, so the code
  is not grading itself.
- NEVER: skip, delete, weaken or `.only` a test to get green; mock WebCrypto, the verifier or the canonical
  functions; replace real Valkey/Postgres with fakes in integration tests; leave a TODO in security code.
- Every spec rule has a row in docs/TEST_MATRIX.md (ID, spec section, test file and name, status).
  Update it in the same commit as the test.
- Every bug found later: first add a failing test that reproduces it, then fix.

## Commands
- pnpm install · pnpm dev · pnpm test · pnpm test:watch · pnpm test:integration · pnpm test:e2e
- pnpm turbo run lint typecheck test build   (the fast gate)
- docker compose -f infra/compose/docker-compose.dev.yml up -d   (Valkey + Postgres for tests)

## Never
- Make the relay verify answers, open envelopes or import packages/crypto/verifier or e2e.
- Log payloads, nonces, signatures, grants, push endpoints, names, labels or phone numbers.
- Compare another device's timestamps with this device's clock (spec 8.7).
- Publish Valkey or Postgres ports; commit secrets; use `any` in packages/protocol or packages/crypto.
- Accept an answer without UP and UV, or show VERIFIED unless all 7 checks pass and decision is ME.
- Use any word from scripts/banned-words.txt (the team's list) in code, UI text or docs. The approved
  terms for the test tools are "Security Lab", "Test environment" and "judging session".
- Add a dependency to packages/crypto (WebCrypto only) or packages/protocol (zod only).

## Style
- TypeScript strict, ESM, Node 22. Small files, one responsibility each. Comments explain WHY.
- Security-critical code (packages/crypto, relay authorisation, Lua scripts) is plain, readable and
  commented line by line: the team must be able to explain it to judges.
```

### B1. The test-as-you-build discipline, in detail

Testing happens **during** implementation, never after it. For every unit of work (one function, one message handler, one screen state):

1. **Find the rule.** Identify the spec section and the Part E test IDs it covers.
2. **Red.** Write the tests first, straight from the rule: the normal case, every error case the spec lists, and the edge cases (limits, expiry, duplicates, bad input). Run them and watch them fail for the right reason.
3. **Green.** Write the smallest correct implementation. The hook re-runs the related tests on every save.
4. **Widen.** Run the whole package suite, then the fast gate. Integration and end-to-end suites run whenever their area changes.
5. **Record.** Update `docs/TEST_MATRIX.md` rows to ✅, in the same commit.

**What "parallel" means here:**
- **Tests are written alongside the code, never at the end of a phase.**
- The PostToolUse hook re-runs the related tests after every single edit, so testing never falls behind the code.
- Suites run concurrently: `turbo` runs packages in parallel, Vitest uses worker threads, and Playwright runs several browser workers.
- For big phases, Claude Code starts a **separate subagent** that writes tests from the specification *without looking at the implementation*. The implementation must then pass tests it didn't shape.

**Test types and where they run:**

| Type | Tool | Runs against | When |
|---|---|---|---|
| Unit | Vitest | Pure code; real WebCrypto (Node 22) | On every edit (hook) |
| Property / fuzz | Vitest + `fast-check` | Parsers, canonical JSON, DER, schemas | On every edit to those files |
| Integration | Vitest | The real relay process(es) + real Valkey + real Postgres (Docker) | Every relay change; the gate |
| End to end | Playwright (3 contexts, CDP virtual WebAuthn authenticator) | Real relay + real app build | Every app or protocol change; the gate |
| Load / chaos | `apps/loadgen`, chaos scripts | Local Compose stack or staging | Phases 10–11 |
| Manual | Real phones | Staging/production | E4, at the end of phases 5–11 |

**Coverage thresholds**, enforced in CI (`vitest --coverage`); below them the gate is red:

| Package | Lines | Branches |
|---|---|---|
| `packages/crypto` | 100% | 100% |
| `packages/protocol` | 100% | 100% |
| `apps/relay/src/core`, `ws`, `push`, `lab` | ≥ 90% | ≥ 85% |
| `apps/web/src/services/real` | ≥ 90% | ≥ 85% |

### B2. What every phase report contains

At the end of each phase, Claude Code prints:
1. What was built (files, briefly).
2. Test counts per suite: passed, failed (must be 0), skipped (must be 0).
3. Coverage per package, compared with B1.
4. `TEST_MATRIX.md` rows closed in this phase, and rows still open (with the phase that will close them).
5. Decisions it made where the spec was silent (also in `docs/DECISIONS.md`).
6. Anything that needs a human: an open question, an account, a secret, a real-phone check.

### B3. Automatic testing hooks (`.claude/settings.json` and `scripts/claude/`)

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|MultiEdit|Write",
        "hooks": [{ "type": "command", "command": "node scripts/claude/test-related.mjs", "timeout": 300 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node scripts/claude/gate.mjs", "timeout": 900 }] }
    ]
  }
}
```

```js
// scripts/claude/test-related.mjs: after each edit, run the tests related to the edited file.
// Exit code 2 sends the output back to Claude Code, so it deals with the failure before moving on.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
if (!existsSync('turbo.json')) process.exit(0);                      // before Phase 1: nothing to test
const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
let cmd = null;
if (/\.lua$/.test(file)) cmd = 'pnpm --filter @pehchaan/relay test:integration';   // Lua runs only in Valkey
else if (/\.(ts|tsx|js|mjs)$/.test(file) && !file.includes('node_modules'))
  cmd = `pnpm exec vitest related --run --passWithNoTests "${file}"`;
if (!cmd) process.exit(0);
try {
  execSync(cmd, { stdio: 'pipe', timeout: 280_000, maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  process.stderr.write(('Related tests fail. If you just wrote them (red step), implement next; ' +
    'otherwise fix the regression now. Never weaken a test.\n' +
    `${e.stdout ?? ''}${e.stderr ?? ''}`).slice(-8000));
  process.exit(2);
}
```

```js
// scripts/claude/gate.mjs: when Claude Code tries to finish, run the fast gate. If it is red, send Claude
// back to work, up to 3 times in a row (a counter prevents an endless loop), then let it stop and report.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
if (!existsSync('turbo.json')) process.exit(0);
readFileSync(0, 'utf8');                                              // consume the hook input
const counter = '.claude/.gate-blocks';
try {
  execSync('pnpm turbo run lint typecheck test build', { stdio: 'pipe', timeout: 850_000, maxBuffer: 64 * 1024 * 1024 });
  rmSync(counter, { force: true });
} catch (e) {
  const n = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
  if (n > 3) { rmSync(counter, { force: true }); process.exit(0); } // give up blocking; the report must say "gate red"
  mkdirSync('.claude', { recursive: true });
  writeFileSync(counter, String(n));
  process.stderr.write((`The fast gate (lint, typecheck, test, build) is red (attempt ${n}/3). Keep working and fix it.\n` +
    (e.stdout ?? '') + (e.stderr ?? '')).slice(-8000));
  process.exit(2);
}
```

- If the hooks slow things down too much, keep only the PostToolUse hook, and run the gate by hand at the end of each phase.
- Check the current hook documentation (`/hooks` inside Claude Code) if the format has changed since this was written.

### B4. When the specification is silent or seems wrong

| Situation | What Claude Code does |
|---|---|
| A detail is missing but doesn't affect security, the wire format or a screen | Choose the simplest option consistent with the spec, add a line to `docs/DECISIONS.md`, and mention it in the phase report |
| Two spec sections seem to disagree | Stop and ask, quoting both passages. Never pick one silently. |
| The existing frontend code differs from `FRONTEND_SPEC.md` (names, file layout) | Follow the **code's** names and structure, but the **spec's** behaviour. Record the mapping in `docs/DECISIONS.md`. |
| A library API differs from the spec's example code | Keep the behaviour and adapt the call. Add a test proving the behaviour. |
| A test in Part E can't be automated (a real fingerprint, a real phone's battery saver) | Mark the `TEST_MATRIX.md` row "manual" with the E4 step that covers it, and automate the closest simulation that is possible |

### B5. Code rules for the security core

- `packages/crypto/src/verifier.ts` stays **under about 150 lines**, has one comment per check, and uses no helper that hides a check.
- The relay's authorisation lives in **one** module (`apps/relay/src/core/authz.ts`), with one function per row of the 16.3 table and a test per row.
- Every Lua script lives in its own `.lua` file with a header comment, and is loaded with `defineCommand`. Each has tests against real Valkey, including concurrent races (for example two answers at the same instant).
- `zod` schemas are `.strict()` for inbound data, with explicit length and format limits (16.2). The relay and the app import the **same** schemas from `packages/protocol`.

---

# PART C: THE SPECIFICATION (sections 0–27)

*Claude Code: this part is the source of truth. Each phase in Part D names the sections to read, and Part E names the tests that prove each rule.*

**How to read Part C**

- **C·I (sections 0–4)** holds the decisions. Read it first; it takes 15 minutes.
- **C·II and C·III (sections 5–14)** are the build specification: identities, protocol, delivery, cryptography, push, the Security Lab.
- **C·IV and C·V (sections 15–27)** cover data, security, privacy, operations, testing, frontend changes, failure modes, runbooks, build order and ownership.
- **Tiers.** Every feature is tagged:
  - **P0**: needed for judging day, and done properly (no shortcuts that must be rewritten later).
  - **P1**: needed before real families use it.
  - **P2**: needed as usage grows.

  The architecture is the same in all three tiers. Tiers only decide *when* something gets built, never *how*.

| Sub-part | Sections |
|---|---|
| C·I Decisions | 0 Decisions at a glance · 1 What the backend is · 2 Architecture · 3 Stack and reasons · 4 Repository |
| C·II Identity and protocol | 5 Identities and keys · 6 Family card v2, safety words, grants · 7 Wire protocol · 8 Request lifecycle and delivery · 9 End-to-end encryption · 10 Signing and verification (the 7 checks) |
| C·III Delivery features | 11 Web Push · 12 Presence · 13 Alerts and Call Guard · 14 Security Lab |
| C·IV Data, security, privacy | 15 Data stores · 16 Hardening · 17 Privacy (DPDP) |
| C·V Operations | 18 Infrastructure (free hosting) · 19 Observability · 20 Scaling · 21 Testing · 22 Frontend changes · 23 Failure modes · 24 Runbooks · 25 Build order · 26 Ownership · 27 Version 2 |
| Appendix | A. One complete check on the wire |

---

# PART C·I: DECISIONS

## 0. Decisions at a glance

| Area | Decision | Tier |
|---|---|---|
| Frontend hosting | Vercel, custom domain `app.yourdomain.in` (installable PWA) | P0 |
| Relay runtime | Node.js 22 LTS + TypeScript (strict) | P0 |
| Relay framework | Fastify 5 for HTTP routes; `ws` 8 for WebSockets (raw upgrade handling, no Socket.IO) | P0 |
| Protocol | JSON over WebSocket (`wss://relay.yourdomain.in/v1/ws`); one shared `zod` schema package used by both the app and the relay | P0 |
| Ephemeral state | Redis-protocol store (Valkey/Redis 7+): routing, pub/sub between relay processes, 60 s inbox, request records, rate limits | P0 |
| Durable state | PostgreSQL 16 + Drizzle ORM: devices, push subscriptions, contact grants, contact bindings, audit events, Lab log | P0 |
| Background delivery | Standard Web Push with VAPID, sent by the relay (reaches Chrome/Android via FCM and installed iPhone apps via Apple's push service) | P0 |
| Identity | Self-certifying device keys (no accounts, no passwords, no OTPs); passkeys (WebAuthn) for answers | P0 |
| Confidentiality | End-to-end encryption of every payload (ECDH P-256 + HKDF + AES-256-GCM), plus a sender signature | P1 (the protocol carries it from P0) |
| Relay host | **Free:** one Oracle Cloud "Always Free" Arm VM in Mumbai running Docker Compose: Caddy (HTTPS) in front of two relay containers. A second free VM is staging and the standby. Full comparison of free options in 18.1. | P0 |
| Redis host | Valkey 8 in a container on the same VM, on the private Docker network only. Its data is disposable by design (15.4). | P0 |
| Postgres host | Postgres 16 in a container on the same VM, with nightly encrypted backups to a free bucket at a different provider (18.10) | P0 |
| DNS / edge | Cloudflare DNS; registrar lock and DNSSEC on | P0 |
| Errors | Sentry (app and relay) | P0 |
| Metrics / logs | `prom-client` metrics and structured `pino` logs, collected by Grafana Alloy on the VM and sent to Grafana Cloud (free tier); Grafana dashboards | P0 metrics and logs, P1 dashboards and alerts |
| Tracing | OpenTelemetry → Grafana Cloud | P2 |
| Uptime | External monitor on `/healthz` (free tier), plus a synthetic "canary" check every 10 minutes from GitHub Actions | P0 monitor, P1 canary |
| Monthly cost | **₹0.** Every service above runs on a free tier; only the domain costs money (18.11). | P0 |
| CI/CD | GitHub Actions; pnpm workspaces + Turborepo | P0 |
| Tests | Vitest (unit, integration against real Redis/Postgres), Playwright with a virtual WebAuthn authenticator (end to end), a Node load generator (load) | P0 unit and E2E, P1 load |
| Scale-up destination | The same Docker image on paid hosts: first Fly.io or a bigger VM with managed Redis and Postgres, then AWS `ap-south-1` (ECS Fargate + ElastiCache Valkey cluster + RDS Postgres). Each step is a configuration change, not a code change (20.2). | P2 |

**Rules that never change (the reason nothing needs rewriting later):**

1. **The relay never decides whether someone is who they say they are.** Only Maa's phone decides, using the 7 checks. The relay moves sealed envelopes and nothing else.
2. **Gateways are stateless.** Any relay machine can serve any phone. All shared state lives in Redis (seconds to minutes) or Postgres (durable). This makes horizontal scaling a matter of adding machines.
3. **All wire formats are versioned from day one:** the envelope `v`, the card `v`, the canonical request `v` and the WebSocket subprotocol `pehchaan.v1`.
4. **Standard protocols only:** the Redis protocol, the Postgres protocol, Web Push, WebAuthn and WebCrypto. Every vendor in the table above can be swapped for another that speaks the same protocol.
5. **The server stores no names, no phone numbers, no amounts and no message contents.** Those live only on phones. This is what keeps a breach survivable and privacy compliance simple.

---

## 1. What the backend is (and what it is not)

"Backend" in Pehchaan means two things. They live in different places.

| Part | Where it runs | What it does | Who owns the trust |
|---|---|---|---|
| **The relay** | A free Oracle Cloud VM in Mumbai (servers) | Authenticates *devices* (not people), routes envelopes between phones, holds undelivered envelopes for up to 60 s, sends Web Push when the app is closed, enforces who may contact whom, rate-limits abuse, and runs the Security Lab (only during the judging window, 14.1) | Nobody needs to trust it for honesty. It is only trusted to stay up. |
| **The security core** | On every phone, in the app (`packages/crypto`) | Passkey creation and signing, the canonical request format, sealing and opening envelopes, and **the verifier (the 7 checks)** | Maa trusts her own phone and nothing else. |

### 1.1 Trust model: who can do what

| Party | Can | Cannot |
|---|---|---|
| **Maa's phone** (the asker) | Create requests, run the 7 checks, show verdicts, send alerts | Make Arjun's passkey sign anything |
| **Arjun's phone + passkey** (the answerer) | Sign "ME" or "NOT_ME" for one exact request, and only after a fingerprint/PIN unlock | Sign without the unlock. The passkey is also bound to `app.yourdomain.in`, so it cannot sign for a look-alike site. |
| **The relay** (including anyone who hacks it, or a malicious employee) | Delay or drop messages (Maa sees "Not confirmed yet"). Corrupt messages (Maa sees "Fake answer"). See metadata: which device IDs talk, when, and the message kind. | Produce a green "Confirmed", read contents once E2E is on (P1), learn names, phone numbers or amounts, or forge a NOT ME |
| **Push services** (Google FCM, Apple) | Delay or drop notifications; see the same metadata as the relay | Read payloads (Web Push encrypts to the device, and the payload inside is also E2E-sealed) |
| **The scammer on the call** | Pressure Maa, try to rush her, try to make Arjun tap "Yes" by mistake, and send his own family link claiming "this is my new phone" | Answer as Arjun (no passkey), replay Arjun's old answers, or change a NOT ME. The "new phone" trick is blocked in section 6.5; a mistaken "Yes" is caught by the confirmation words in section 10.8. |
| **Whoever controls the frontend deployment** (Vercel account, GitHub `main` branch, DNS) | Ship modified app code, which could fake a verdict screen | **This is the real trusted base.** It is protected in section 16.6: 2FA everywhere, protected branches, deploys only from CI, a registrar lock, DNSSEC, and a native signed app in v2. |

**The one-sentence security claim:** as long as Maa runs the genuine app, nobody who controls the network, the relay or the push services can make her phone show "Confirmed" unless Arjun himself unlocked his phone and approved that exact request.

### 1.2 What the backend deliberately does not do

- No user accounts, passwords, OTP logins or phone-number verification. The device key *is* the identity. Accounts would add a phishing target and personal data without adding security.
- No server-side verification of answers. If the server verified answers, it would become something to trust and something to attack.
- No storage of family lists. The family graph lives on phones. The relay only knows "device A may contact device B", as opaque IDs.
- No AI or LLM anywhere in the trust path. Call Guard uses transparent keyword rules and only *suggests* a check.

---

## 2. Architecture

### 2.1 Components

```
                         ┌──────────────────────────────┐
                         │  Vercel  ·  app.yourdomain.in │   static PWA (HTML/JS/SW)
                         └──────────────┬───────────────┘
                                        │ install / update (HTTPS)
          ┌─────────────────────────────┴─────────────────────────────┐
          │                                                           │
   ┌──────▼──────┐                                             ┌──────▼──────┐
   │ Maa's phone │                                             │Arjun's phone│
   │ PWA + SW    │                                             │ PWA + SW    │
   │ verifier    │                                             │ passkey     │
   └──────┬──────┘                                             └──▲───┬──────┘
          │ wss (TLS)                                  Web Push  │   │ wss (TLS)
          │                                   (when app closed)  │   │
   ┌──────▼──────────────────────────────────────────┐  ┌───────┴─┐ │
   │ Free Oracle Cloud VM · Mumbai · Docker Compose  │  │ FCM /   │ │
   │ Caddy: HTTPS + balancing, relay.yourdomain.in   │  │ Apple   │ │
   │  ┌────────────┐  ┌────────────┐                 │  │ push    │ │
   │  │  relay-a   │  │  relay-b   │◄────────────────┼──┼─────────┼─┘
   │  └─────┬──────┘  └─────┬──────┘                 │  └────▲────┘
   │        └───────┬───────┘     web-push ──────────┼───────┘
   │   ┌────────────▼───┐  ┌──────────────┐          │
   │   │ Valkey (Redis) │  │ Postgres 16  │          │
   │   │ routes, pub/sub│  │ devices,     │          │
   │   │ inbox, limits  │  │ grants, push │          │
   │   └────────────────┘  └──────────────┘          │
   └─────────────────────────────────────────────────┘
```

- **Gateways** (identical relay processes: two containers on the free VM, more on bigger hosts) terminate WebSockets.
  - Each keeps an in-memory map of `deviceId → sockets` for the phones connected to it, and nothing else in memory.
  - **Caddy** terminates TLS (free Let's Encrypt certificates, renewed automatically) and spreads new connections across the relay containers, skipping any that fail their health check.
- **Redis** knows which gateway holds which device. A gateway delivers to a device on another gateway by publishing to that gateway's channel.
- **Postgres** is the system of record for the few durable facts: who may contact whom, the push endpoints, and the block list.
- **Web Push** reaches a phone whose app is closed. The service worker wakes up, decrypts the envelope, and shows a notification.

### 2.2 One verification, end to end (the real sequence)

Setting: Maa gets a call from someone claiming to be Arjun. Arjun's phone is in his pocket with Pehchaan closed.

| # | Where | What happens | Typical time |
|---|---|---|---|
| 1 | Maa's phone | Maa taps Verify → Arjun → Money ₹50,000 → "Ask Arjun's phone". The app builds a `VerifyRequest` (new `requestId`, 32-byte `nonce`, `expiresAt = now + 60 s`), saves it locally as *pending*, seals it to Arjun's encryption key and sends it. | 0 ms |
| 2 | Gateway A | Checks the device session, rate limits, and that Maa may contact Arjun (binding). Creates the request record in Redis (who asked whom, deadline). Stores the envelope in Arjun's inbox. Returns `receipt: accepted` to Maa. | +40 ms |
| 3 | Gateway A | Looks up Arjun's route. No live socket, so it sends Web Push (urgency high, TTL 60 s). Maa gets `receipt: pushed`. | +300 ms |
| 4 | Arjun's phone | The push arrives. The service worker decrypts the envelope, checks Maa's sender signature, and shows the notification "Maa is asking: are you on a call with her?" | +0.5–3 s |
| 5 | Arjun's phone | Arjun taps the notification. The app opens `/request/:id`, connects the WebSocket, drains its inbox and sends `seen` (Maa's screen can show "Seen"). F1 shows the question with the relay-supplied time left. | +2–10 s (human) |
| 6 | Arjun's phone | Arjun taps **NO, NOT ME**. The passkey prompt appears; fingerprint. The passkey signs the SHA-256 of the canonical request joined to `NOT_ME` (section 10.2). The app seals the answer to Maa's encryption key (her key came inside the request) and sends it with `re = requestId`. | +1–3 s |
| 7 | Gateway B | Checks that Arjun is a target of this request, that it is still open (first answer wins), and within the deadline. Marks it answered. Routes it to Maa's gateway via pub/sub (or her inbox, or push if her app is backgrounded). | +40 ms |
| 8 | Maa's phone | Opens the envelope and runs the **7 checks** against the pending request and Arjun's saved card. All pass, and the decision is NOT_ME, so the verdict is **DENIED**: "Not Arjun. Do not send money." Alerts go to the rest of the family. The nonce is marked used. | +50 ms |

End-to-end latency is dominated by the human (steps 5–6), then by push delivery (step 4). Relay work is under 100 ms, so the relay's region matters much less than its uptime.

---

## 3. The final stack, with reasons

### 3.1 Why each choice

| Choice | Why this one |
|---|---|
| **Node.js 22 + TypeScript** | The frontend is TypeScript, so the protocol schemas and crypto code are shared, not duplicated. Node 22 has WebCrypto built in (`globalThis.crypto.subtle`), so the *same* crypto code runs in tests, the relay and the browser. A single Node process comfortably holds tens of thousands of idle WebSockets. The team only needs one language. |
| **`ws` (not Socket.IO)** | The fastest mainstream Node WebSocket library, with full control of the upgrade (Origin check, rate limits and subprotocol *before* accepting). Socket.IO's fallbacks and rooms are not needed, and its custom framing would lock the app into its client. Pehchaan's reliability features (acks, retries, inbox) are designed explicitly in section 8 rather than hidden in a library. |
| **Fastify** | Fast, schema-first HTTP with good TypeScript support, for the few HTTP routes: health, readiness, time, config, inbox fetch and metrics. |
| **`zod` in `packages/protocol`** | One schema per message, used to validate at the relay *and* at the phone. Types are inferred from the schemas, so the protocol cannot drift. |
| **Redis protocol (Valkey on the free VM now; managed Redis or an ElastiCache/Valkey cluster later)** | Sub-millisecond routing lookups, pub/sub fan-out between gateways, TTL-based expiry (a natural fit for 60-second requests), and atomic Lua scripts for "first answer wins" and rate limits. Everything in Redis is *ephemeral by design*, so losing it costs at most one in-flight verification (it ends as "Not confirmed yet", the safe outcome). |
| **Postgres + Drizzle** | For the small durable facts that need constraints and transactions (bindings, revocations, push subscriptions). Drizzle is typed SQL with versioned migrations and no runtime magic. |
| **Web Push (VAPID)** | The only standard way to wake a closed PWA on both Android and iPhone. No Firebase SDK is needed in the app; the browser handles FCM/APNs. The same relay code later adds direct FCM/APNs when native wrappers arrive (v2). |
| **Oracle Cloud Always Free Arm VM (Mumbai)** | The only free option that is always on, is a real VM running the exact same Docker image, sits in India, and has room to grow (2 OCPU and 12 GB free in total). Free container platforms sleep when idle, and a sleeping relay drops every phone. Vercel's own WebSockets are still in public beta: each connection is pinned to one function instance and closes when the function hits its maximum duration, which rules them out for a relay that holds connections for hours. The full comparison of free hosts is in 18.1. |
| **Docker Compose + Caddy** | One file describes the whole server: two relay containers (so a deploy or a crash never takes the relay down), Valkey, Postgres, backups and monitoring. Caddy obtains and renews HTTPS certificates by itself and balances WebSockets across the relays. The same file runs on a laptop, the free VM or any other VM. |
| **Valkey and Postgres in the same VM** | Free, with no pause-on-idle, no command caps and sub-millisecond latency. Valkey needs no backups (15.4). Postgres is backed up nightly, encrypted, to another provider (18.10). Moving either to a managed service later is a change to `REDIS_URL` or `DATABASE_URL`. |
| **Cloudflare DNS** | Fast DNS, DNSSEC, and optional DDoS proxying for the relay later (P1). |

### 3.2 Alternatives considered and rejected

| Alternative | Why not |
|---|---|
| Firebase (Firestore + FCM) | The whole trust story needs a dumb relay whose behaviour we specify exactly. Firestore rules and listeners hide delivery semantics, cannot host the Security Lab's hold/modify/inject, and lock the app to a vendor SDK. |
| Pusher / Ably / other managed realtime | Paying per connection or message for simple routing. Custom authorisation (first answer wins, bindings) would still need our own server, and the Lab would be impossible. |
| Cloudflare Durable Objects | Technically excellent for this pattern, but it needs a different runtime (Workers) and different local development, and brings more lock-in. It remains a valid v2 option: the protocol would not change. |
| Go / Elixir relay | More connections per core, but a second language in a small team. Node's capacity (sections 20.1 and 20.2) is far beyond what Pehchaan needs for years. |
| Serverless functions (Vercel, Lambda) for the relay | WebSockets need long-lived processes. HTTP polling would drain batteries and add seconds of latency. |
| Accounts with phone OTP | They add cost (SMS), personal data, SIM-swap risk and a phishing target, with no security gain over device keys and passkeys. |

---

## 4. Repository layout

One monorepo, managed with pnpm workspaces and Turborepo.

```
pehchaan/
├─ apps/
│  ├─ web/                 the finished frontend (moved in from the builder export)
│  ├─ relay/               the relay server (this document)
│  ├─ loadgen/             WebSocket load generator (section 21.4)
│  └─ canary/              synthetic check run on a schedule (section 19.6)
├─ packages/
│  ├─ protocol/            zod schemas, message types, error codes, limits, constants
│  └─ crypto/              canonical JSON, challenge, device keys, seal/open (E2E),
│                          safety words, DER→raw, authenticatorData parser, VERIFIER
├─ infra/
│  ├─ docker/Dockerfile.relay, Dockerfile.backup
│  ├─ vm/                compose.yml, Caddyfile, cloud-init.yaml, deploy.sh, config.alloy, env.example
│  ├─ compose/docker-compose.dev.yml   (valkey + postgres for local dev and CI)
│  ├─ grafana/dashboards/*.json
│  └─ scripts/             vapid-keys.ts, lab-password-hash.ts   (the admin CLI lives in apps/relay/src/admin.ts)
├─ .github/workflows/      ci.yml, deploy-relay.yml, canary.yml
├─ scripts/               claude/ (hooks), check-test-matrix.mjs, banned-words.txt
├─ turbo.json  pnpm-workspace.yaml  tsconfig.base.json
└─ docs/                   this spec, runbooks, threat model, privacy notice
```

**Code boundaries** (enforced by `dependency-cruiser` in CI, so they can't erode):

| Package | May import | Must never import |
|---|---|---|
| `apps/web` | `protocol`, `crypto` | anything from `apps/relay` |
| `apps/relay` | `protocol`, and `crypto/device-auth` (to check device login signatures only) | `crypto/verifier`, `crypto/e2e` (the relay never verifies answers and never opens envelopes) |
| `packages/crypto` | WebCrypto only (`globalThis.crypto.subtle`), no Node-only or DOM-only APIs | network, storage |
| `packages/protocol` | `zod` | everything else |

**If you still edit the frontend in the no-code builder:**
- Keep `apps/web` in its own builder-synced repository until you stop using the builder.
- Vendor `packages/protocol` and `packages/crypto` into `src/shared/` with a script (`pnpm sync:shared`).
- Add a CI job that fails if the vendored copy's hash differs from the monorepo's.
- Once UI work moves to code, bring the frontend into `apps/web`.

---

# PART C·II: IDENTITY, CARDS AND THE PROTOCOL

## 5. Identities and keys

### 5.1 The keys every device holds

Every device has its own identity, including a checks-only phone, the judge's browser, the Call Guard laptop page and the Security Lab page. There are no accounts.

| Key | Algorithm | Created | Stored | Used for | Tier |
|---|---|---|---|---|---|
| **Device signing key** | ECDSA P-256, `extractable: false` | First launch, before any screen needs the relay | IndexedDB (the `CryptoKey` object itself, which is structured-cloneable) | Logging in to the relay; signing every envelope it sends (sender signature) | P0 |
| **Device encryption key** | ECDH P-256, `extractable: false` | First launch | IndexedDB | Opening E2E envelopes addressed to this device | P0 (created), P1 (used) |
| **Contact grant** | 8-byte ID + 16-byte secret, random | First launch | IndexedDB | Lets people who hold this device's card contact it (section 6.4) | P0 |
| **Passkey** | WebAuthn ES256 (`alg: -7`), platform authenticator, user verification required | Key creation in setup (A6), only for the "can be verified" role | The phone's secure hardware / password manager (Google Password Manager, iCloud Keychain, Samsung Pass) | Signing answers (ME / NOT_ME) | P0 |

Public keys are always exported in **raw uncompressed form**: 65 bytes starting with `0x04`, base64url-encoded (87 characters).

### 5.2 The device ID

```
deviceId = base64url( SHA-256( devicePubRaw ) ).slice(0, 22)      // 132 bits
```

- It is **self-certifying**: anyone holding the public key can check that the ID belongs to it, so the relay needs no registration database to know that a device is genuine.
- It replaces the random `deviceId` the frontend currently generates (section 22).
- It never changes for the life of the install. A reinstall creates a new identity (section 6.6).

### 5.3 Where passkeys are bound: the relying party ID (rpId)

| Environment | App origin | rpId | Relay |
|---|---|---|---|
| Development | `https://dev-<name>.yourdomain.in` (Cloudflare named tunnel to the laptop) | `dev-<name>.yourdomain.in` | same origin, path `/relay` proxied by Vite |
| Staging | `https://staging.yourdomain.in` | `staging.yourdomain.in` | `wss://relay-staging.yourdomain.in/v1/ws` |
| Production | `https://app.yourdomain.in` | `app.yourdomain.in` | `wss://relay.yourdomain.in/v1/ws` |

**Why the exact host and not `yourdomain.in`:** with rpId `yourdomain.in`, *every* subdomain (staging, a preview, a forgotten test site) could ask for signatures with production passkeys. Binding to `app.yourdomain.in` isolates production completely.

If the app ever moves host, WebAuthn Related Origin Requests (a `/.well-known/webauthn` file on the old host listing the new origin) let existing passkeys keep working. **Never change the production rpId after launch.**

Vercel preview URLs (`*.vercel.app`) run with simulated keys only. Real passkeys cannot work there, by design.

### 5.4 Keeping keys alive on the phone

Browser storage can be cleared, and losing IndexedDB means losing the device keys and the family list.

- Call `navigator.storage.persist()` right after setup, and show the result in Diagnostics ("Storage: protected" / "Storage: may be cleared").
- Chrome on Android grants this readily to installed PWAs. Safari clears website storage after 7 days without use, *unless* the app is installed to the Home Screen.
- **iPhone rule:** install to the Home Screen *first*, then set up. An installed iPhone app has storage separate from Safari. A family member added in Safari is not visible in the installed app. The setup screens enforce this on iOS (section 22).
- Passkeys live in the password manager, not in the app. They survive a storage wipe, but the app forgets which credential was its own. After a wipe the person sets up again and the family re-adds them (section 6.6).
- JavaScript cannot delete a passkey. On "Delete my key", call `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })` where supported (Chrome 132+), so the password manager can hide the orphaned passkey. Otherwise tell the person where to delete it in their password manager.

---

## 6. The family card v2, safety words and who may contact whom

### 6.1 What a card contains

A card is what the QR code and the family link carry. v2 adds the device keys and the contact grant. Keys are short to keep the QR code small.

| Key | Meaning | Example / size |
|---|---|---|
| `v` | Card version | `2` |
| `d` | Device ID | 22 chars |
| `n` | Display name | "Arjun" (≤ 40 chars) |
| `p` | Phone number, optional | "+9198…10" |
| `c` | Avatar colour | "indigo" |
| `r` | Role: `v` = can be verified, `c` = checks only | "v" |
| `dk` | Device signing public key (raw, b64url) | 87 chars |
| `ek` | Device encryption public key (raw, b64url) | 87 chars |
| `kt` | Answer key type: `pk` = passkey (P0), `pin` = device-key PIN fallback (P2) | "pk" |
| `ki` | Passkey credential ID (b64url) | 22–90 chars |
| `pk` | Passkey public key (raw, b64url, converted from the SPKI) | 87 chars |
| `g` | Contact grant: `<grantId>.<secret>` (b64url) | 34 chars |
| `ts` | When the card was made (ms) | 13 digits |

Rules:
- Checks-only cards omit `kt`, `ki` and `pk`.
- **Safety words are not in the card.** Every phone derives them itself (section 6.3). A card that claims its own words could lie.

**Encoding.** `https://app.yourdomain.in/join#c=<base64url(UTF-8 JSON)>`
- The card travels in the **URL fragment**, which browsers never send to servers. Vercel's logs never see it.
- A full card is about 750–800 characters, which makes a dense but reliable QR code. Keep the frontend's "Larger" full-screen QR mode.
- A binary encoding (CBOR) would save about 25% if needed later (P2), under a new `v`.

**Validation in `CardService.fromLink`** (before showing anything):
1. `v === 2`. A `v: 1` card shows "Ask {name} to update Pehchaan and show their code again."
2. Every key decodes, and every public key is 65 bytes starting with `0x04`.
3. `deviceIdFrom(dk) === d`, otherwise "This card has been altered. Don't add it."
4. `d` is not your own device, and each field is within its length limit.
5. The checks in section 6.5 (the "new phone" guard).

### 6.2 Where the grant and keys are used

| Card field | Who uses it | For |
|---|---|---|
| `dk` | Anyone who adds this person | Checking the sender signature on envelopes from them |
| `ek` | Anyone who adds this person | Sealing requests, alerts and prompts to them |
| `ki`, `pk` | Anyone who adds this person | **The verifier's checks 2 and 6**, and naming the credential in `allowCredentials` |
| `g` | Anyone who adds this person | First contact through the relay (section 6.4) |

### 6.3 Safety words

Both phones must show the same four words, and it must be infeasible to produce a *different* card that shows the same words.

```
fingerprint = SHA-256( canonical({ v: 2, d, dk, ek, kt?, ki?, pk? }) )      // section 10.1 canonical JSON
stretched   = PBKDF2-HMAC-SHA-256( password = fingerprint,
                                   salt = "pehchaan-safety-words-v2",
                                   iterations = 600_000, length = 64 bits )
words       = 4 × 11-bit indexes into the BIP-39 English wordlist (2048 words), UPPERCASE
```

- Four words are only 44 bits. Without stretching, an attacker who intercepts a family link could grind keys on a GPU in under an hour until the words match.
- PBKDF2 at 600,000 iterations (native WebCrypto, about 0.3–0.8 s on a mid-range phone, computed once per card and cached) raises that to decades per GPU.
- The frontend's current "SHA-256 of the public key" derivation is replaced by this (section 22).
- A Devanagari wordlist for Hindi users is a v2 item. The words are compared visually, so English capitals work for now.

### 6.4 Contact grants and bindings (who may contact whom)

Without this, anyone who obtains a card (a leaked screenshot, a forwarded link) could send requests to that person forever.

- **Grant.** Each device has one active grant, `g = <grantId>.<secret>`, and registers `SHA-256(secret)` with the relay (`grant.set`) on every login. The relay never needs the secret stored.
- **First contact.** A sender includes the grant it holds when it sends to someone. If the hash matches an active grant for that target, the relay records a **binding** `(target ← sender)`.
- **Afterwards.** The binding is what authorises the sender. The sender keeps including the grant, which makes the system self-healing (section 15.4).
- **Answers need no binding.** They are authorised by the open request record: Arjun can always answer whoever asked him, even if he never added them. This is exactly what makes the judge's family-link flow work.

| Action | Where in the app | Relay message | Effect |
|---|---|---|---|
| Remove {label} from family (C7) | Existing screen, plus a checkbox "Also reset my code, so they can't reconnect from a new phone" (on by default) | `contact.revoke { deviceId }`, then `grant.set { rotate: true }` if ticked | That device can no longer contact me, even with my grant |
| Reset my code | Settings → Privacy (new row) | `grant.set { rotate: true }` | Old cards stop working for *new* people; existing bindings keep working |
| Who can reach me | Settings → Privacy (new screen, P1) | `contact.list` | Lists bound devices; names come from my family list where known, otherwise "Device added via your code on {date}", each with "Remove" |

**Limits:** 50 bindings per target, 20 new bindings per target per day, and 20 new bindings per sender per day.

A revoked binding cannot be recreated with any grant. Only removing and re-adding in person (a new QR scan, which the target does deliberately) clears it: the target sends `contact.unrevoke` when *it* adds that device.

Revocation blocks one device identity. Someone who still holds your grant could create a *new* identity (reinstall the app) and bind again. That is why Remove also resets your code by default. People who already reach you keep working, because their bindings stay; only people who hold your old card but never contacted you need to add you again.

### 6.5 The "new phone" scam guard

The classic script is "*Maa, mera phone toot gaya, naye phone se bol raha hoon*": my phone broke, I'm calling from a new one. The obvious next step for a scammer is to send Maa a family link for *his own* card named "Arjun" and read out its safety words on the call.

These rules close it:

| Situation when adding a card | What the app does |
|---|---|
| Same `d` as an existing member, identical keys | "{label} is already in your family." |
| Same `d`, different `ek`/`ki`/`pk` | Hard block: "This card has been altered. Don't add it." |
| **Different `d`, but the same name or phone number as an existing member** | Full-screen red warning: "This is **not** the {label} you saved. Someone may be pretending to be {label} with a new phone. Don't add this." The only buttons are "Don't add" and "Call {label} on their saved number". |
| Any card arriving through a family link (C8) | Can only add a *new* person. It can never replace an existing member. |
| Someone really did change phones | Remove the old entry, then add the new phone **face to face** with a QR scan (C4/C5). Remote replacement is a v2 feature using passkey-signed rotation (section 27). |

C8 also gets a line above the words: "Only add people you've met, or called back on a number you already had."

### 6.6 Reinstalls, lost phones and leaving

| Event | v1 behaviour (P0/P1) |
|---|---|
| App reinstalled or storage wiped | New device keys → new device ID → new card. Family members re-add in person. Old bindings point to a dead ID and are harmless. |
| Phone lost or stolen | The finder cannot answer anything without the screen lock (user verification is required). Arjun tells his family; each removes the old "Arjun" (C7) and adds the new phone in person. v2: a passkey-signed revocation that updates everyone automatically (section 27). |
| "Delete my key" / leave Pehchaan | The app sends `device.retire`. The relay closes its sockets and turns the device row into a **tombstone**: that device ID can never log in again. Within 24 hours it deletes the device's grants, push subscriptions, inbox, the bindings where it is the target, and the non-revoked bindings where it is the sender. **Revoked bindings are kept**, so a blocked device can't erase its block by retiring. |

---

## 7. The wire protocol (v1)

### 7.1 Transport

| Property | Value |
|---|---|
| URL | `wss://relay.yourdomain.in/v1/ws` |
| Subprotocol | `pehchaan.v1` (the client sends it, the relay echoes it; anything else → HTTP 426) |
| Origin allowlist | Exactly the app origin(s) of that environment. Checked *before* the upgrade (HTTP 403). The Origin header is a browser safeguard, not authentication; device signatures are the authentication. |
| Frames | Text only, UTF-8 JSON, ≤ 16 KiB. A frame between 16 and 64 KiB gets `error too_large`. The socket-level limit (`maxPayload: 65536`) closes anything larger with 1009. Binary frames close with 1003. |
| Compression | `permessage-deflate` **off**. Messages are tiny, and compressing attacker-influenced data next to secrets is a known risk class. |
| Heartbeat (relay) | WebSocket ping every 25 s. A socket that misses 2 pongs is terminated. This also keeps proxy idle timers (Cloudflare's is about 100 s) from cutting quiet connections. |
| Heartbeat (app) | Browsers can't send ping frames, so the app sends `{t:"ping"}` every 25 s while in the foreground and treats a missing `pong` after 10 s as a dead connection (reconnect). |
| Authentication deadline | 10 s after the connection opens, otherwise close 4408 |
| Sockets per device | Up to 3 (for example the installed app plus a browser tab). Deliveries go to all of them; the first `ack` counts. A 4th socket closes the oldest with 4409. |

### 7.2 The envelope

Every frame, in both directions, has this shape:

```jsonc
{ "v": 1,            // envelope version
  "t": "send",       // message type (section 7.4)
  "id": "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",   // ULID made by the sender; unique; used for acks and dedupe
  "ts": 1761900000000,                // sender's clock (informational only; never trusted)
  "body": { } }
```

Messages from the relay also carry `"sts"`, the relay's clock in ms. Apps use it to keep a clock offset for display, never for security decisions.

Parsing is strict:
- The outer envelope rejects unknown `t` values.
- Each body is validated with its `zod` schema in `.strict()` mode (unknown fields are rejected).
- Any validation failure → `error { code: "bad_request", of: id }`. Three bad frames in a minute → close 4400.

### 7.3 The login handshake

```
app                                   relay
 │── WebSocket upgrade (Origin, subprotocol) ──►│  Origin + IP limit checked, upgrade accepted
 │◄── hello { serverNonce, serverTime, gatewayId, minClient, vapidKeyId, env, e2eRequired } ──│
 │── auth { deviceId, devicePub, sig, client:{ver, platform} } ──►│
 │                                              │  1. devicePub is 65 bytes, 0x04 prefix
 │                                              │  2. deviceIdFrom(devicePub) === deviceId
 │                                              │  3. ECDSA verify(sig, message below)
 │                                              │  4. device not retired / blocked
 │                                              │  5. client.ver >= minClient, else 4426
 │◄── auth.ok { serverTime, pushStatus, lab } ──│  route registered, inbox drained after this
```

The signed message binds the relay host (so a staging login can't be replayed against production) and the one-time server nonce (so a captured login can't be replayed at all):

```ts
// packages/crypto/src/device-auth.ts   (used by the app to sign and by the relay to verify)
import { utf8, b64url, b64urlDecode } from './bytes';

export function authMessage(relayHost: string, serverNonce: string, deviceId: string) {
  return utf8(`pehchaan-auth-v1\n${relayHost}\n${serverNonce}\n${deviceId}`);
}

export async function deviceIdFrom(pubRaw: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', pubRaw));
  return b64url(h).slice(0, 22);
}

// App side
export async function signAuth(priv: CryptoKey, msg: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, msg);
  return b64url(new Uint8Array(sig));          // WebCrypto ECDSA output is raw r‖s, 64 bytes
}

// Relay side
export async function verifyAuth(b: { deviceId: string; devicePub: string; sig: string },
                                 serverNonce: string, relayHost: string): Promise<boolean> {
  const pub = b64urlDecode(b.devicePub);
  if (pub.length !== 65 || pub[0] !== 0x04) return false;
  if ((await deviceIdFrom(pub)) !== b.deviceId) return false;
  const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' },
                                            false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
                              b64urlDecode(b.sig), authMessage(relayHost, serverNonce, b.deviceId));
}
```

- `relayHost` comes from the relay's configuration (`RELAY_HOST`), never from the request's Host header.
- `serverNonce` is 32 random bytes, used once per socket.
- On success the relay upserts the `devices` row (`device_id`, `device_pub`, `last_seen_on`; at most one write per device per day).

### 7.4 Message catalogue

**App → relay**

| `t` | Body | Purpose | Tier |
|---|---|---|---|
| `auth` | `deviceId, devicePub, sig, client{ver, platform}` | Log in (7.3) | P0 |
| `ping` | `{}` | App heartbeat → `pong` | P0 |
| `send` | `kind, to, re?, grant?, ttlMs, e2e? \| (plain + psig)?` | Send an envelope to **one** device. `kind` ∈ `verify.request`, `verify.answer`, `alert`, `guard.prompt`. Exactly one of `e2e` (sealed, section 9) or `plain` with its sender signature `psig` (readable; only when the relay allows it, section 9.5). `re` is required for requests and answers. Several recipients (alerts) = one `send` each. | P0 |
| `ack` | `of` (the delivered message id) | "I received it": clears my inbox entry and tells the sender `delivered` | P0 |
| `seen` | `re` (request id) | "The question is on my screen": tells the asker `seen` | P1 |
| `cancel` | `re` | The asker stops waiting (D3 Cancel) → the targets get `verify.cancel` | P0 |
| `presence.query` | `ids[]` (≤ 50) | Who is reachable, among devices I may contact | P0 |
| `push.subscribe` | `endpoint, p256dh, auth, vapidKeyId` | Save or refresh my Web Push subscription (sent on every login) | P0 |
| `push.unsubscribe` | `endpoint` | Remove it | P0 |
| `push.test` | `{}` | Push a test notification to *me* after 10 s (Diagnostics "Send test alert") | P0 |
| `grant.set` | `grantId, hash, rotate` | Register my contact grant (sent on every login; `rotate: true` revokes older grants) | P0 |
| `contact.list` | `{}` | Who can reach me | P1 |
| `contact.revoke` / `contact.unrevoke` | `deviceId` | Block, or unblock after re-adding in person | P0 |
| `device.retire` | `{}` | Delete everything about this device | P1 |
| `lab.*` | section 14 | Security Lab (only when `LAB_ENABLED`) | P0 |

**Relay → app**

| `t` | Body | Purpose | Tier |
|---|---|---|---|
| `hello` | `serverNonce, serverTime, gatewayId, minClient, vapidKeyId, env, e2eRequired` | First frame after connecting. `e2eRequired` tells the app whether `plain` will be refused (9.5). | P0 |
| `auth.ok` | `serverTime, pushStatus: 'ok'\|'missing'\|'expired', lab: {optedIn, until?}` | Logged in | P0 |
| `pong` | `serverTime` | Heartbeat reply | P0 |
| `deliver` | `from, kind, re?, ttlMs, late?, e2e? \| (plain + psig)? \| system?` | An envelope for you. `ttlMs` is the relay-computed time left. `system` carries relay-generated notices such as `verify.cancel`. | P0 |
| `receipt` | `of, to?, re?, state, reason?` | What happened to something you sent: `accepted`, `pushed`, `delivered`, `seen`, `queued`, `failed`, `rejected` | P0 (`seen`: P1) |
| `presence` | `states: { [deviceId]: 'online' \| 'push' \| 'offline' }` | Reply to `presence.query` | P0 |
| `contact.list.result` | `contacts[{deviceId, since, via: 'grant' \| 'unrevoked'}]` | Reply to `contact.list` | P1 |
| `error` | `code, of?, retryAfterMs?` | Something you sent was refused (7.5) | P0 |
| `reconnect` | `afterMs` | This relay process is shutting down; reconnect after the given delay (section 18.9) | P0 |
| `lab.*` | section 14 | Security Lab | P0 |

**Payloads inside `e2e` (after opening) or `plain`**

| `kind` | Payload |
|---|---|
| `verify.request` | `{ spk, sek, fromName, req: { v:1, requestId, nonce, fromDeviceId, toDeviceId, claimedLabel, reason?, amountInr?, createdAt, expiresAt } }` |
| `verify.answer` | `{ spk, ans: { requestId, nonce, decision, keyType: 'pk', credId, authenticatorData, clientDataJSON, signature, answeredAt } }` |
| `alert` | `{ spk, sek, alert: { id, type, aboutDeviceId?, aboutLabel, victimName, victimPhone?, amountInr?, createdAt } }` |
| `guard.prompt` | `{ spk, prompt: { claimedLabel, claimedDeviceId?, amountInr?, tactics[], at } }` |

- `spk` / `sek` are the sender's device signing and encryption public keys (raw, b64url). The receiver can then check the sender and reply even if the sender isn't in its family list, as with the judge's phone.
- `aboutDeviceId` lets each recipient show *its own* label for the person ("Arjun" for Papa, "Bhaiya" for a sister), falling back to `aboutLabel`.
- `victimName` is the sender's own name.

**System notices** (made by the relay, not end-to-end): `verify.cancel { reason: 'asker_cancelled' | 'answered_elsewhere' | 'expired' }`.

### 7.5 Error codes and close codes

| `error.code` | Meaning | What the app does |
|---|---|---|
| `bad_request` | Schema or size violation | Log to Sentry (it's a bug) |
| `unauthenticated` | Sent before `auth.ok` | Reconnect |
| `not_allowed` | No binding, revoked, not a target of that request, or Lab not opted in | For a request: end D3 at once on E3 with a new line, "{label}'s phone isn't accepting checks from you. Add them again in person.", instead of "Couldn't reach the network" (section 22) |
| `unknown_target` | Device ID never seen, or retired | Same line as above |
| `rate_limited` | Too many (`retryAfterMs` given) | Wait and retry automatically; show "Slow down…" after 2 refusals |
| `too_large` | Frame over 16 KiB | Bug; Sentry |
| `duplicate_request` | A request ID was reused | Bug; Sentry |
| `already_answered` / `cancelled` / `expired` | The answer was refused | The answerer sees F4 "This request expired" (or "Already answered on another device") |
| `e2e_required` | `plain` sent where not allowed | Bug; Sentry |
| `unavailable` | Redis or another dependency is down (the relay fails closed) | Retry with backoff |
| `lab_disabled` / `lab_denied` | Lab off or wrong password | Lab page message |

| Close code | Meaning |
|---|---|
| 1001 | Going away (tab closed) |
| 1003 | Binary frame |
| 1008 | Origin or policy violation (also: a reader so slow that 1 MiB is waiting to be sent, 16.2) |
| 1009 | Frame larger than 64 KiB |
| 1012 | Service restart (a drain; reconnect with jitter) |
| 4400 | Repeated bad frames |
| 4401 | Login failed |
| 4403 | Device retired or blocked |
| 4408 | Login timeout |
| 4409 | Replaced by a newer socket from the same device |
| 4426 | App too old: the app shows "Update Pehchaan" and reloads its service worker |
| 4429 | Connection rate limit |

### 7.6 Versioning and compatibility

- The envelope `v` and the subprotocol only change for breaking changes. The relay supports the current and previous versions for at least 30 days.
- `minClient` in `hello` forces old app builds to update (4426). This is also how the app version is frozen before judging day.
- New optional fields are allowed at any time. Schemas are `.strict()` for *inbound* data, and the app ignores unknown fields in *outbound* notices.
- Signed formats (the canonical request, the card, the auth message) carry their own versions and are never changed in place.

---

## 8. Request lifecycle and delivery

### 8.1 The request record (Redis)

| Field | Value |
|---|---|
| Key | `rq:<requestId>` (hash), TTL = deadline + 90 s |
| `from` | Asker's device ID (the authenticated sender, never taken from the payload) |
| `to` | Comma-separated target device IDs (exactly 1 in v1; a list, so several phones per person can come in v2, 8.11) |
| `deadline` | `relayNow + clamp(ttlMs, 10 000, 60 000)`, computed on the **relay's clock** |
| `state` | `open` → `answered` \| `cancelled` \| `expired` |
| `by` | The device that answered |

The relay never reads `expiresAt` from the request, which is inside the E2E seal. It uses the `ttlMs` the asker put on the outer envelope, clamped. Creating a record with an existing `requestId` fails with `duplicate_request` (`HSETNX`-style Lua).

### 8.2 Routing: finding a device

| Key | Type | Meaning |
|---|---|---|
| `gw:<gatewayId>:alive` | string, TTL 30 s | Refreshed by each gateway every 10 s. If it's missing, the gateway is dead. |
| `rt:<deviceId>` | set of gateway IDs | Which gateways hold a socket for this device. `SADD` on login; `SREM` when the device's last socket on that gateway closes. |
| channel `gw:<gatewayId>` | pub/sub | Deliveries for devices on that gateway |

There is **no per-device heartbeat in Redis.** Liveness is tracked per gateway, so Redis load stays tiny no matter how many phones are connected. When routing finds a gateway ID whose `alive` key is gone, it removes that ID from the set (lazy cleanup).

On Redis reconnect, each gateway re-adds routes for all its live sockets, so routes self-heal after a Redis restart.

### 8.3 The delivery algorithm

```ts
// apps/relay/src/core/router.ts (shape of the real code)
async function route(env: DeliverFrame, to: DeviceId, p: { inbox: boolean; push: boolean; ttlMs: number }) {
  if (p.inbox) await store.inboxPut(to, env, p.ttlMs);        // durable across gateways for ttlMs
  const gateways = await store.aliveGatewaysFor(to);           // SMEMBERS rt:<to>, filtered by alive keys
  if (gateways.length === 0) {
    if (p.push) return push.send(to, env, p.ttlMs);            // → receipt 'pushed' or 'queued'
    return 'queued';
  }
  for (const g of gateways) {
    if (g === SELF) localDeliver(to, env, p.push);
    else await bus.publish(g, { to, env, push: p.push });       // the owning gateway calls localDeliver
  }
  return 'routed';
}

// On the gateway that owns the socket(s):
function localDeliver(to: DeviceId, env: DeliverFrame, pushAllowed: boolean) {
  const ttl = remainingTtl(env);                               // relay deadline − relay now
  if (ttl <= 0) return;                                        // too late: drop, never deliver stale
  env.body.ttlMs = ttl;                                        // F1's countdown is always fresh
  const sockets = sessions.get(to);
  if (!sockets?.size) return pushAllowed ? push.send(to, env, ttl) : undefined;
  for (const s of sockets) s.send(JSON.stringify(env));
  // A backgrounded phone may hold a socket that the OS has frozen. No ack in 1.5 s → push.
  acks.arm(env.id, 1500, () => pushAllowed && push.send(to, env, remainingTtl(env)));
}
```

| Kind | Inbox? | Push if not acked? | Inbox TTL | Push urgency |
|---|---|---|---|---|
| `verify.request` | yes | yes | until the deadline | high |
| `verify.answer` | yes | yes (Maa's app may be backgrounded while she's on the call) | deadline + 30 s | high |
| `verify.cancel` (system) | yes | yes, with the same push `Topic` as the request, so it *replaces* the request's notification | 60 s | high |
| `alert` | yes | yes | 24 h | high |
| `guard.prompt` | yes | yes | 2 min | high |
| `receipt`, `presence`, `error` | no | no | none | none |

Every delivery (live, inbox drain or push) rewrites `body.ttlMs` to the time left on the relay's clock: the inbox score (the deadline) minus now. A frame with no time left is dropped.

### 8.4 Acks, receipts and retries

**The sender's view** (these receipts drive the D3 status line and "Family alerted: {names}"):

| Receipt | When |
|---|---|
| `accepted` | The relay authorised the message and stored it (in the inbox, or routed). **`sendRequest()` resolves on this.** |
| `pushed` | A push service accepted the notification |
| `delivered` | The target device sent `ack` |
| `seen` | The target showed the request on screen (F1 open) |
| `queued` | No socket and no push subscription, but kept in the inbox until the TTL |
| `failed` | Push failed permanently (subscription gone) and there is no socket |
| `rejected` | Not authorised (`reason` = the error code) |

**The app's outbox (reliability).**
- Every `send` is kept in an outbox (IndexedDB for answers, memory for the rest) and re-sent with the **same `id`** every 2 s until a receipt of `accepted` or `rejected` arrives, or the TTL passes.
- The relay deduplicates with `SET dd:<from>:<id> NX PX 300000`. A duplicate gets the original receipt again and is not routed twice.
- `sendRequest()` rejects if no `accepted` arrives within 5 s. D3 then shows NO_RESPONSE with `relay_unreachable`.

**The receiver's rules.**
- Always `ack` immediately after parsing a `deliver`, even before opening it.
- Deduplicate by message `id` and by `requestId`.

### 8.5 The inbox

| Key | Type |
|---|---|
| `{d:<deviceId>}:ib` | Sorted set: message id → expiry time (the hash tag keeps both keys in one Redis Cluster slot) |
| `{d:<deviceId>}:m:<msgId>` | The frame, with `PX` = its TTL |

- **On put** (Lua, atomic): remove expired members, refuse if the inbox holds more than 50 entries (`queued` becomes `failed`, and that device is flagged as abused), `ZADD`, `SET PX`, and refresh the set's TTL to 24 h.
- **On login:** read every unexpired message id → `MGET` the frames → deliver in expiry order, soonest first → remove each entry when its `ack` arrives.

Put Lua (reference):

```lua
-- KEYS[1] = {d:<id>}:ib   KEYS[2] = {d:<id>}:m:<msgId>
-- ARGV: msgId, expiresAtMs, frameJson, ttlMs, nowMs, maxEntries
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[5])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[6]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
redis.call('PEXPIRE', KEYS[1], 86400000)
return 1
```

### 8.6 First answer wins, and cancellation

- **Answer arrives** (Lua, atomic on `rq:<id>`). The check order is:
  1. The record exists, otherwise `expired`.
  2. `from` equals the envelope's recipient.
  3. The sender is in `to`.
  4. The state is `open`, otherwise `already_answered` / `cancelled`.
  5. `now ≤ deadline + 30 s` grace, otherwise `expired`.

  Then set `state = answered`, `by = sender`, and return `ok`, or `ok_late` if `now > deadline`. The relay routes the answer to the asker with `late: true` when late, and sends `verify.cancel { answered_elsewhere }` to the other targets (multi-device).
- **Asker cancels** (`cancel { re }`): allowed only when `from` is the sender and the state is `open` → `cancelled`. The targets get `verify.cancel { asker_cancelled }`. F1 closes with "Maa stopped waiting" (a new small state, section 22).
- **Deadline passes with no answer:** the record expires by TTL. The asker's own 60 s timer produces NO_RESPONSE, and the answerer's F1 countdown (from `ttlMs`) produces F4.

Answer-check Lua (reference):

```lua
-- KEYS[1] = rq:<requestId>   ARGV: answererId, recipientId, nowMs, graceMs
local r = redis.call('HMGET', KEYS[1], 'from', 'to', 'state', 'deadline')
if not r[1] then return 'expired' end
if r[1] ~= ARGV[2] then return 'not_allowed' end
if not string.find(',' .. r[2] .. ',', ',' .. ARGV[1] .. ',', 1, true) then return 'not_allowed' end
if r[3] == 'answered' then return 'already_answered' end
if r[3] == 'cancelled' then return 'cancelled' end
local now, deadline = tonumber(ARGV[3]), tonumber(r[4])
if now > deadline + tonumber(ARGV[4]) then return 'expired' end
redis.call('HSET', KEYS[1], 'state', 'answered', 'by', ARGV[1])
if now > deadline then return 'ok_late' end
return 'ok'
```

### 8.7 Time: never trust another phone's clock

Indian phones are frequently minutes off, and a two-minute skew would make Arjun's F1 show "expired" instantly.

| Rule | How |
|---|---|
| A device only compares *its own* timestamps with *its own* clock | Maa's verifier checks freshness against the `createdAt`/`expiresAt` she set herself |
| The answerer's countdown uses `ttlMs` from the relay | F1 time left = `ttlMs − (localNow − localReceivedAt)`. `expiresAt` inside the request is never compared with Arjun's clock. |
| The relay uses only its own clock | Deadlines, grace periods, rate limits |
| Display times are corrected | Each app keeps `offset = serverTime − localNow` from `auth.ok`/`pong`, for "sent 4 s ago" style labels only |

### 8.8 Late answers

- The relay forwards answers up to 30 s after the deadline, marked `late: true`. After that it refuses them (`expired`) and the answerer sees F4.
- What the asker's app shows for a late answer is defined in section 10.7. In short: a valid late **NOT ME** still shows **DENIED**, because it is true and important. A late **YES** never turns green; the screen stays "Not confirmed yet" with the line "{label} answered after the time ran out. Ask again."

### 8.9 Reconnection (app)

- **Backoff:** 0.5, 1, 2, 4, 8 s, then every 8 s, each with ±30% random jitter, so thousands of phones don't reconnect at the same instant after a deploy.
- **Reconnect immediately** on the browser's `online` event, on `visibilitychange` to visible, and on notification click.
- **`reconnect { afterMs }` from the relay:** wait `afterMs` (0–5 s, randomised by the relay), then reconnect. Caddy sends the new connection to a healthy relay container.
- **After `auth.ok`:**
  1. Re-send `grant.set` and `push.subscribe`.
  2. Flush the outbox.
  3. Receive the inbox drain.
- **UI states** map to `ConnectionState`:
  - `connected`: authenticated.
  - `reconnecting`: a retry is scheduled or in progress for less than 30 s.
  - `offline`: `navigator.onLine === false`, or reconnecting for 30 s or more.

### 8.10 Ordering and duplicates

- Delivery order is **not** guaranteed after a reconnect: a `verify.cancel` can arrive before its request.
- The app keeps a 2-minute *tombstone* set of cancelled and finished request IDs, and drops any request found in it.
- Messages carry unique IDs, so duplicates are harmless.

### 8.11 Ready for several phones per person (v2)

- The request record already holds a list of targets. First answer wins (8.6), and `verify.cancel { answered_elsewhere }` already exists.
- In v1, `send` goes to one device. v2 adds a per-recipient seal map (`e2e: { [deviceId]: Sealed }`) so one request reaches all of a person's phones. That is an additive change under envelope `v: 2`.
- Adding "Arjun's tablet" later is then a card change (a list of devices), with no change to the relay's logic.

---

## 9. End-to-end encryption

### 9.1 What it protects, and what the relay still sees

| Sealed (relay cannot read or change it undetected) | Visible to the relay (metadata) |
|---|---|
| Names, labels, phone numbers, amounts, reasons, nonces, passkey signatures, the decision (ME / NOT_ME), alert and prompt contents | Sender and recipient device IDs, `kind`, `re` (request ID), message size, timing, IP addresses |

The relay needs the metadata to route and to enforce "first answer wins". The privacy notice says this plainly (section 17).

E2E is **not** what stops a false green. The passkey signature and the 7 checks do that, even with E2E off, which is exactly what the Security Lab shows. E2E adds confidentiality, and a second tamper seal for everything that isn't an answer (requests, alerts, prompts).

### 9.2 The construction

For each recipient, separately:

```
header H   = { v:1, kind, id, from, to: <this recipient>, re? }         (the deliver frame's own fields)
aad        = UTF-8( canonical(H) )
eph        = fresh ECDH P-256 key pair (per message)
z          = ECDH(eph.private, recipient.ek)                            32 bytes
K          = HKDF-SHA-256(ikm = z, salt = epk ‖ recipient.ek,
                          info = "pehchaan-e2e-v1|" + kind)           → AES-256-GCM key
iv         = 12 random bytes
ct         = AES-256-GCM(K, iv, aad).encrypt( UTF-8(JSON(payload)) )    (includes the 16-byte tag)
sig        = ECDSA-P256-SHA-256(sender device key,
               "pehchaan-env-v1" ‖ SHA-256(aad) ‖ epk ‖ iv ‖ SHA-256(ct))
e2e        = { alg: "p256-hkdf-a256gcm", epk, iv, ct, sig }             all base64url
```

- **Opening** reverses this. Then check that `deviceIdFrom(payload.spk) === H.from`. If the sender is in my family list, also check that `spk` equals their saved `dk`. Finally verify `sig` with `spk`.
- **Any failure** means the envelope was tampered with in transit (section 9.4).
- The relay keeps the sender's message `id` when it delivers, so `H` rebuilds identically on the receiving side.
- **Why the sender signature?** Anyone can encrypt *to* Arjun, including the relay. The signature proves the envelope came from the device holding Maa's key, so the relay cannot fabricate "Maa is asking" requests or fake family alerts.
- A sealed request is about 720 bytes, well within the Web Push payload limit (section 11.4).

### 9.3 Reference implementation (`packages/crypto/src/e2e.ts`)

This code is tested: tampering with the header, the ciphertext or the sender, and a relay re-seal forgery, are all rejected. `bytes.ts` holds six small helpers used throughout: `utf8`, `b64url`, `b64urlDecode` (reject any character outside `A–Z a–z 0–9 - _`), `concat`, `equalBytes` and `sha256`.

```ts
import { utf8, b64url, b64urlDecode, concat, equalBytes, sha256 } from './bytes';
import { canonical } from './canonical';
import { deviceIdFrom } from './device-auth';

const ALG = 'p256-hkdf-a256gcm';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIG = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface Header { kind: string; id: string; from: string; to: string; re?: string }
export interface Sealed { alg: string; epk: string; iv: string; ct: string; sig: string }

export const headerAad = (h: Header) =>
  utf8(canonical({ v: 1, kind: h.kind, id: h.id, from: h.from, to: h.to, re: h.re }));

async function aesKey(priv: CryptoKey, peerPubRaw: Uint8Array, epk: Uint8Array,
                      recipientPub: Uint8Array, kind: string) {
  const peer = await crypto.subtle.importKey('raw', peerPubRaw, ECDH, false, []);
  const z = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256);
  const ikm = await crypto.subtle.importKey('raw', z, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(epk, recipientPub), info: utf8('pehchaan-e2e-v1|' + kind) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const sigInput = async (aad: Uint8Array, epk: Uint8Array, iv: Uint8Array, ct: Uint8Array) =>
  concat(utf8('pehchaan-env-v1'), await sha256(aad), epk, iv, await sha256(ct));

export async function seal(payload: object, h: Header, recipientEk: Uint8Array,
                           senderSignPriv: CryptoKey): Promise<Sealed> {
  const eph = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const key = await aesKey(eph.privateKey, recipientEk, epk, recipientEk, h.kind);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = headerAad(h);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, key, utf8(JSON.stringify(payload))));
  const sig = new Uint8Array(await crypto.subtle.sign(SIG, senderSignPriv, await sigInput(aad, epk, iv, ct)));
  return { alg: ALG, epk: b64url(epk), iv: b64url(iv), ct: b64url(ct), sig: b64url(sig) };
}

export async function open<T extends { spk: string }>(
  e: Sealed, h: Header, myEkPriv: CryptoKey, myEkRaw: Uint8Array, knownSenderDk?: string): Promise<T> {
  try {
    if (e.alg !== ALG) throw 0;
    const epk = b64urlDecode(e.epk), iv = b64urlDecode(e.iv), ct = b64urlDecode(e.ct);
    const aad = headerAad(h);
    const key = await aesKey(myEkPriv, epk, epk, myEkRaw, h.kind);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
    const payload = JSON.parse(new TextDecoder().decode(pt)) as T;
    const spk = b64urlDecode(payload.spk);
    if ((await deviceIdFrom(spk)) !== h.from) throw 0;                        // sender key ↔ sender id
    if (knownSenderDk && !equalBytes(spk, b64urlDecode(knownSenderDk))) throw 0;  // matches saved card
    const pub = await crypto.subtle.importKey('raw', spk, ECDSA, false, ['verify']);
    if (!(await crypto.subtle.verify(SIG, pub, b64urlDecode(e.sig), await sigInput(aad, epk, iv, ct)))) throw 0;
    return payload;
  } catch {
    throw new Error('tampered');
  }
}
```

The app then validates the opened payload with its `zod` schema. Never trust the shape just because the seal verified.

### 9.4 When opening fails

| Envelope | What the app does |
|---|---|
| `verify.answer` | The answer can't be read, so the verifier can't run. The app returns **INVALID, reason `changed`** directly. Check 3 shows as failed with the detail "The sealed answer was changed on the way"; checks 1, 2 and 4–7 show as *not checked* (`CheckResult.skipped = true`, a grey dash; section 22). The E4 line "The answer was changed on the way." is already accurate. |
| `verify.request` | Drop it silently (a tampered request cannot be answered safely) and send a Sentry event with no content |
| `alert`, `guard.prompt` | Drop it; Sentry event |

### 9.5 When `plain` is allowed

| Relay setting | `plain` accepted when |
|---|---|
| `E2E_REQUIRED=false` (P0, including production, until E2E ships) | Always |
| `E2E_REQUIRED=true` (production from P1) | Only when **both** sender and recipient are opted in to the Security Lab (section 14), so the Lab can show and rewrite readable traffic |

**`plain` is still signed by its sender:**

```
psig = ECDSA-P256-SHA-256(sender device key,
         "pehchaan-plain-v1" ‖ SHA-256(aad) ‖ SHA-256( UTF-8( canonical(plain) ) ))      // aad as in 9.2
```

- Receivers verify `psig` with the same sender-key checks as 9.2 for **requests, alerts and prompts**, and drop the message if it fails. So even before E2E ships, the relay can't fabricate "Maa is asking" or a family alert.
- For **answers**, the passkey signature and the 7 checks are the authentication, so `psig` isn't checked. That is exactly what lets the Security Lab's altered answers reach the verifier and be caught there.
- Once an app has E2E (FC-7), it always sends `e2e`: every sender holds the recipient's `ek` (from the card, or `sek` inside the request). The only exception is between two Lab-opted-in devices. It also **refuses incoming `plain` unless its own Lab opt-in is on**, so the relay can't quietly downgrade it. `hello.e2eRequired` only says whether the relay will refuse `plain`.

### 9.6 Limits, stated honestly

- Each message uses a fresh sender key. But if a phone's long-term encryption key were stolen, *recorded* past traffic to that phone could be opened. The relay keeps nothing beyond each message's TTL, which limits the exposure.
- v2 adds rotating signed pre-keys for full forward secrecy.
- Metadata (who contacts whom, and when) remains visible to the relay operator. Minimising and deleting it is covered in section 17.

---

## 10. Signing and verification (the heart of Pehchaan)

This section replaces `SimKey` and `SimVerifier`.

**Ownership rule:** the reference code below is here so that the security behaviour is exactly right. The team types it themselves, runs the test vectors, and every teammate can explain every line (section 26).

### 10.1 Canonical JSON

"Canonical" means one exact string for a given object, so that both phones hash identical bytes. The rules match RFC 8785 (JCS) for the value types Pehchaan uses:

- Object keys are sorted by UTF-16 code units (JavaScript's default `.sort()`), recursively.
- There is no whitespace. Fields whose value is `undefined` are omitted.
- Strings are encoded exactly as `JSON.stringify` does. Devanagari stays as raw UTF-8, not `\u` escapes.
- **Only safe integers are allowed.** Amounts are whole rupees, and times are integer milliseconds. A non-integer throws.

```ts
// packages/crypto/src/canonical.ts
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('canonical: integers only');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => o[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
```

### 10.2 The canonical request and the challenge

The fields are exactly those in frontend Part E, plus `v: 1`. `fromName`, `fromLabel` and `channel` are display-only and are **not** signed.

```ts
export const canonicalRequest = (r: VerifyRequest) => canonical({
  v: 1, requestId: r.requestId, nonce: r.nonce, fromDeviceId: r.fromDeviceId,
  toDeviceId: r.toDeviceId, claimedLabel: r.claimedLabel, reason: r.reason,
  amountInr: r.amountInr, createdAt: r.createdAt, expiresAt: r.expiresAt });

// challenge = SHA-256( UTF-8( canonicalRequest + "|" + decision ) )
export const challengeFor = async (r: VerifyRequest, decision: 'ME' | 'NOT_ME') =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(canonicalRequest(r) + '|' + decision)));
```

**Test vectors.** These are computed with the code above. Commit them to `packages/crypto/test/vectors.json`; both the app and CI must reproduce them.

| | Value |
|---|---|
| Request A | `requestId "01JB7Y8Q3Z6N4V5W2K9C0D1E2F"`, `nonce "q3v0Yb7kP1sR9tXw2Zc5Hn8Ld4Fg6Jm0Ae3Uo7Iy1Qk"`, `fromDeviceId "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S"`, `toDeviceId "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F"`, `claimedLabel "Arjun"`, `reason "money"`, `amountInr 50000`, `createdAt 1761900000000`, `expiresAt 1761900060000` |
| canonical(A) | `{"amountInr":50000,"claimedLabel":"Arjun","createdAt":1761900000000,"expiresAt":1761900060000,"fromDeviceId":"Mx9Qe2Lr7Tb4Nw1Kc6Vh0S","nonce":"q3v0Yb7kP1sR9tXw2Zc5Hn8Ld4Fg6Jm0Ae3Uo7Iy1Qk","reason":"money","requestId":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","toDeviceId":"Ar3Jn8Pk2Wq5Ez7Uy1Gd4F","v":1}` |
| challenge(A, ME) | `AkKq6W7rOUy1nHaSjPrvv6mvzTN5GRnjzFU_PO_me48` |
| challenge(A, NOT_ME) | `G1-ucjqOjawjZo4jWCsqh_pcXUU-tBzduGo4HTRtORU` |
| Request B | Same as A but `claimedLabel "बेटा"`, with no `reason` and no `amountInr` |
| canonical(B) | `{"claimedLabel":"बेटा","createdAt":1761900000000,"expiresAt":1761900060000,"fromDeviceId":"Mx9Qe2Lr7Tb4Nw1Kc6Vh0S","nonce":"q3v0Yb7kP1sR9tXw2Zc5Hn8Ld4Fg6Jm0Ae3Uo7Iy1Qk","requestId":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","toDeviceId":"Ar3Jn8Pk2Wq5Ez7Uy1Gd4F","v":1}` |
| challenge(B, ME) | `PyFYvQ_1wBKrA4UzlF_mWCzD34oXoKpH51dNzrVeXu8` |
| challenge(B, NOT_ME) | `6OjlO8SRU1RPEshRJhofgvJsR6bz97XngSQTYLp6dZg` |
| rpIdHash of `app.yourdomain.in` | `zL2KHaulGgG03y83xSbj2v_f_X8quk0vYIHkQ0CRCAg` (recompute for your real domain) |

### 10.3 Creating the passkey (`RealKey.createKey`)

```ts
export async function createPasskey(p: { deviceId: string; name: string }) {
  const cred = (await navigator.credentials.create({ publicKey: {
    rp: { id: RP_ID, name: 'Pehchaan' },
    user: { id: utf8(p.deviceId), name: `${p.name} · Pehchaan`, displayName: p.name },
    challenge: crypto.getRandomValues(new Uint8Array(32)),   // no server: key authenticity comes from safety words
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],     // ES256 only
    authenticatorSelection: { authenticatorAttachment: 'platform',
                              residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none',
    timeout: 120_000,
    // @ts-expect-error newer field (Chrome 128+), ignored elsewhere
    hints: ['client-device'],
  } })) as PublicKeyCredential;

  const res = cred.response as AuthenticatorAttestationResponse;
  if (res.getPublicKeyAlgorithm() !== -7) throw new KeyError('unsupported');
  const spki = res.getPublicKey();
  if (!spki) throw new KeyError('unsupported');
  const ad = new Uint8Array(res.getAuthenticatorData());
  if (!(ad[32] & 0x04)) throw new KeyError('no_user_verification');   // a real unlock must have happened
  const k = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  return { credId: b64url(new Uint8Array(cred.rawId)),
           passkeyPub: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', k))) };
}
```

- **`checkSupport()`:**
  - `passkeys` = `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`.
  - `screenLock` = 'yes' when that is true. It can't be detected separately, so otherwise report 'unknown'.
- **Errors map to the existing A6 states:**
  - `NotAllowedError` (cancelled or timed out) → A6's existing "Key not created. Tap to try again."
  - `InvalidStateError` (already exists) → treat as success only if the stored `credId` matches, otherwise ask to reset.
  - `SecurityError` (wrong rpId or insecure origin) → configuration bug, report to Sentry.
- **Passkeys unsupported:** in P0/P1 the person continues as **checks only**, so they can still verify others. The A6 copy becomes "This phone can't create a key, so family can't verify you yet. You can still check others." The PIN fallback is P2 (section 10.10).

### 10.4 Signing an answer (`RealKey.signAnswer`)

**Safari's rule:** the passkey prompt must start within the user's tap, and an `await` before `navigator.credentials.get()` can lose that permission. So both challenges are computed **when F1 opens**, and the tap handler calls `get()` synchronously.

```ts
// When F1 opens:
const pre = { ME: await challengeFor(req, 'ME'), NOT_ME: await challengeFor(req, 'NOT_ME') };

// Tap handler: nothing awaited before credentials.get()
export function signAnswer(req: VerifyRequest, decision: 'ME' | 'NOT_ME'): Promise<WireAnswer> {
  const p = navigator.credentials.get({ publicKey: {
    challenge: pre[decision],
    rpId: RP_ID,
    allowCredentials: [{ type: 'public-key', id: b64urlDecode(my.credId), transports: ['internal'] }],
    userVerification: 'required',
    timeout: Math.max(5_000, timeLeftMs()),
  } }) as Promise<PublicKeyCredential>;
  return p.then(cred => {
    const a = cred.response as AuthenticatorAssertionResponse;
    return {
      requestId: req.requestId, nonce: req.nonce, decision, keyType: 'pk',
      credId: b64url(new Uint8Array(cred.rawId)),
      authenticatorData: b64url(new Uint8Array(a.authenticatorData)),
      clientDataJSON: b64url(new Uint8Array(a.clientDataJSON)),
      signature: b64url(new Uint8Array(a.signature)),          // ASN.1 DER, as WebAuthn returns it
      answeredAt: Date.now(),
    };
  });
}
```

- **`transports: ['internal']`** asks the browser to use the passkey on this phone (including one synced to it by the password manager) and not to offer "use a phone nearby" (hybrid/QR). It is a hint, not a guarantee, and no security property depends on it: whichever authenticator signs, it still needs the saved passkey and a fingerprint or PIN.
- **A synced passkey** (the same Google or Apple account on Arjun's tablet) still means *Arjun*. That is acceptable and expected.
- **`signCount`** is ignored, because synced passkeys report 0.
- **P1 self-check:** Arjun's app runs the verifier on its own answer before sending, to catch platform bugs early. This has no security value, only debugging value.

### 10.5 The verifier: exact definition of the 7 checks

**When to run it.** Run it only for an answer whose envelope `re` names a request this phone created that is still **waiting**, or that timed out less than 30 s ago (for the late-answer policy). Ignore every other answer; they are duplicates or noise.

**Inputs:**
- the pending request as stored locally, never the copy inside the answer;
- the opened answer;
- the relay-authenticated sender ID;
- the saved card of the person the request was sent to, looked up by the pending request's `toDeviceId` (**never** by the envelope's sender);
- the expected `origin` and `rpId`;
- this phone's receive time;
- the used-nonce store.

| # | key | Passes when | If it fails → reason |
|---|---|---|---|
| 1 | `fresh` | `ans.requestId` and `ans.nonce` equal the pending request's, **and** `receivedAt ≤ expiresAt` (my own clock, my own timestamps; the same instant D3's timer ends) | `reused` if the ID or nonce doesn't match; `expired` if only the time is wrong |
| 2 | `key` | The saved card's `d` equals the pending request's `toDeviceId`, the envelope's sender equals it too, **and** `ans.credId` equals the saved `ki` | `wrong_key` |
| 3 | `exact` | `decision` is ME or NOT_ME, **and** `clientData.challenge === b64url(challengeFor(pendingRequest, decision))` | `changed` |
| 4 | `address` | `clientData.type === "webauthn.get"`, `clientData.origin === ORIGIN`, `crossOrigin !== true`, and `authenticatorData[0..32] === SHA-256(RP_ID)` | `wrong_app` |
| 5 | `unlocked` | The flags byte `authenticatorData[32]` has UP (`0x01`) **and** UV (`0x04`) set | `not_unlocked` |
| 6 | `signature` | ECDSA P-256 / SHA-256 over `authenticatorData ‖ SHA-256(clientDataJSON)` verifies against the **saved** `pk`, with the DER signature converted to raw r‖s | `bad_signature` |
| 7 | `unused` | `ans.nonce` is not in the used-nonce store | `reused` |

**Verdict:**
- All 7 pass → **VERIFIED** if the decision is ME, **DENIED** if it is NOT_ME.
- **Only check 1 failed, and only because of time** (same request and nonce, arrived late) → apply the late policy (10.7).
- Anything else → **INVALID**. The reason is the highest-priority failed reason in this order:
  **`reused` › `wrong_key` › `wrong_app` › `changed` › `not_unlocked` › `bad_signature` › `expired`**

This order gives the frontend's expected results for the Security Lab. Each row was checked by running the reference implementation in 10.6 against that case:

| Attack | Checks failed | Reason shown |
|---|---|---|
| Change NOT ME → ME in transit | 3 | `changed` |
| Replay Arjun's old YES for a new request | 1, 3, 7 | `reused` |
| Forge a YES with an attacker key | 2, 6 | `wrong_key` |
| Signed on a look-alike origin | 4 | `wrong_app` |
| Signed without unlock | 5 | `not_unlocked` |
| UV bit set in transit (on an answer signed without unlock) | 6 | `bad_signature` |
| Answer's unsigned `nonce` field altered | 1 | `reused` |
| Request misrouted to another family member, who answers YES | 2, 6 | `wrong_key` |
| Genuine NOT ME arriving 9 s late | 1 (time only) | DENIED (late) |
| Genuine YES arriving 9 s late | 1 (time only) | NO_RESPONSE (`late`) |

**Even a NOT ME must pass all 7 checks to show DENIED.** A NOT ME that fails any check is INVALID ("Fake answer: do not trust this call"). That is equally safe for Maa, and it tells the truth about what happened.

**Marking the nonce used.** Right after a verdict or a cancel, add the request's nonce to the used-nonce store, before showing the screen. After a *timeout*, add it when the 30 s late window closes (or when a late answer has been handled, if that happens first). Otherwise a genuine late answer would be misreported as `reused`.

### 10.6 Reference implementation (`packages/crypto/src/verifier.ts`)

This is the tested reference behind the table above.

```ts
import { utf8, b64url, b64urlDecode, concat, equalBytes, sha256 } from './bytes';
import { challengeFor } from './canonical';

const KEYS = { 1: 'fresh', 2: 'key', 3: 'exact', 4: 'address', 5: 'unlocked', 6: 'signature', 7: 'unused' } as const;
const REASON = { 1: 'expired', 2: 'wrong_key', 3: 'changed', 4: 'wrong_app',
                 5: 'not_unlocked', 6: 'bad_signature', 7: 'reused' } as const;
const PRIORITY = ['reused', 'wrong_key', 'wrong_app', 'changed', 'not_unlocked', 'bad_signature', 'expired'] as const;
const SKEW_MS = 0;   // both timestamps come from this phone's clock (8.7), so no allowance
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export async function verifyAnswer(i: {
  req: VerifyRequest; ans: WireAnswer; envFrom: string;
  member: { deviceId: string; credId: string; passkeyPub: string };
  expected: { origin: string; rpId: string }; receivedAt: number;
  isNonceUsed: (nonce: string) => Promise<boolean>;
}): Promise<VerifierResult> {
  const { req, ans, member, expected } = i;
  const ok: Record<number, boolean> = {};
  let cd: any = null, cdBytes: Uint8Array | null = null, ad: Uint8Array | null = null;
  try { cdBytes = b64urlDecode(ans.clientDataJSON); cd = JSON.parse(new TextDecoder().decode(cdBytes)); } catch {}
  try { ad = b64urlDecode(ans.authenticatorData); if (ad.length < 37) ad = null; } catch {}

  const sameRequest = ans.requestId === req.requestId && ans.nonce === req.nonce;
  const inTime = i.receivedAt <= req.expiresAt + SKEW_MS;
  ok[1] = sameRequest && inTime;
  ok[2] = member.deviceId === req.toDeviceId && i.envFrom === req.toDeviceId && ans.credId === member.credId;
  const decisionOk = ans.decision === 'ME' || ans.decision === 'NOT_ME';
  ok[3] = !!cd && decisionOk && cd.challenge === b64url(await challengeFor(req, ans.decision));
  ok[4] = !!cd && !!ad && cd.type === 'webauthn.get' && cd.origin === expected.origin &&
          cd.crossOrigin !== true && equalBytes(ad.subarray(0, 32), await sha256(utf8(expected.rpId)));
  ok[5] = !!ad && (ad[32] & 0x01) !== 0 && (ad[32] & 0x04) !== 0;
  try {
    const key = await crypto.subtle.importKey('raw', b64urlDecode(member.passkeyPub), ECDSA, false, ['verify']);
    ok[6] = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
              derToRaw(b64urlDecode(ans.signature)), concat(ad!, await sha256(cdBytes!)));
  } catch { ok[6] = false; }
  ok[7] = !(await i.isNonceUsed(ans.nonce));

  const checks = ([1, 2, 3, 4, 5, 6, 7] as const).map(n => ({ n, key: KEYS[n], passed: ok[n] }));
  const failed = checks.filter(c => !c.passed).map(c => c.n);
  if (failed.length === 0) return { verdict: ans.decision === 'ME' ? 'VERIFIED' : 'DENIED', checks };
  if (failed.length === 1 && failed[0] === 1 && sameRequest && !inTime) {
    return ans.decision === 'NOT_ME' ? { verdict: 'DENIED', late: true, checks }
                                     : { verdict: 'NO_RESPONSE', noResponseReason: 'late', checks };
  }
  const reasonOf = (n: number) => n === 1 ? (sameRequest ? 'expired' : 'reused') : REASON[n as keyof typeof REASON];
  const invalidReason = PRIORITY.find(r => failed.some(n => reasonOf(n) === r))!;
  return { verdict: 'INVALID', invalidReason, checks };
}

// WebAuthn ES256 signatures are ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s }.
// WebCrypto wants raw r‖s (64 bytes). Strict parser: anything unexpected throws → check 6 fails.
export function derToRaw(der: Uint8Array): Uint8Array {
  let i = 0;
  const fail = (): never => { throw new Error('bad DER signature'); };
  if (der[i++] !== 0x30) fail();
  const seqLen = der[i++];
  if (seqLen & 0x80 || seqLen !== der.length - 2) fail();
  const int = () => {
    if (der[i++] !== 0x02) fail();
    const len = der[i++];
    if (len === 0 || len > 33) fail();
    let v = der.subarray(i, i + len); i += len;
    if (v.length === 33) { if (v[0] !== 0) fail(); v = v.subarray(1); }
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = int(), s = int();
  if (i !== der.length) fail();
  return concat(r, s);
}
```

On the check list (E6), the verifier's `CheckResult.detail` strings come from the frontend's i18n labels. Add a detail for check 1 when the answer was late.

**The same checks with E2E on.** With E2E on in production, a relay that changes a sealed answer is caught even earlier: the seal fails, so the result is `changed`. The Security Lab switches E2E off for opted-in devices precisely so that judges can watch the *signature* checks do the catching.

### 10.7 The late-answer policy (Maa's side)

| What arrives after Maa's 60 s timer ended (within the relay's 30 s grace) | Maa's screen |
|---|---|
| A valid NOT ME (only freshness failed, on time alone) | Switch to **DENIED** ("Not Arjun. Do not send money."), with the meta line "{label} answered after the timer ended." Alerts go out as usual. |
| A valid YES (only freshness failed, on time alone) | **Stay on "Not confirmed yet"**, adding the line "{label} answered after the time ran out. Ask again." It never turns green late. |
| Anything that fails another check | **INVALID**, as normal |

D3's 60 s timer and check 1 end at the same instant (`expiresAt`, on Maa's clock). An answer that arrives after "Not confirmed yet" is on screen is therefore always handled by this table; it never turns green.

### 10.8 Confirmation words (catching a mistaken "Yes")

The risk: the real Arjun, busy or confused, taps "Yes" while a scammer is the one on Maa's call. To catch this, after VERIFIED both phones show the same two words and Maa asks the caller to read them out. A scammer doesn't have Arjun's phone and can't know them.

```
bits  = SHA-256( UTF-8("pehchaan-confirm-v1|" + nonce + "|") ‖ authenticatorData ‖ clientDataJSON )
words = [ BIP39[bits 0–10], BIP39[bits 11–21] ]            // UPPERCASE, e.g. MANGO · TIGER
```

- Both phones hold these exact bytes. The signature is deliberately left out: an ECDSA signature can be rewritten into a second valid form, which would make the two phones show different words. The relay sees none of it when E2E is on.
- Words are shown only for VERIFIED (Maa: E7) and after a YES (Arjun: F3). This fills the frontend's existing `confirmationWords`.

### 10.9 The used-nonce store

- IndexedDB table `usedNonces { nonce (key), requestId, usedAt }`, kept for 30 days and pruned on app start.
- A nonce is added right after a verdict or a cancel. After a timeout, it is added once the 30 s late window closes (10.5).
- Diagnostics "Reset used request numbers" stays in the test build only. In production, hide it: resetting it only weakens replay protection.

### 10.10 PIN fallback (P2, lower assurance)

For phones that can't create passkeys.

**The answer:**
- It is signed by the device signing key over `"pehchaan-pin-answer-v1\n" + ORIGIN + "\n" ‖ challenge`.
- It is sent only after the app's own 6-digit PIN check (PBKDF2-hashed, with 5 attempts then a 10-minute lockout).
- The card declares `kt: "pin"`.

**How the checks map:**
- Check 4 compares the embedded origin.
- Check 5 passes on the app's self-report and shows "Unlocked with Pehchaan PIN (on-device check)".
- Check 6 verifies against `dk`.

**The limit, stated honestly:** malware on that phone could sign without the PIN. A relay or network attacker still cannot. The verdict screen shows a small "PIN key" note so that families know it is weaker.

---

# PART C·III: DELIVERY FEATURES

## 11. Web Push (reaching a phone whose app is closed)

Without push, Pehchaan only works while Arjun happens to have the app open. **Push is P0.**

### 11.1 How it fits together

- Each environment has its own **VAPID key pair**, generated once with `infra/scripts/vapid-keys.ts`.
  - The public key goes to the app (`VITE_VAPID_PUBLIC_KEY`) and to the relay.
  - The private key is a relay secret.
  - `VAPID_SUBJECT = mailto:security@yourdomain.in`.
- The phone's browser creates a **push subscription**: an endpoint URL at Google (FCM), Apple or Mozilla, plus encryption keys. The app sends it to the relay on every login (`push.subscribe`).
- The relay sends pushes with the `web-push` npm library. The push service wakes the phone's service worker, which decrypts, checks and shows a notification.

### 11.2 Asking for permission (makes the A8 screen real)

A8 is currently an `ENABLE_EXTRAS` stub. It becomes part of normal setup for the "can be verified" role, and a strongly recommended step for everyone else.

- **Explain first, then ask.** "When someone in your family asks 'Is this really you?', Pehchaan needs to alert you even if the app is closed." Then the button **Turn on alerts**.
- **Ask inside the tap.** iPhone requires the permission request to happen in a user gesture, *inside the installed Home Screen app*. It is not available in a Safari tab.
- **If refused:** "Without alerts, family can only check you while Pehchaan is open." A Settings row ("Alerts: Off · Turn on") stays visible.

```ts
async function enablePush(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const perm = await Notification.requestPermission();      // call directly from the button's click handler
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,                                   // mandatory in every browser
    applicationServerKey: b64urlDecode(VAPID_PUBLIC_KEY),
  });
  relay.pushSubscribe({
    endpoint: sub.endpoint,
    p256dh: b64url(new Uint8Array(sub.getKey('p256dh')!)),
    auth: b64url(new Uint8Array(sub.getKey('auth')!)),
    vapidKeyId: VAPID_KEY_ID,
  });
  return 'granted';
}
```

**Keeping the subscription fresh:**
- The app re-sends its subscription on every login.
- If `auth.ok.pushStatus` is `expired` or `missing` while permission is `granted`, the app silently calls `pushManager.subscribe` again.
- The service worker listens for `pushsubscriptionchange` and re-registers through `POST /v1/push/resubscribe`, signed with the device key the same way as the inbox fetch in 11.4. This is P1.

### 11.3 Sending from the relay

```ts
import webpush from 'web-push';

const res = await webpush.sendNotification(
  { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
  JSON.stringify(frame),                                   // the deliver frame (sealed inside)
  {
    TTL: Math.ceil(ttlMs / 1000),                          // never deliver a stale request
    urgency: 'high',                                       // every Pehchaan push is time-sensitive
    topic: frame.body.re ? topicFor(frame.body.re) : undefined,  // requests, answers and cancels only;
                                                           // a later push with the same topic replaces
                                                           // an undelivered one
    vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
    timeout: 5000,
  });
```

- `topicFor(requestId)` = the first 32 characters of `b64url(SHA-256(requestId))`. Alerts and prompts get no topic. A request, and the cancel that follows it, share a topic. If the phone was offline, the cancel *replaces* the stale request in the push service's queue.
- **SSRF guard:** accept subscriptions only when the endpoint is `https:` and its host is on the allowlist:
  - `fcm.googleapis.com`
  - `*.push.apple.com`
  - `updates.push.services.mozilla.com`
  - `*.notify.windows.com`

  Anything else is refused at `push.subscribe`. Without this, the relay could be tricked into calling internal URLs.

| Push service response | Relay action |
|---|---|
| 201 Created | Receipt `pushed`; update `last_success_at` |
| 404 / 410 Gone | The subscription is dead: set `expired_at`, drop it from the cache, and send receipt `failed` if it was the only route |
| 413 Payload Too Large | Retry once with a *wake* push (11.4) |
| 429 Too Many Requests | Respect `Retry-After` (up to 10 s) and retry once, otherwise `failed` |
| 403 (VAPID mismatch after a key rotation) | Mark it expired; the app re-subscribes at its next login |
| 400 | Log it (bug) and mark `failed` |
| 5xx / timeout | Retry after 0.5 s and after 1.5 s, then `failed` |

### 11.4 Payload size

- The Web Push limit is 4,096 bytes *after* encryption. Keep the JSON frame **≤ 3,000 bytes** for margin.
- A sealed request frame is about 1.2 KB and an answer about 1.6 KB, so normally the whole frame travels inside the push. The app can then show F1 before its WebSocket has even connected.
- If a frame is ever larger, send a **wake** push, `{ t: "wake", id, kind, from }`. The service worker then fetches the frame:

| Route | `POST /v1/inbox/fetch` (P1) |
|---|---|
| Body | `{ deviceId, msgId, ts, sig }` |
| `sig` | Device-key signature over `"pehchaan-fetch-v1\n" + RELAY_HOST + "\n" + deviceId + "\n" + msgId + "\n" + ts` |
| Checks | `ts` within ±120 s of the relay's clock; rate-limited |
| Response | The frame; CORS allows only the app origin |

### 11.5 The service worker

Switch `vite-plugin-pwa` to the `injectManifest` strategy so that the service worker can contain this code.

```ts
// apps/web/src/sw.ts (additions)
self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil((async () => {
    let frame: any;
    try { frame = event.data!.json(); } catch { frame = null; }
    if (frame?.t === 'wake') frame = await fetchFromInbox(frame);     // signed fetch (11.4)
    const n = frame ? await describe(frame) : FALLBACK;               // opens the seal with the device key
                                                                      // from IndexedDB; resolves labels locally
    if (frame) await idb.pushInbox.put(frame);                        // the app processes it on open (dedupe by id)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some(w => (w as WindowClient).visibilityState === 'visible');
    await self.registration.showNotification(n.title, {
      body: n.body, tag: n.tag, renotify: true, silent: visible,
      requireInteraction: n.urgent,
      vibrate: n.urgent && !visible ? [300, 150, 300, 150, 600] : undefined,   // Android only; never with silent
      data: { url: n.url }, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
      timestamp: Date.now(),
    });
    for (const w of wins) w.postMessage({ type: 'push-frame', frame });
  })());
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins[0] as WindowClient | undefined;
    if (w) { await w.focus(); w.postMessage({ type: 'navigate', url }); }
    else await self.clients.openWindow(url);
  })());
});
```

- **Always show a notification for every push.** Browsers (Safari especially) revoke push permission from sites that receive pushes silently. When the app is visible, the notification is `silent`, and the app closes it (`registration.getNotifications({ tag })`) once it has shown F1.
- **The app handles a request exactly once,** whether it arrives from the WebSocket, from `pushInbox`, or from both (dedupe by message `id` and `requestId`).
- **Answers never happen inside a notification.** A passkey prompt needs an open, focused app. The notification opens `/request/:id`, and F1 does the rest.

### 11.6 What the notification says

The lock screen is visible to anyone near the phone, so it never shows amounts or reasons.

| Kind | Title / body (English; Hindi from i18n) | Tag | Urgent |
|---|---|---|---|
| `verify.request` | "{asker} is asking" / "Are you on a call with {them}? Tap to answer." (unknown sender: "{fromName} (not in your family)") | `req-<requestId>` | yes |
| `verify.cancel` | Replaces the request notification: "{asker} stopped waiting" | `req-<requestId>` | no |
| `verify.answer` (to a backgrounded asker) | "{label} answered" / "Open Pehchaan to see the result." | `ans-<requestId>` | yes |
| `alert` impersonation | "Someone pretended to be {about}" / "On a call to {victim}. Tap for details." | `alert-<id>` | yes |
| `alert` check-on | "Can you check on {about}?" / "{victim} couldn't confirm a call." | `alert-<id>` | no |
| `guard.prompt` | "Call Guard: verify now?" / "The caller says they're {claimed}." | `guard-<at>` | yes |
| Envelope couldn't be opened | "Pehchaan" / "Open Pehchaan." | `generic` | no |

### 11.7 Platform rules (real-world constraints)

| Platform | Push works when | Notes |
|---|---|---|
| Android, Chrome (and Chromium browsers using FCM) | Always, including a closed app or a browser tab | Vibration patterns work. `urgency: high` maps to high-priority FCM, which can wake the phone from Doze. |
| iPhone / iPad, iOS or iPadOS 16.4+ | **Only when installed to the Home Screen,** with permission granted inside the installed app | No vibration patterns, and `requireInteraction` is ignored. Setup must make Home Screen installation step 1 on iOS (section 22). |
| iPhone, Safari tab (not installed) | Never | The C8 family-link flow still works while the page is open |
| Desktop Chrome / Edge / Firefox | Yes | Used by the Call Guard and Security Lab laptop pages (they rarely need it) |

### 11.8 Indian phone makers and battery savers

Xiaomi / Redmi / POCO, Vivo / iQOO, Oppo / Realme, OnePlus and some Samsung models can delay or kill background delivery, including Chrome's. Protect against this:

- In Settings → Alerts, add **"Make alerts reliable on this phone"** (P1). It gives brand-specific steps, detected from the user agent where possible:
  - Settings → Apps → **Chrome** → Battery → **No restrictions / Unrestricted**.
  - On Xiaomi, also **Autostart: on**.
  - Keep Chrome's notifications on for Pehchaan.
- In Diagnostics → **"Send test alert"** (`push.test`): the relay pushes a test notification to this phone after 10 s (enough time to lock the screen), and the app reports how long it took to arrive.
- For judging day, set both phones to Unrestricted and run the test alert with screens locked (section 24.6).

### 11.9 Rotating the VAPID key

Rotation is only needed if the private key leaks, because every subscription is tied to the old key.

1. Generate a new pair and bump `VAPID_KEY_ID`.
2. Deploy the relay with both keys. It sends with each subscription's own `vapid_key_id`.
3. Deploy the app with the new public key.
4. At login, `hello.vapidKeyId` differs from the app's stored one, so the app unsubscribes and subscribes again.
5. After 30 days, drop the old key.

---

## 12. Presence

**What it answers:** "If I ask this person now, will it reach them?" It is not a social "last seen".

| State | Meaning |
|---|---|
| `online` | At least one live socket on a live gateway |
| `push` | No socket, but at least one working push subscription. **This is the normal state for a phone in a pocket.** |
| `offline` | Neither. A request will wait in the inbox until it expires. |

**Rules:**
- `presence.query` only answers for devices that the asker is allowed to contact (a binding exists). Everything else returns `offline`, so the relay reveals nothing about strangers.
- There are no timestamps and no continuous subscriptions. The app asks when a screen needs it: Home foreground, D1 open, the Lab and Guard dropdowns, Diagnostics. It re-asks at most every 30 s while that screen is visible.
- `RelayService.onPresence(reachable[])` gets the `online` and `push` devices.
- **P1 UI:**
  - D1 tiles show a small "may not get this" hint for `offline` members: "{label}'s phone may not get this right now. You can still ask, or call them."
  - Diagnostics shows the raw states.

---

## 13. Family alerts and Call Guard routing

### 13.1 Family alerts (G1 and G2)

| Alert | Trigger (existing screens) | Sent to |
|---|---|---|
| G1 impersonation | A DENIED verdict (E2), sent automatically | Every family member in Maa's list except the person impersonated |
| G2 check-on | "Ask family to reach {label}" on E3 | The same set |

- **One sealed envelope per recipient** (`kind: "alert"`), each needing a binding: Maa holds their cards and grants.
- **Receipts drive the "Family alerted: {names}" row:**
  - `delivered` or `pushed` → check icon;
  - `queued` → "will get it when online";
  - `failed` or `rejected` → "couldn't reach {name}".
- Alerts wait in the inbox for 24 h. Recipients resolve their *own* label for the person through `aboutDeviceId`.
- G2's "I've reached them" is local to each recipient in P0/P1. Sharing that state among the family is v2.
- Limit: 100 alert envelopes per hour per device, burst 20 (16.1).

### 13.2 Call Guard (laptop page → the parent's phone)

- **The Guard page is its own device** (its own device key in the laptop's browser, no passkey).
- **Pairing reuses family cards:**
  - "Send prompts to:" gets a **"+ Add a phone"** item.
  - It either scans the phone's My code QR with the laptop camera (reusing C4's scanner) or pastes its family link (reusing C8's parser).
  - It shows the four safety words to compare, then saves the target locally.
- Prompts are sealed envelopes (`kind: "guard.prompt"`) and need a binding like any other message.
- On the phone, a prompt shows the existing **B2 banner** → D2, pre-filled with the claimed person and amount.
- Auto-send: at most one prompt per call session, and at most 12 prompts a minute (relay limit).
- **Privacy:**
  - The transcript and audio **never** go to the relay. Only `{claimedLabel, amountInr, tactics, at}` is sent.
  - Chrome's built-in speech recognition may send audio to the browser vendor's speech service. The Guard page says so, and it shows the consent line: "Use Call Guard only with the consent of the person whose call it is."

---

## 14. The Security Lab on the relay

**Purpose:** anyone, a judge included, plays an attacker who fully controls the relay, and watches every attack fail. This replaces `SimLab` with real relay primitives (hold, modify, inject), as frontend Part E specifies.

### 14.1 Safety model

The relay-side Lab can never touch real users' traffic. Five layers make sure of it:

| Layer | Rule |
|---|---|
| 1. Switches | `LAB_ENABLED=true` loads the Lab module: always in staging; in production only in the event build, deployed before the deploy freeze. Even then the Lab stays **off** until someone runs `admin lab on` (Redis `cfg:lab`), and `admin lab off` turns it off instantly, with no deploy. While off, or when the module isn't loaded, `lab.*` → `lab_disabled`. |
| 2. Lab password | `lab.join` requires the Lab password. The relay stores only an Argon2id hash (`LAB_PASSWORD_HASH`). 5 password attempts per 10 min per IP, shared with `lab.optin`; sessions last 4 h. |
| 3. Per-device opt-in | A phone's traffic is visible to the Lab only after *that phone* opts in (Diagnostics → "Allow Security Lab on this phone", which asks for the Lab password). The opt-in expires after 4 h. |
| 4. Both ends | The Lab sees and changes a message **only if both sender and recipient are opted in.** Everyone else's traffic stays sealed and untouched. |
| 5. Visible | Opted-in phones show a persistent brass banner: "Security Lab can see and change this phone's messages · Turn off". Every Lab action is written to `audit_events`. |

While both ends are opted in, the apps send `plain` instead of `e2e` (section 9.5), so the Lab log is readable and the attacks target the *signatures* directly.

### 14.2 Lab messages

| `t` | Direction | Body | Purpose |
|---|---|---|---|
| `lab.join` | Lab page → relay | `password` | Start a Lab session (the Lab page is its own device) |
| `lab.optin` / `lab.optout` | phone → relay | `password` / `{}` | Opt this phone in or out |
| `lab.state` | relay → Lab page, phones | `optedIn[], armed?, since` | Current state (device dropdowns, banner) |
| `lab.traffic` | relay → Lab page | a `RelayEvent` (frontend B4 shape) | Every message between opted-in devices, with a readable summary |
| `lab.arm` | Lab page → relay | `attack: 'change' \| 'replay' \| 'forge', asker, answerer` | Hold the next matching message |
| `lab.disarm` | Lab page → relay | `{}` | Cancel |
| `lab.held` | relay → Lab page | `heldId, frame` | "I'm holding this. Tell me what to do." |
| `lab.release` | Lab page → relay | `heldId, replacement?` | Forward the (possibly modified) frame |
| `lab.inject` | Lab page → relay | `as, to, kind, re, plain` | Deliver a frame *as if* sent by `as` (the relay is the attacker) |
| `lab.report` | asker phone → relay | `requestId, verdict, invalidReason?, failedChecks[]` | Sent after the verdict, for the result panel and counters only |
| `lab.result` | relay → Lab page | `attack, verdict, invalidReason, failedChecks, falseGreen` | Shows the result |

### 14.3 How each attack runs

| Attack | Match | Relay does | Lab page does | Expected on Maa's phone |
|---|---|---|---|---|
| **Change the next answer** | The next `verify.answer` from answerer → asker | Holds it, sends `lab.held` | Flips `ans.decision` (NOT_ME ↔ ME) and leaves everything else, including the signature, untouched → `lab.release` | INVALID `changed` (check 3) |
| **Replay Arjun's last yes** | The next `verify.request` from asker → answerer | Holds it, **never delivers it** to Arjun, creates the request record, sends `lab.held` | Takes the stored genuine YES (seen earlier in `lab.traffic`) → `lab.inject { as: answerer, to: asker, kind: 'verify.answer', re: newRequestId, plain: oldAnswer }` | INVALID `reused` (checks 1, 3, 7) |
| **Forge a yes** | The next `verify.request` | Holds it and never delivers it | Generates a fresh P-256 key and a random credential ID in WebCrypto. Builds a perfect-looking answer: correct rpIdHash, UP+UV flags, correct challenge for "ME", correct origin. Signs it with its own key, DER-encodes it → `lab.inject` | INVALID `wrong_key` (checks 2, 6). If the forger copies Arjun's credential ID instead: `bad_signature` (check 6), still INVALID. |

- **Timeouts:** if the Lab page doesn't answer a `lab.held` within 10 s, the relay forwards the original unchanged, disarms, and reports "Lab didn't respond".
- An armed attack fires once and then disarms (frontend J1 behaviour).
- **The honesty rule:** Maa's phone runs the **normal verifier**. No Lab-specific code exists in the verification path. `lab.report` is sent *after* the verdict, purely so the laptop can display it.
- A **false green** is any `lab.report` with verdict VERIFIED for a request the Lab tampered with. It must always be 0. If it is ever 1, that's a critical bug: stop and fix before anything else.

### 14.4 Records

- Every attack is written to Postgres `lab_attacks` (attack, test device IDs, verdict, reason, failed checks, false_green) and kept for 90 days.
- The Lab page also keeps its all-time log in IndexedDB and exports it as JSON (frontend J1).
- **Before judging day:** run at least 50 attacks across all three types on the real phones, and keep the export (frontend Part E).

---

# PART C·IV: DATA, SECURITY AND PRIVACY

## 15. Data stores

### 15.1 Redis keyspace (complete)

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `gw:<gatewayId>:alive` | string | 30 s (refreshed every 10 s) | Gateway liveness |
| `rt:<deviceId>` | set of gateway IDs | 24 h, refreshed on login | Routing |
| `{d:<deviceId>}:ib` | sorted set (msgId → expiry) | 24 h | Inbox index |
| `{d:<deviceId>}:m:<msgId>` | string (frame JSON) | Per kind (8.3) | Inbox frames |
| `rq:<requestId>` | hash | deadline + 90 s | Request record (8.1) |
| `dd:<fromDeviceId>:<msgId>` | string | 5 min | Idempotency |
| `rl:<scope>:<key>` | string (GCRA "theoretical arrival time") | ≤ window | Rate limits (16.1) |
| `cb:<targetDeviceId>` | set of allowed sender IDs | 10 min | Binding cache |
| `cg:<targetDeviceId>` | hash grantId → secret hash | 10 min | Grant cache |
| `ps:<deviceId>` | string (JSON of active push subscriptions) | 10 min | Push subscription cache |
| `dv:<deviceId>` | hash {retired, blocked} | 10 min | Device status cache |
| `lab:session:<id>`, `lab:optin:<deviceId>` | string | 4 h | Lab |
| `lab:armed` | hash | 10 min | Lab |
| `cfg:lab` | string (`on`) | 12 h (so it can never be left on for days) | Lab runtime switch (14.1) |
| `oq:<deviceId>` | sorted set (requestId → deadline) | 2 min | Open requests per asker (the 3-at-once limit) |
| `lab:held:<heldId>` | string | 15 s | Lab |
| channel `gw:<gatewayId>` | pub/sub | none | Cross-gateway delivery |
| channel `lab:events` | pub/sub | none | Lab traffic fan-out to Lab pages |
| channel `admin:events` | pub/sub | none | Admin actions such as closing a blocked device's sockets (16.8) |

- **Redis configuration:** no eviction (`noeviction`), so that nothing important is silently dropped. Keep memory usage alarms at 70%.
- **On the free VM,** Valkey runs with a password, `--save "" --appendonly no` (nothing to persist), `--maxmemory 768mb` and `noeviction`, reachable only on the private Docker network (18.6).
- **Keys use hash tags** where a Lua script touches several keys, so moving to Redis Cluster later needs no key changes.
- **Pub/sub sits behind a small `bus` interface:**
  - it uses `PUBLISH`/`SUBSCRIBE` on a single node;
  - it uses `SPUBLISH`/`SSUBSCRIBE` (sharded pub/sub, Redis 7+) on a cluster.

### 15.2 Postgres schema (`apps/relay/src/store/schema.ts` in Drizzle; SQL shown)

```sql
create table devices (                           -- rows are never deleted, only tombstoned (retired_at)
  device_id     text primary key,                 -- 22-char base64url
  device_pub    bytea not null check (length(device_pub) = 65),
  platform      text,                             -- 'android-chrome', 'ios-pwa', 'desktop-chrome', …
  app_version   text,
  created_at    timestamptz not null default now(),
  last_seen_on  date not null default current_date,   -- day precision only (privacy)
  retired_at    timestamptz,
  blocked_at    timestamptz,
  block_reason  text
);

create table contact_grants (
  target_device_id text not null references devices(device_id),
  grant_id         text not null,
  secret_hash      bytea not null check (length(secret_hash) = 32),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  primary key (target_device_id, grant_id)
);

create table contact_bindings (
  target_device_id text not null references devices(device_id),
  sender_device_id text not null references devices(device_id),   -- no cascade: blocks must survive
  via_grant_id     text,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  primary key (target_device_id, sender_device_id)
);
create index contact_bindings_sender on contact_bindings (sender_device_id);

create table push_subscriptions (
  id              bigserial primary key,
  device_id       text not null references devices(device_id),
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  vapid_key_id    text not null,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   int not null default 0,
  expired_at      timestamptz
);
create index push_subs_active on push_subscriptions (device_id) where expired_at is null;

create table audit_events (                       -- security events, never content
  id       bigserial primary key,
  at       timestamptz not null default now(),
  kind     text not null,     -- device_first_seen, auth_failed_burst, grant_rotated, binding_created,
                              -- binding_revoked, push_expired, rate_limited_burst, device_retired,
                              -- device_blocked, lab_session, lab_optin, lab_attack
  subject  text,              -- HMAC-SHA-256(AUDIT_KEY, device_id): pseudonymous
  meta     jsonb not null default '{}'
);
create index audit_events_at on audit_events (at);

create table lab_attacks (                        -- written only when LAB_ENABLED
  id              bigserial primary key,
  at              timestamptz not null default now(),
  attack          text not null check (attack in ('change','replay','forge')),
  asker           text not null,
  answerer        text not null,
  verdict         text,
  invalid_reason  text,
  failed_checks   smallint[],
  false_green     boolean not null default false
);
```

**Migrations:**
- Drizzle Kit generates SQL migration files that are committed.
- CI runs them against a throwaway Postgres.
- Deploys run `migrate` *before* the new relay version starts.
- Every migration is **expand-then-contract**: add columns or tables first, stop using old ones in a later release, drop them in a third. Old and new relay versions always run safely side by side during a rolling deploy.

### 15.3 Retention

| Data | Kept for |
|---|---|
| Inbox frames | Their TTL (60 s–24 h) |
| Request records | Deadline + 90 s |
| `devices` | Active until retired, or until 12 months without a login (then retired automatically). A retired row stays as a **tombstone** (ID, public key, retire date; platform and version cleared), so the ID can never be reused and blocks stay attached to it. |
| `contact_bindings` revoked rows | Kept while the target device is active (a block must persist, even if the blocked device retires) |
| `push_subscriptions` expired rows | 30 days, then deleted |
| `audit_events` | 1 year (security logs; pseudonymous; see section 17) |
| `lab_attacks` | 90 days |
| Application logs (Docker → Grafana Cloud Loki) | 14 days; no personal data (16.7) |
| Sentry events | 30 days; scrubbed |

A daily job (run by the `backup` container's scheduler, right after the nightly dump) deletes whatever has expired.

### 15.4 Self-healing: the database is mostly a cache of what phones know

| Lost | How it comes back |
|---|---|
| All of Redis | Gateways re-add routes for live sockets. At most, in-flight verifications end as "Not confirmed yet" (the safe outcome); everything else rebuilds by itself. |
| `devices` rows | Recreated at each device's next login |
| `contact_grants` | Every device re-sends `grant.set` at every login |
| `contact_bindings` (allowed) | Senders include the grant with every message, so bindings re-form on the next message |
| `push_subscriptions` | Re-sent at every login |
| **`contact_bindings` (revoked) and device tombstones** | **Not recoverable from phones.** These are the rows whose backups truly matter: losing them would unblock someone, or let a retired ID log in again. |

### 15.5 Caching rules

- Every cache has a 10-minute TTL and is deleted (not updated) on change: `DEL cb:<target>` after a binding changes, `DEL ps:<device>` after a subscription changes.
- A missing cache entry is loaded from Postgres. A Postgres error during a load means **fail closed** for authorisation (`unavailable`), never "allow".
- Existing sockets keep working while Postgres is briefly down, as long as the caches are warm.

---

## 16. Hardening

### 16.1 Rate limits

Enforced with a Redis GCRA script:

```lua
-- KEYS[1] = rl:<scope>:<key>   ARGV: nowMs, intervalMs (T), burst
local now, T, burst = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
local newTat = math.max(tat, now) + T
local allowAt = newTat - burst * T
if allowAt > now then return math.ceil(allowAt - now) end      -- ms until allowed
redis.call('SET', KEYS[1], newTat, 'PX', math.ceil(newTat - now))
return 0
```

| Scope | Key | Limit | Burst |
|---|---|---|---|
| WebSocket upgrades | IP (HMAC) | 120 / min | 30 |
| Failed logins | IP (HMAC) | 30 / 10 min | 10 |
| Frames | socket | 20 / s | 40 |
| `verify.request` | device | 10 / min and 60 / hour | 5 |
| `verify.request` | sender → target pair | 3 / min | 2 |
| Open requests at once | device | 3 | n/a |
| `verify.answer` | device | 20 / min | 10 |
| `alert` envelopes | device | 100 / hour | 20 |
| `guard.prompt` | device | 12 / min | 4 |
| `presence.query` | device | 30 / min | 10 |
| `push.subscribe` | device | 10 / hour | 3 |
| Grant rotation | device | 10 / day | 3 |
| New bindings | target, and sender | 20 / day each | 5 |
| Pushes sent | target device | 60 / hour | 20 |
| Lab password attempts (`lab.join`, `lab.optin`) | IP (HMAC) | 5 / 10 min | 3 |
| `push.test` | device | 3 / hour | 1 |
| `/v1/inbox/fetch`, `/v1/push/resubscribe` | device | 30 / min | 10 |

**IP limits are deliberately generous.** Indian mobile carriers put thousands of users behind one address (carrier-grade NAT, CGNAT). Per-device limits do the real work. Limits are configuration (`RATE_LIMIT_PROFILE`), not code.

### 16.2 Input validation and resource limits

- Frames are limited to 16 KiB, text only; sealed `ct` to 8 KiB; one target per `send`; `presence.query` to 50 IDs; the inbox to 50 entries.
- Every body is parsed with a `.strict()` `zod` schema:
  - ID formats: `deviceId` `^[A-Za-z0-9_-]{22}$`; message IDs are 26-character ULIDs.
  - Integers are bounded, and strings are length-capped.
- **Unauthenticated sockets:** at most 20 per IP at a time. Each one is closed if it hasn't logged in within 10 s (7.1).
- **Backpressure:** if a socket's `bufferedAmount` exceeds 1 MiB (a slow or malicious reader), close it with 1008.
- **Client IP for rate limits:** read `X-Forwarded-For` only when the connection comes from Caddy (`TRUST_PROXY`). Otherwise anyone could forge their IP and dodge the limits. When Cloudflare proxying is on (P1), Caddy passes on `CF-Connecting-IP` instead.
- A single Node event loop must never block. The only CPU-heavy work is ECDSA verification at login (about 0.1 ms each) and Web Push encryption (about 1 ms each). Measure event-loop lag and alarm at 200 ms (section 19).

### 16.3 Authorisation rules (checked on every message)

| Message | Allowed only if |
|---|---|
| any, except `auth`/`ping` | The socket is authenticated, and the device is not retired or blocked |
| `send` `verify.request` | `re` present. Either a binding (target ← me) exists and isn't revoked, **or no binding row exists at all (revoked or not)** and a valid grant was presented (which creates the binding). The target isn't retired or blocked. I have fewer than 3 open requests (`oq:`). |
| `send` `verify.answer` | `re` present. Request record: I am in `to`, the recipient is `from`, the state is open, within deadline + grace (the 8.6 Lua script) |
| `seen` | Request record: I am in `to`, and the state is open |
| `ack` | Only removes entries from *my own* inbox (`{d:<me>}:m:<of>`) |
| `cancel` | Request record `from` is me |
| `send` `alert` / `guard.prompt` | Binding, or a valid grant with no binding row, as for requests |
| `presence.query` | Answers only for IDs where a binding (id ← me) exists |
| `contact.revoke` / `unrevoke`, `grant.set`, `push.*` (including `push.test`), `device.retire` | Only ever act on *my own* device (the target is implicit) |
| `lab.*` | Module loaded and `cfg:lab` on, plus a Lab session (Lab page) or an opt-in (phone) |
| `lab.inject` | Both `as` and `to` are opted in; an injected answer still goes through the 8.6 request-record script |
| `lab.report` | The sender is the request record's `from` (the asker) |
| `plain` bodies | `E2E_REQUIRED=false`, or both ends opted in to the Lab |

### 16.4 Secrets

| Secret | Lives in | Rotation |
|---|---|---|
| `VAPID_PRIVATE_KEY` | The VM's `.env` (mode 600, owner `deploy`; one per environment) | Only on compromise (11.9) |
| `LAB_PASSWORD_HASH` | The VM's `.env` | After every judging event |
| `DATABASE_URL`, `REDIS_URL`, `VALKEY_PASSWORD`, `POSTGRES_PASSWORD` | The VM's `.env` | Yearly, or on staff change |
| `AUDIT_KEY`, `IP_HASH_KEY` (HMAC keys for pseudonymising) | The VM's `.env` | `IP_HASH_KEY` rotates monthly (limits linkability) |
| `DEPLOY_SSH_KEY`, `VM_KNOWN_HOSTS` (deploy) | GitHub Environment secrets, one set per environment, with required reviewers for production. The key only logs in as the `deploy` user. | Every 90 days |
| Backup bucket keys; the backup `age` private key | Bucket keys in the VM's `.env`. The `age` **private** key is never on the VM: two teammates keep it offline. | Yearly |
| `SENTRY_AUTH_TOKEN` (source maps) | GitHub secret | Yearly |

- Never commit secrets. `infra/vm/env.example` lists names only.
- GitHub secret scanning and push protection are on.
- There are **no admin HTTP endpoints.** Admin tasks run over SSH on the VM (`docker compose exec relay-a node dist/admin.js …`, 16.8), so the relay has no admin surface to attack.

### 16.5 Frontend security headers

`frame-ancestors` must be an HTTP header. `connect-src` differs per environment, so it goes in a `<meta>` tag that Vite writes at build time from `VITE_RELAY_URL`.

```json
{
  "rewrites": [{ "source": "/((?!assets/|icons/|sw.js|manifest.webmanifest|\\.well-known/).*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(self), microphone=(self), publickey-credentials-create=(self), publickey-credentials-get=(self), geolocation=(), payment=(), usb=()" },
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
    ]},
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```

The build-time meta CSP:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self';
connect-src 'self' <RELAY wss:// and https:// origins> https://<your Sentry ingest host from the DSN>;
worker-src 'self'; manifest-src 'self'
```

- **Self-host the fonts** (Anek, Mukta, JetBrains Mono). This removes a third party, works offline, and keeps the CSP simple.
- `'unsafe-inline'` for styles is needed by the animation library's inline styles. Scripts never get it.
- `frame-ancestors 'none'` stops click-jacking attacks that would hide the YES/NO buttons under a fake page.

### 16.6 Protecting the trusted base (the code people run)

The relay is untrusted by design, but **whoever can change the app's code can change what Maa sees.**

| Asset | Protection |
|---|---|
| GitHub | 2FA required for everyone. `main` is protected: pull requests only, 1 review, CI must pass, no force-push. `CODEOWNERS` requires **2 reviewers** for `packages/crypto` and `packages/protocol`. Dependabot and secret scanning are on. |
| Vercel | Team 2FA. Production deploys come only from `main` through the Git integration, never ad-hoc CLI deploys. Keep the audit log. |
| Domain and DNS | Registrar lock, registrar 2FA, DNSSEC, Cloudflare 2FA, and a CAA record allowing only Let's Encrypt (used by both Vercel and Caddy) |
| Oracle Cloud and the VMs | Oracle account MFA. SSH by key only (no passwords), fail2ban, automatic security updates. Only ports 80, 443 and 22 are open; Valkey and Postgres are never exposed. The CI key logs in only as the `deploy` user. |
| Build identity | The app shows its build hash in Diagnostics, and the relay logs the client build hashes it sees, so an unexpected build is visible. |
| v2 | A signed native app (Play Store TWA / Capacitor) and reproducible builds (section 27) |

### 16.7 Logging rules

- **Never log:** payloads (`e2e`, `plain`), nonces, signatures, grant secrets, full push endpoints, names or phone numbers.
- **Log:** message type, kind, sizes, result codes, latency, gateway ID, and `HMAC(device_id)` instead of raw IDs.
- IPs are only ever used as HMAC keys for rate limits, never written to logs.
- Sentry has `sendDefaultPii: false`, and a `beforeSend` scrubber removes any field named `e2e`, `plain`, `nonce`, `signature`, `grant`, `endpoint`, `phone`, `name` or `label`.

### 16.8 Abuse handling

- Admin CLI, run over SSH on the VM with `cd /opt/pehchaan && docker compose exec relay-a node dist/admin.js <command>` (a sketch follows this list):
  - `admin block <deviceId> --reason "spam"` / `admin unblock <deviceId>`;
  - `admin stats` (counts only);
  - `admin retire <deviceId>` (for deletion requests received by email);
  - `admin lab on` / `admin lab off` (the Lab's runtime switch, 14.1).
- **Automatic signals** go to `audit_events`, and alert on-call when they exceed thresholds:
  - repeated `rate_limited` from one device;
  - more than 10 bindings created by one sender in a day;
  - many requests that never get an answer.
- Blocking closes the device's sockets (4403) and refuses future logins.
- There is no content to inspect. Abuse handling is based on behaviour only.

A sketch of the admin script, using the same `db`/`redis` modules and `hmac` helper as the relay:

```ts
// apps/relay/src/admin.ts: runs inside a relay container: `docker compose exec relay-a node dist/admin.js …`
const [cmd, deviceId, ...rest] = process.argv.slice(2);
if (cmd === 'block') {
  const reason = rest.join(' ') || 'manual';
  await db.execute(sql`update devices set blocked_at = now(), block_reason = ${reason} where device_id = ${deviceId}`);
  await redis.del(`dv:${deviceId}`);                          // drop the status cache (15.5)
  await redis.publish('admin:events', JSON.stringify({ t: 'kick', deviceId, code: 4403 }));
  await db.insert(auditEvents).values({ kind: 'device_blocked', subject: hmac(deviceId), meta: { reason } });
}
```

Each gateway subscribes to `admin:events` (15.1) and closes that device's sockets with 4403.

### 16.9 Threats and mitigations (summary)

| Threat | Mitigation | Section |
|---|---|---|
| Relay forges a YES | Passkey signature, checked against the saved key | 10.5 (checks 2, 6) |
| Relay replays an old YES | Nonce in the challenge, plus the used-nonce store | 10.5 (checks 1, 3, 7) |
| Relay flips NOT ME → ME | The decision is part of the signed challenge | 10.5 (check 3) |
| Relay reads contents | E2E seal | 9 |
| Relay fakes "Maa is asking" or a family alert | Sender signature inside the seal | 9.2 |
| Spam from someone with a leaked card | Grants, bindings, revocation, rate limits | 6.4, 16.1 |
| "New phone" impersonation through a family link | New-phone guard | 6.5 |
| Look-alike phishing site | Passkeys are bound to the rpId (check 4). The clone has no access to Maa's family list or keys. Education: "Pehchaan never asks you to open a link during a call." | 5.3 |
| Arjun taps "Yes" by mistake | Confirmation words | 10.8 |
| Stolen unlocked phone | User verification required on every answer | 10.5 (check 5) |
| Malicious code deploy | Trusted-base controls | 16.6 |
| Relay DoS | Rate limits, two relay containers behind Caddy, Cloudflare proxy (P1). The failure mode is "Not confirmed yet", never a false green. | 16.1, 18 |
| SSRF through push endpoints | Endpoint host allowlist | 11.3 |
| Lab misused in production | Off-switch, password, opt-in on both ends, banner | 14.1 |
| Log or backup leak | No content stored; pseudonymous IDs; short retention | 15.3, 16.7 |
| Clock skew causing false expiry | Relay-supplied `ttlMs`; only own-clock comparisons | 8.7 |

---

## 17. Privacy (India's DPDP Act, 2023)

### 17.1 Data inventory

| Data | Where | Personal? | Purpose | Retention |
|---|---|---|---|---|
| Names, labels, phone numbers, family list, history, verdicts, safety words | **Phones only** (IndexedDB) | Yes | The service itself | Until the user deletes it |
| Device ID, device public key, platform, app version, last-seen *day* | Postgres | Pseudonymous | Routing, abuse control | Until retired, or 12 months inactive |
| Contact bindings and grant hashes | Postgres | Pseudonymous; it reveals *who can contact whom* (a social graph), so treat it as sensitive | Authorisation | Allowed: until removed or retired. Revoked: while the target is active (15.3). |
| Push subscription (endpoint, keys) | Postgres | Yes (an identifier) | Notifications | Until expired or retired (+30 days) |
| Sealed envelopes | Redis | Contents unreadable; metadata only | Delivery | 60 s to 24 h |
| IP addresses | Rate-limit keys (HMAC, monthly key) | Yes | Abuse control | ≤ 1 hour |
| Security events | Postgres `audit_events` | Pseudonymous, no content | Security | 1 year |
| Error reports | Sentry | Scrubbed | Debugging | 30 days |
| Call Guard audio and transcripts | The laptop browser only (and the browser's speech service) | Yes | Suggesting a check | Not stored by Pehchaan |

### 17.2 What the law asks, and how the design meets it

The DPDP Rules, 2025 were notified on 13–14 November 2025. Most operating obligations (notice, consent, security safeguards, breach notification, erasure) apply from **13 May 2027**, after the 18-month phase-in. The Data Protection Board provisions apply from notification, and consent-manager rules from November 2026. Build to the full obligations now; retrofitting is harder.

| Obligation | How Pehchaan meets it |
|---|---|
| Notice (clear, itemised, English and Hindi) | A setup screen and a Settings → Privacy page listing exactly the inventory above, in plain language, with a contact address |
| Consent, specific and withdrawable | Setup consent for the service. Separate explicit permission for notifications, camera and microphone (Call Guard). "Delete my data" in Settings sends `device.retire`. |
| Purpose and data minimisation | The relay stores no names, numbers, amounts or contents; last-seen is day-level only; IPs are HMAC'd and short-lived |
| Reasonable security safeguards | TLS, E2E, access control (16.3), encryption at rest (provider default), 2FA everywhere, pseudonymous security logs kept 1 year |
| Breach notification | Runbook 24.5: inform the Data Protection Board and affected users without delay, with a detailed report on the timeline the Rules set (72 hours as currently written). Because phones hold the personal data, a server breach exposes pseudonymous IDs and the social graph, not names or numbers. |
| Erasure | `device.retire` deletes within 24 h, leaving only a tombstone (ID, public key, date) so that blocks keep working. Inactive devices are retired after 12 months. |
| Grievance redressal | A named contact (email) on the Privacy page; reply within the period the Rules set |
| Children | Pehchaan is for families and doesn't ask for age. Guidance: members under 18 are added with a parent present. Get a legal review of the verifiable-consent rules before public launch. |
| Cross-border transfer | Servers are in Mumbai (Oracle Cloud). Sentry, Grafana Cloud and the backup bucket (which holds only encrypted dumps) may be abroad; list them as processors in the notice. |

This is engineering guidance, not legal advice. Before a public launch, have a lawyer review the privacy notice and the processor list.

---

# PART C·V: OPERATIONS

## 18. Infrastructure and deployment

### 18.1 Hosting: free, always on, in India

**The whole stack costs ₹0 a month.** The only thing you pay for is the domain.

| Layer | Free service | Notes |
|---|---|---|
| App (PWA) | Vercel Hobby | Non-commercial use only; move to Pro before charging anyone |
| Relay, Redis, Postgres | **One Oracle Cloud "Always Free" Arm VM in Mumbai**, running Docker Compose: Caddy (HTTPS), two relay containers, Valkey, Postgres, a backup job and a monitoring agent | Production |
| Staging, and standby for production | A second Always Free Arm VM | The free Arm allowance is split between the two VMs: 1 OCPU and 6 GB RAM each |
| DNS | Cloudflare (free plan) | n/a |
| Container images | GitHub Container Registry | n/a |
| CI/CD | GitHub Actions | n/a |
| Backups | Backblaze B2 or Cloudflare R2 free tier | Deliberately at a *different* provider from the VM |
| Metrics, logs, alerts | Grafana Cloud (free tier) | n/a |
| Errors | Sentry (free tier) | n/a |
| Uptime | UptimeRobot or Better Stack (free tier) | n/a |

**Why Oracle Cloud.** It is the only free option that meets all four needs at once:
- It is **always on** and never sleeps. A sleeping relay drops every phone.
- It is **a real VM**, so it runs the exact same Docker image, with no rewrite.
- It is **in India**: Mumbai, or Hyderabad as the alternative home region.
- It is **big enough**. Since 15 June 2026 the Arm allowance is 2 OCPU and 12 GB RAM in total. Oracle halved it from 4 and 24 without announcing it, so plan for more changes.

**Free options considered and rejected:**

| Option | Why not |
|---|---|
| Fly.io (the earlier plan) | No free tier for new accounts, only a short trial. It remains the best *paid* next step: same image, no code change (20.2). |
| Render / Koyeb free tiers | Instances go to sleep when idle (Render: after 15 minutes without inbound traffic) and take a long time to wake. Sleeping drops every WebSocket. |
| Railway | Trial credit only, then paid |
| Google Cloud Run free tier | Charged for every second a WebSocket stays open. The free allowance (about 50 vCPU-hours a month) cannot cover a relay that is connected all day. |
| Google Cloud e2-micro (Always Free) | US regions only, 1 GB RAM, and only 1 GB of free outbound data a month. Usable as an emergency fallback, not as the main host. |
| Cloudflare Workers + Durable Objects (free plan) | Technically excellent, but a different runtime: the relay would be rewritten around Durable Objects instead of Node + Redis. Kept as a v2 option (3.2). |
| DigitalOcean through the GitHub Student Pack | That student credit ended in August 2026 |
| **Azure for Students** | USD 100 credit with no card needed, plus a free B1s VM in Central India for 12 months. **This is the fallback** if Oracle sign-up fails or Oracle reclaims the VM: the same `compose.yml` runs on it unchanged. |

**What "free" costs you (honest trade-offs):**
- **One VM is one point of failure.** Two relay containers protect against crashes and deploys, not against the VM or Oracle's region going down. The mitigations:
  - the second VM as a standby;
  - backups at another provider;
  - a rebuild you have practised (24.3).
- **You run the server yourselves.** Operating-system updates, Valkey, Postgres, backups and monitoring are your job. All of it is scripted below, so it's minutes of work, not hours.
- **Oracle can change or take back free resources.** It halved the Arm allowance in June 2026, and its documentation says idle Always Free instances can be reclaimed. The mitigations:
  - upgrade the account to Pay As You Go (Always Free resources stay free; the idle rule applies to free-only accounts);
  - set a budget alert;
  - check Oracle's Always Free page monthly.
- **Nothing in the code depends on Oracle.** Moving to Fly.io, a bigger VM or AWS later changes configuration only (20.2).

### 18.2 Domains and DNS (Cloudflare)

| Name | Record | Points to | Proxy |
|---|---|---|---|
| `app.yourdomain.in` | CNAME | `cname.vercel-dns.com` | DNS only (Vercel handles TLS and its own CDN) |
| `staging.yourdomain.in` | CNAME | `cname.vercel-dns.com` | DNS only |
| `relay.yourdomain.in` | A | The production VM's **reserved** public IP (it survives a VM rebuild) | P0: DNS only; Caddy gets a Let's Encrypt certificate by itself. P1: proxied through Cloudflare for DDoS protection, with SSL "Full (strict)" and a free Cloudflare Origin Certificate loaded into Caddy. |
| `relay-staging.yourdomain.in` | A | The staging VM's reserved public IP | DNS only |
| `dev-<name>.yourdomain.in` | Cloudflare Tunnel | The developer's laptop | Tunnel |
| `yourdomain.in` (apex) | Redirect | `https://app.yourdomain.in` | Proxied |
| CAA | `0 issue "letsencrypt.org"` | Used by Vercel and Caddy | n/a |

- Keep the TTL at 60 s on the `relay` records, so that switching to the standby VM takes effect in about a minute.
- **Getting the domain:** buy the `.in` at any registrar, point its nameservers to Cloudflare, then turn on DNSSEC and the registrar lock.
- If you'd rather not pay for a domain at all, the GitHub Student Developer Pack has in the past included a free first-year `.me` or `.tech` domain; check the pack's current offers. **Choose the domain before any passkey is created:** passkeys are bound to it forever (5.3).

### 18.3 Environments

| | Development | Staging | Production |
|---|---|---|---|
| App | Vite on the laptop via the tunnel | Vercel branch `staging` | Vercel branch `main` |
| Relay host | The laptop (`pnpm dev`) | Oracle VM #2 (1 OCPU, 6 GB) | Oracle VM #1 (1 OCPU, 6 GB) |
| Relay containers | 1 | 2 (`relay-a`, `relay-b`), so deploys and failover can be rehearsed on staging | 2 (`relay-a`, `relay-b`) |
| Valkey / Postgres | Docker Compose on the laptop | Compose on VM #2 | Compose on VM #1 |
| `E2E_REQUIRED` | false | true once FC-7 ships | false until FC-7 ships, then true |
| `LAB_ENABLED` | true | true | Event build only; switched on and off at runtime with `admin lab on/off` |
| Data | Throwaway | Test families | Real families |

The environments never share keys, databases, VAPID keys or passkeys (the rpIds differ).

### 18.4 One-time setup on Oracle Cloud

**Do this in week 1.** Card checks and Arm capacity can take days.

1. **Sign up at cloud.oracle.com.**
   - Oracle verifies you with a card, using a small temporary hold. Use a Visa or Mastercard with international transactions enabled; many Indian debit cards are refused.
   - **Pick Mumbai (`ap-mumbai-1`) or Hyderabad as the home region.** It can never be changed, and Always Free resources exist only there.
2. **Upgrade to Pay As You Go (recommended), then add a budget.**
   - Always Free resources stay free after the upgrade. Only resources beyond the free limits are charged.
   - Budgets → a US$1 monthly budget, with an alert at any spend.
   - From then on, only create resources that the console marks **"Always Free-eligible"**.
3. **Network.**
   - Create a VCN with the "VCN with Internet Connectivity" wizard.
   - In its security list, allow ingress on TCP 80 and 443 from anywhere, and TCP 22 for SSH.
4. **Two instances.**
   - Shape `VM.Standard.A1.Flex`, Ubuntu 24.04 (aarch64), **1 OCPU and 6 GB each**.
   - Attach a *reserved* public IP to each.
   - If the console says "Out of capacity", try another availability domain or retry later.
   - The AMD `VM.Standard.E2.1.Micro` (1 GB, also Always Free) is the emergency fallback.
5. **First boot.** Paste `infra/vm/cloud-init.yaml` as the instance's user data (below). It installs Docker, opens the firewall correctly, turns on automatic security updates, and creates the `deploy` user for CI.
6. **On each VM, in `/opt/pehchaan`:**
   - copy `compose.yml`, `Caddyfile`, `config.alloy` and `deploy.sh` from `infra/vm/`;
   - create `.env` from `infra/vm/env.example` (mode 600, owned by `deploy`, and **never** committed);
   - run `chmod +x deploy.sh`, and generate every password with `openssl rand -hex 32` (hex keeps the database URLs valid);
   - as the `deploy` user, run `docker login ghcr.io` once with a read-only token.

   The first deploy then comes from CI (18.8).

```yaml
#cloud-config   (infra/vm/cloud-init.yaml)
package_update: true
package_upgrade: true
packages: [ca-certificates, curl, unattended-upgrades, fail2ban, netfilter-persistent]
ssh_pwauth: false
users:
  - default
  - name: deploy
    shell: /bin/bash
    ssh_authorized_keys: ["ssh-ed25519 AAAA… pehchaan-ci-deploy"]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker deploy
  # Oracle's Ubuntu images ship iptables rules that reject everything except SSH,
  # including traffic Docker forwards to containers. Open 80/443 and drop the FORWARD reject.
  - sed -i '/-A INPUT -j REJECT --reject-with icmp-host-prohibited/i -A INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT' /etc/iptables/rules.v4
  - sed -i '/-A FORWARD -j REJECT --reject-with icmp-host-prohibited/d' /etc/iptables/rules.v4
  - netfilter-persistent reload
  - systemctl restart docker            # re-create Docker's own rules after the reload
  - mkdir -p /opt/pehchaan && chown deploy:deploy /opt/pehchaan
  - dpkg-reconfigure -f noninteractive unattended-upgrades
```

### 18.5 Dockerfile (`infra/docker/Dockerfile.relay`)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json .npmrc ./
COPY packages ./packages
COPY apps/relay ./apps/relay
RUN pnpm install --frozen-lockfile --filter @pehchaan/relay...
RUN pnpm turbo run build --filter @pehchaan/relay...
# pnpm 10: set inject-workspace-packages=true in .npmrc so `deploy` copies workspace packages
RUN pnpm --filter @pehchaan/relay deploy --prod /out

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
USER node
EXPOSE 8080 9091
CMD ["node", "dist/main.js"]
```

- **The Oracle VMs are Arm (`linux/arm64`).** CI builds the image for both `linux/arm64` and `linux/amd64`, so the same tag also runs on the Azure or Google fallback VMs.
- The final image contains only the built relay and its production dependencies, and runs as the non-root `node` user. Pin the base images by digest and scan every build with Trivy.
- A second small image, `Dockerfile.backup`, is built `FROM postgres:16` (so that `pg_dump` matches the server) and adds `age`, `rclone` and `supercronic` (18.10).

### 18.6 The server: Docker Compose and Caddy (`infra/vm/`)

**`compose.yml`.** The same file is used on both VMs. Each VM's `.env` decides the rest.

```yaml
name: pehchaan

x-relay: &relay
  image: ghcr.io/<org>/pehchaan-relay:${RELAY_TAG}
  restart: unless-stopped
  env_file: .env
  stop_grace_period: 40s                          # time to drain (18.9)
  depends_on:
    postgres: { condition: service_healthy }
    valkey: { condition: service_started }
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
    interval: 5s
    timeout: 3s
    retries: 3
    start_period: 20s
  logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }
  networks: [internal]

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    env_file: .env                                # RELAY_HOST, RELAY_UPSTREAMS
    ports: ["80:80", "443:443"]                   # the only published ports
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"]
    networks: { internal: { ipv4_address: 172.30.0.2 } }   # fixed, so the relay can trust only Caddy

  relay-a:
    <<: *relay
    environment: { GATEWAY_NAME: relay-a }

  relay-b:
    <<: *relay
    environment: { GATEWAY_NAME: relay-b }
    profiles: ["ha"]                              # both VMs set COMPOSE_PROFILES=ha; a laptop may leave it off

  valkey:
    image: valkey/valkey:8
    restart: unless-stopped
    command: ["valkey-server", "--requirepass", "${VALKEY_PASSWORD}", "--save", "", "--appendonly", "no",
              "--maxmemory", "768mb", "--maxmemory-policy", "noeviction"]
    networks: [internal]                          # never publish 6379

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment: { POSTGRES_DB: pehchaan, POSTGRES_USER: pehchaan, POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}" }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "pehchaan", "-d", "pehchaan"], interval: 5s, retries: 10 }
    networks: [internal]                          # never publish 5432

  backup:                                         # nightly encrypted dump → off-provider bucket (18.10)
    image: ghcr.io/<org>/pehchaan-backup:${RELAY_TAG}
    restart: unless-stopped
    env_file: .env
    networks: [internal]

  alloy:                                          # metrics and logs → Grafana Cloud (19)
    image: grafana/alloy:latest                   # pin a version in practice
    restart: unless-stopped
    env_file: .env
    command: ["run", "/etc/alloy/config.alloy"]
    volumes: ["./config.alloy:/etc/alloy/config.alloy:ro",
              "/var/lib/docker/containers:/var/lib/docker/containers:ro",
              "/proc:/host/proc:ro", "/sys:/host/sys:ro"]
    networks: [internal]

networks:
  internal:
    ipam: { config: [{ subnet: 172.30.0.0/24 }] }
volumes: { caddy_data: {}, caddy_config: {}, pgdata: {} }
```

**`Caddyfile`:**

```
{
	email ops@yourdomain.in
	acme_ca https://acme-v02.api.letsencrypt.org/directory
	{$CADDY_LOCAL_CERTS}
}

{$RELAY_HOST} {
	reverse_proxy {$RELAY_UPSTREAMS} {
		lb_policy least_conn        # WebSockets are long-lived: balance by open connections
		lb_try_duration 5s          # if a relay can't be reached (container stopping), try the other
		health_uri /readyz
		health_interval 5s
		health_timeout 2s
	}
}
```

- **Both VMs' `.env`:** `RELAY_UPSTREAMS="relay-a:8080 relay-b:8080"` and `COMPOSE_PROFILES=ha`. For the local test stack (Phase 10), also set `CADDY_LOCAL_CERTS=local_certs`, so Caddy uses its own internal certificate authority. Leave it empty on the VMs.
- Caddy obtains and renews the HTTPS certificate by itself, handles WebSocket upgrades natively, and sets `X-Forwarded-For`. The relay trusts that header **only** from Caddy's address on the internal network (`TRUST_PROXY`), so rate limits (16.1) see the real client IP.
- **`config.alloy`** collects and ships to Grafana Cloud with the stack's API token (19.1–19.2):
  - it scrapes `relay-a:9091` and `relay-b:9091`, plus the VM's own CPU, memory and disk (`prometheus.exporter.unix` reading `/host/proc` and `/host/sys`);
  - it tails the container log files.

  It deliberately reads log files instead of mounting the Docker socket, which would give it root-level control.

### 18.7 Configuration variables

**Relay** (the VM's `.env`). Every variable is validated with `zod` at boot. A missing or invalid value stops the relay from starting (fail fast).

| Variable | Example | Secret |
|---|---|---|
| `ENV_NAME` | `production` | |
| `PORT`, `METRICS_PORT` | `8080`, `9091` | |
| `RELAY_HOST` | `relay.yourdomain.in` (used in the signed login message, and by Caddy) | |
| `RELAY_UPSTREAMS` | `relay-a:8080 relay-b:8080` (Caddy only) | |
| `COMPOSE_PROFILES` | `ha` on both VMs (starts `relay-b`) | |
| `CADDY_LOCAL_CERTS` | empty on the VMs; `local_certs` on a local test stack | |
| `RELAY_TAG` | the image tag currently deployed (written by `deploy.sh`) | |
| `PUBLIC_ORIGINS` | `https://app.yourdomain.in` (comma list) | |
| `REDIS_URL` | `redis://:<VALKEY_PASSWORD>@valkey:6379` | yes |
| `DATABASE_URL` | `postgres://pehchaan:<POSTGRES_PASSWORD>@postgres:5432/pehchaan` | yes |
| `VALKEY_PASSWORD`, `POSTGRES_PASSWORD` | `openssl rand -hex 32` each (hex, so the URLs stay valid) | yes |
| `VAPID_PUBLIC_KEY`, `VAPID_KEY_ID`, `VAPID_SUBJECT` | n/a | |
| `VAPID_PRIVATE_KEY` | n/a | yes |
| `E2E_REQUIRED`, `LAB_ENABLED` | `false` / `false` (18.3) | |
| `LAB_PASSWORD_HASH` | Argon2id hash. In `.env`, wrap it in single quotes, because it contains `$`. | yes |
| `MIN_CLIENT_VERSION` | `1.0.0` | |
| `MAX_SOCKETS` | `15000` per relay container. At the limit the relay's `/readyz` returns 503, so Caddy stops sending it new connections. An upgrade that still arrives gets 503, and the app retries with backoff. | |
| `TRUST_PROXY` | `172.30.0.2/32`: Caddy's fixed address on the internal network | |
| `KEY_PREFIX` | empty in production. Tests set a unique prefix per test file, so parallel suites never share Valkey keys or pub/sub channels. | |
| `RATE_LIMIT_PROFILE` | `standard` \| `relaxed` (load tests on staging only) | |
| `AUDIT_KEY`, `IP_HASH_KEY` | 32 random bytes | yes |
| `GATEWAY_NAME` | set per container in `compose.yml`. The relay adds a random suffix at each start to form its gateway ID. | |
| `SENTRY_DSN`, `LOG_LEVEL` | n/a | |
| `DRAIN_TIMEOUT_MS` | `20000` | |
| `BACKUP_AGE_RECIPIENT`, `RCLONE_CONFIG_BACKUP_*` | the backup encryption public key, and the bucket credentials | bucket keys: yes |
| `GRAFANA_CLOUD_*` | Alloy's push endpoints and token | token: yes |

**App.** Vite bakes these in at build time, so changing one needs a redeploy.

| Variable | Production value |
|---|---|
| `VITE_ENV` | `production` |
| `VITE_ORIGIN` | `https://app.yourdomain.in` |
| `VITE_RP_ID` | `app.yourdomain.in` |
| `VITE_RELAY_URL` | `wss://relay.yourdomain.in/v1/ws` |
| `VITE_RELAY_HTTP` | `https://relay.yourdomain.in` |
| `VITE_VAPID_PUBLIC_KEY`, `VITE_VAPID_KEY_ID` | must match the relay |
| `VITE_SIM_RELAY`, `VITE_SIM_KEY`, `VITE_SIM_VERIFIER` | `false` |
| `VITE_ENABLE_LAB` | `true` for the judging build, `false` afterwards |
| `VITE_ENABLE_GUARD` | `true` |
| `VITE_ENABLE_EXTRAS` | `false` (A8 is no longer an extra; see section 22) |
| `VITE_SENTRY_DSN` | n/a |
| `VITE_APP_VERSION` | `package.json` version + short git SHA |

### 18.8 CI/CD (GitHub Actions)

**`ci.yml`** runs on every pull request and every push:

```yaml
name: ci
on:
  pull_request: {}
  push: { branches: [main, staging] }
jobs:
  verify:
    runs-on: ubuntu-latest
    env: { REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgres://postgres:test@localhost:5432/postgres' }
    services:
      valkey:   { image: valkey/valkey:8, ports: ['6379:6379'] }
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: test }, ports: ['5432:5432'],
                  options: '--health-cmd pg_isready --health-interval 5s --health-retries 10' }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test build      # unit tests incl. crypto vectors
      - run: pnpm depcruise                                # code boundaries (section 4)
      - run: pnpm --filter @pehchaan/relay test:integration
      - run: pnpm --filter @pehchaan/web exec playwright install --with-deps chromium
      - run: pnpm test:e2e                                 # relay + web + virtual authenticator
      - run: E2E_REQUIRED=true pnpm test:e2e               # the same journeys with E2E on (from Phase 8)
```

**`deploy-relay.yml`** runs after `ci` succeeds on `main`. It builds the image once and promotes exactly that commit's image through staging to production:

```yaml
name: deploy-relay
on:
  workflow_run: { workflows: [ci], types: [completed], branches: [main] }
concurrency: { group: deploy-relay, cancel-in-progress: false }   # never two deploys at once
env:
  SHA: ${{ github.event.workflow_run.head_sha }}                  # the commit ci tested (not main's newest)
jobs:
  build:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
        with: { ref: '${{ env.SHA }}' }
      - uses: docker/setup-qemu-action@v3                  # Arm builds on a standard runner
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}' }
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/Dockerfile.relay
          platforms: linux/arm64,linux/amd64
          push: true
          tags: ghcr.io/<org>/pehchaan-relay:${{ env.SHA }}  # the image name must be lowercase
      # (same step again for infra/docker/Dockerfile.backup → pehchaan-backup)
      # then scan the pushed image with Trivy and fail on CRITICAL/HIGH

  deploy-staging:
    needs: build
    environment: staging                                   # holds VM_IP, DEPLOY_SSH_KEY, VM_KNOWN_HOSTS
    runs-on: ubuntu-latest
    steps:
      - name: Rolling deploy over SSH
        env: { SSH_KEY: '${{ secrets.DEPLOY_SSH_KEY }}', KNOWN_HOSTS: '${{ secrets.VM_KNOWN_HOSTS }}' }
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh deploy@${{ vars.VM_IP }} "/opt/pehchaan/deploy.sh $SHA"

  smoke-staging:
    needs: deploy-staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: '${{ env.SHA }}' }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pehchaan/canary smoke -- --relay wss://relay-staging.yourdomain.in/v1/ws
        # login · request/answer round trip with software keys · push to a mock endpoint · one Lab attack

  deploy-production:
    needs: smoke-staging
    environment: production                                # requires a reviewer's approval
    runs-on: ubuntu-latest
    steps:
      - name: Rolling deploy over SSH
        env: { SSH_KEY: '${{ secrets.DEPLOY_SSH_KEY }}', KNOWN_HOSTS: '${{ secrets.VM_KNOWN_HOSTS }}' }
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh deploy@${{ vars.VM_IP }} "/opt/pehchaan/deploy.sh $SHA"
          # then the canary (19.6) runs against production
```

Each GitHub Environment (`staging`, `production`) holds its own `VM_IP` variable and `DEPLOY_SSH_KEY` / `VM_KNOWN_HOSTS` secrets. The staging Lab switch must be on (`admin lab on`) for the smoke test's Lab attack.

**`deploy.sh` on the VM** (rolling: one relay container at a time, so the relay never goes down):

```bash
#!/usr/bin/env bash
# deploy.sh <image-tag>: rolling deploy, one relay container at a time.
# On a VM it runs in /opt/pehchaan. For local tests: PEHCHAAN_DIR=… SKIP_PULL=1 ./deploy.sh <local-tag>
set -euo pipefail
cd "${PEHCHAAN_DIR:-/opt/pehchaan}"
TAG="$1"
grep -q '^RELAY_TAG=' .env || echo 'RELAY_TAG=' >> .env
sed -i "s/^RELAY_TAG=.*/RELAY_TAG=${TAG}/" .env
docker compose up -d --wait postgres valkey caddy alloy          # no-op when already running; needed on first deploy
mapfile -t RELAYS < <(docker compose config --services | grep '^relay-')
[ "${SKIP_PULL:-0}" = 1 ] || docker compose pull "${RELAYS[@]}" backup
docker compose run --rm --no-deps relay-a node dist/migrate.js    # expand-only migrations (15.2)
for svc in "${RELAYS[@]}"; do
  docker compose up -d --no-deps "$svc"          # SIGTERM → drain (18.9) → new container starts
  for i in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$svc")")" = healthy ] && break
    [ "$i" -eq 60 ] && { echo "$svc did not become healthy"; exit 1; }
    sleep 2
  done
done
docker compose up -d --no-deps backup
echo "$(date -Is) $TAG" >> deploy.log                # the rollback list (24.2)
docker image prune -f
```

- **The app** deploys through Vercel's Git integration: `main` → production, `staging` → staging, pull requests → previews (simulated keys only).
- **Keep the registry small.** Delete old image versions, keeping the last 10. GitHub's free plan includes limited private package storage; the relay image contains no secrets, so making it public is also fine.
- **Deploy freeze:** no deploys from 48 h before judging until judging ends, except rollbacks. The Lab is switched on and off at runtime (`admin lab on/off`), so it never needs a deploy inside the freeze.

### 18.9 Zero-downtime deploys (draining)

```ts
process.on('SIGTERM', async () => {
  state.draining = true;                        // /readyz → 503 at once
  await sleep(6_000);                           // Caddy's 5 s health check takes this container out first…
  upgrades.refuse(503);                         // …so almost no new upgrade ever sees this 503 (Caddy only retries dial errors)
  const spreadMs = Math.min(5_000, sessions.count());           // spread reconnects over ≤ 5 s
  for (const s of sessions.all())
    s.send(frame('reconnect', { afterMs: Math.floor(Math.random() * spreadMs) }));
  await waitFor(() => sessions.count() === 0, cfg.DRAIN_TIMEOUT_MS);   // phones leave on their own
  for (const s of sessions.all()) s.close(1012, 'restart');
  await Promise.allSettled([bus.close(), redis.quit(), db.end()]);
  process.exit(0);
});
```

- `docker compose up -d` stops the old container with SIGTERM and waits up to `stop_grace_period` (40 s). The drain takes at most 6 s + `DRAIN_TIMEOUT_MS` (20 s), so it always finishes first.
- While `relay-a` drains, Caddy sends every new connection to `relay-b`, and the other way round. Capacity never drops to zero.
- In-flight envelopes and request records are in Valkey, so a verification in progress survives a deploy. At most, the phone shows "Reconnecting…" for a second or two.

### 18.10 Backups, rollback and disaster recovery

| Item | Plan |
|---|---|
| Postgres | Every night the `backup` container runs `pg_dump -Fc`, encrypts the dump with `age` (only the *public* key is on the VM; the private key is kept offline by two teammates), uploads it with `rclone` to a free bucket at a **different provider** (Backblaze B2 or Cloudflare R2), and deletes copies older than 30 days. The same job runs the retention SQL (15.3). **Restore test once a month,** into a throwaway `postgres:16` container on the staging VM (never into staging's own database). Recovery point: ≤ 24 h. Recovery time: ≤ 1 h. |
| Valkey | No backups needed: ephemeral and self-healing (15.4) |
| Relay rollback | `ssh deploy@<vm> /opt/pehchaan/deploy.sh <previous tag>`. The tags are in `deploy.log`. Migrations are expand-only, so rollbacks are always safe. |
| App rollback | Vercel → Deployments → the previous production deployment → "Promote to Production". The service worker picks up the rollback on next launch. |
| Production VM lost (hardware fault, Oracle reclaims it, account problem) | The staging VM is the warm standby: bring up the production stack there from the same files, restore the latest dump, and point the `relay` DNS record at it (runbook 24.3, target 30 minutes). If Oracle is unusable altogether, run the same `cloud-init.yaml` and `compose.yml` on an Azure for Students VM in Central India. Practise the switch once before judging. |
| Everything as code | `cloud-init.yaml`, `compose.yml`, `Caddyfile`, `config.alloy`, `deploy.sh`, `vercel.json`, an exported DNS zone file, Grafana dashboards as JSON, and runbooks, all in the repository |

### 18.11 Costs and free-tier traps

| Item | Cost |
|---|---|
| Vercel Hobby | ₹0 (non-commercial use only) |
| Oracle Cloud Always Free: two Arm VMs (2 OCPU and 12 GB in total), up to 200 GB of block storage, 10 TB of outbound data a month | ₹0 |
| Cloudflare DNS, GitHub Actions and Container Registry, Grafana Cloud, Sentry, uptime monitor, Backblaze B2 or Cloudflare R2 | ₹0 within their free limits |
| `.in` domain | about ₹600–1,000 per year: **the only real cost** |
| When you outgrow it (20.2) | The first paid step (for example Fly.io plus managed Redis and Postgres) is roughly US$40–60 a month |

**Traps that break things silently:**
- **Oracle's home region is permanent,** and Always Free resources exist only there. Choose Mumbai or Hyderabad at sign-up.
- **Idle reclamation.** Oracle may reclaim Always Free instances it considers idle, and a quiet relay looks idle. Upgrade to Pay As You Go (18.4, step 2).
- **Limits change without notice** (the June 2026 halving). Stay within 2 OCPU and 12 GB in total, only create "Always Free-eligible" resources, and read Oracle's Always Free page once a month.
- **Arm.** Every image must include `linux/arm64`. The CI builds both architectures.
- **Oracle's Ubuntu firewall** blocks ports 80 and 443 (and Docker's forwarded traffic) until fixed. `cloud-init.yaml` does it.
- **Never publish Valkey (6379) or Postgres (5432)** to the internet. The compose file keeps them on the internal network. For database access, use `ssh -L` to the VM.
- **Vercel Hobby prohibits commercial use.** Move to Pro before charging anyone or partnering with an institution.
- **Grafana Cloud's free tier** has a series and log quota. Never label metrics with device IDs.
- **Sentry's free quota:** sample events on the client.
- **Free hosts that sleep** (Render, Koyeb) must never run the relay.

### 18.12 Local development

1. `docker compose -f infra/compose/docker-compose.dev.yml up -d` (Valkey 8 + Postgres 16).
2. `pnpm dev` runs the relay on `:8080` (`tsx watch`) and the app on `:5173`.
3. Vite proxies `/relay` → `ws://localhost:8080` (`ws: true`), so there's one origin.
4. **For real phones,** `cloudflared tunnel run dev-<name>` maps `https://dev-<name>.yourdomain.in` to the laptop. Set:
   - `VITE_RP_ID=dev-<name>.yourdomain.in`
   - `VITE_RELAY_URL=wss://dev-<name>.yourdomain.in/relay/v1/ws`
   - the dev origin in `PUBLIC_ORIGINS`, and `RELAY_HOST=dev-<name>.yourdomain.in` (the signed login message includes it; a mismatch fails every login with 4401)
   - the tunnel host in Vite's `server.allowedHosts` (newer Vite versions block unknown hosts by default).
5. Passkeys and push both work over the tunnel, because it is real HTTPS.

---

## 19. Observability and service levels

### 19.1 Metrics (Prometheus format, collected by Grafana Alloy on the VM and stored in Grafana Cloud)

| Metric | Type | Labels |
|---|---|---|
| `pehchaan_ws_connections` | gauge | `platform` |
| `pehchaan_ws_auth_total` | counter | `result` (ok, bad_sig, timeout, blocked, too_old) |
| `pehchaan_messages_total` | counter | `t`, `kind`, `result` |
| `pehchaan_route_latency_ms` | histogram | n/a (accepted → written to the recipient's socket) |
| `pehchaan_receipts_total` | counter | `state` (accepted, pushed, delivered, seen, queued, failed, rejected) |
| `pehchaan_push_total` / `pehchaan_push_latency_ms` | counter / histogram | `service` (fcm, apple, mozilla, wns), `result` |
| `pehchaan_requests_total` | counter | `outcome` (answered, answered_late, cancelled, expired) |
| `pehchaan_answer_time_ms` | histogram | n/a (request accepted → answer accepted: the human part) |
| `pehchaan_rate_limited_total` | counter | `scope` |
| `pehchaan_inbox_put_total` / `pehchaan_inbox_full_total` | counter | n/a |
| `pehchaan_redis_latency_ms`, `pehchaan_pg_latency_ms` | histogram | `op` |
| `pehchaan_lab_attacks_total` | counter | `attack`, `verdict` |
| `pehchaan_lab_false_greens_total` | counter | n/a. **Must always be 0.** |
| Node defaults (`prom-client`) | various | event-loop lag, heap, GC, CPU |

### 19.2 Logs

`pino` JSON to stdout. Docker keeps it in size-capped files (18.6); Grafana Alloy ships it to Grafana Cloud Loki.
- **Fields:** `ts`, `level`, `gw`, `t`, `kind`, `result`, `ms`, `dev` (HMAC), `req` (the request ID only when debugging is enabled for that ID).
- **Retention:** 14 days.
- **The rules in 16.7 apply:** no payloads, no raw IPs.

### 19.3 Dashboards (Grafana, stored as JSON in `infra/grafana`)

1. **Overview:** connections, message rate, error rate, deploy markers.
2. **Delivery funnel:** accepted → pushed/delivered → seen → answered, and time to answer.
3. **Push health:** by service; 404/410 rates; latency.
4. **Infrastructure:** VM CPU, memory and disk, container health and restarts, event-loop lag, Redis and Postgres latency.
5. **Security Lab:** attacks by type, verdicts, false greens (a big green 0).

### 19.4 Service levels (SLOs)

| Indicator | Target |
|---|---|
| Relay availability (canary logs in within 5 s) | 99.9% per month |
| Routing latency, p95 (accepted → recipient's socket) | < 150 ms |
| Push hand-off, p95 (accepted → push service 201) | < 800 ms |
| Delivery to online devices (accepted → delivered within 5 s) | ≥ 99.5% |
| Canary full round trip (request → answer → receipt) | ≥ 99.9% success, p95 < 3 s |
| False greens | **0, always** |

### 19.5 Alerts (P1; Grafana alerting to email and a team chat)

Page someone when any of these happen:
- the canary fails 3 times in a row;
- `/healthz` is down from the external monitor;
- the server error rate is above 2% for 5 minutes;
- event-loop lag p99 is above 200 ms for 5 minutes;
- push failures are above 10% for 10 minutes;
- Redis or Postgres error rates rise;
- connections drop by more than 50% in 5 minutes;
- **any false green.**

A notice (not a page) goes out for: VM disk above 70%, a nightly backup missing for more than 26 h, any Oracle budget alert, Grafana or Sentry free quotas near their limit, and certificates expiring within 20 days.

### 19.6 The canary

- A scheduled GitHub Actions workflow runs `apps/canary` every 10 minutes from GitHub's servers, so from outside Oracle's network. GitHub may start scheduled runs a few minutes late, which is fine for this purpose. The external uptime monitor checks `/healthz` every 5 minutes as a second, independent signal.
- Two synthetic devices, `canary-asker` and `canary-answerer`, with software keys (a canary can't use a passkey):
  1. log in;
  2. send a request;
  3. answer;
  4. check the receipts and timings.
- It tests the relay path end to end. The passkey path is covered by Playwright in CI.
- Canary devices are marked in `devices.platform = 'canary'` and excluded from statistics.

---

## 20. Scaling plan

### 20.1 What load really looks like

Pehchaan is not chat: a family runs a check a few times a month, not a few times a minute. The load is mostly idle sockets, pushes and presence queries.

| Installed users | Concurrent sockets (assume 10% at peak) | Relay processes (15k sockets each, plus 1 spare) | Checks per day (0.05 per user) | Pushes per day (about 3 per check, plus alerts) | Redis ops/s at peak (rough) |
|---|---|---|---|---|---|
| 10,000 | 1,000 | 2 | 500 | ~2,000 | < 50 |
| 100,000 | 10,000 | 2 | 5,000 | ~20,000 | ~300 |
| 1,000,000 | 100,000 | 8 | 50,000 | ~200,000 | ~3,000 |
| 10,000,000 | 1,000,000 | ~70 (or ~18 larger machines) | 500,000 | ~2,000,000 | ~30,000 |

These are planning estimates. Replace them with the load-test results (21.4) and real metrics once you have them.

### 20.2 What changes at each stage

The code never changes; only configuration and capacity do.

| Stage | Change |
|---|---|
| Up to ~20k concurrent (**free**) | The Oracle VM: two relay containers, Valkey and Postgres on 1 OCPU and 6 GB. If needed, give production the whole free allowance (2 OCPU, 12 GB) and move staging to the Azure fallback or a laptop. |
| Up to ~50k concurrent (first paid step) | Move the relay containers to a paid host: Fly.io (2–4 machines in `bom`) or a larger VM. Use managed Redis and managed Postgres. Same image; only `REDIS_URL`, `DATABASE_URL` and DNS change. |
| Up to ~500k concurrent | Larger machines (about 60k sockets each), scaled by connection count. A dedicated managed Redis (for example ElastiCache). **Push sending moves to its own process group** (`push-worker`, reading a Redis Stream), so gateways never wait on push services. Postgres gets a bigger managed instance with connection pooling (PgBouncer). |
| Millions | The same image on AWS `ap-south-1`: ECS Fargate behind an NLB/ALB (WebSocket idle timeouts raised), **ElastiCache Valkey in cluster mode with sharded pub/sub** (the keys already carry hash tags), and RDS Postgres Multi-AZ. Optionally a second region (Hyderabad `ap-south-2`) as a hot standby. |
| Native apps (v2) | Add FCM/APNs direct senders alongside Web Push in `push-worker`. The protocol doesn't change. |

### 20.3 Designed-in scaling properties (why nothing gets rewritten)

- **Stateless gateways:** any machine can serve any phone, and machines are added or removed freely.
- **No per-device Redis traffic when idle:** liveness is per gateway (8.2).
- **Hash-tagged keys and a `bus` interface:** moving from a single Redis node to a cluster is configuration only.
- **Pub/sub is at-most-once, so the inbox holds the durable copy:** lost pub/sub messages are recovered by acks, push fallback and the inbox drain.
- **Postgres is off the hot path:** it is behind 10-minute caches, and most of its state self-heals (15.4).
- **Versioned protocol:** new features are additive.

---

## 21. Testing strategy

This section describes the test layers. **Part E lists every individual test**, Part B1 sets the test-as-you-build discipline, and each Part D phase names the tests to write alongside its code.

### 21.1 Unit tests (Vitest, `packages/*`), P0

- Canonical JSON and challenge test vectors (10.2), including Devanagari.
- `derToRaw`: real signatures from WebCrypto converted to DER and back, and malformed inputs (short, long, bad tags, extra bytes) must throw.
- authenticatorData parsing, flags and minimum length.
- **The verifier table** (10.5): all ten cases, from genuine YES to late YES, must produce exactly the listed verdict and reason.
- E2E: open succeeds; tampered header, flipped ciphertext bit, spoofed sender and a relay re-seal forgery all fail.
- Safety words: determinism, and any change to a key changes the words.
- Every `zod` schema: valid and invalid samples.

### 21.2 Integration tests (relay + real Valkey + Postgres in CI), P0

- **Login:** good, wrong signature, wrong relay host, reused server nonce, timeout, too-old client.
- **Routing:** two relay processes, with the sender on one and the recipient on the other.
- **Inbox:** the recipient offline → reconnect → drain → ack clears the entry.
- **Push fallback:** a mock push server asserts the `TTL`, `Urgency` and `Topic` headers and the VAPID JWT; simulates 410, 413, 429 and 5xx.
- **First answer wins:** two answers raced concurrently, exactly one accepted.
- Cancel, expiry, and the 30-second grace (`ok_late`).
- Grants, bindings, revocation and unrevocation; presence privacy (strangers show `offline`).
- Every rate limit, including CGNAT-style many devices behind one IP.
- **Drain:** SIGTERM during traffic loses zero envelopes.
- **Redis restart:** routes self-heal. **Postgres down:** fail closed on a cache miss; warm caches keep working.

### 21.3 End to end (Playwright), P0

- Three browser contexts (Maa, Arjun, Lab), a local relay, and the app with real keys at rpId `localhost` (a secure context).
- Each context gets a **virtual WebAuthn authenticator**:

```ts
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
```

**Scenarios:**
- the frontend's Part D walkthrough against the real backend;
- the family-link flow;
- the "new phone" guard;
- the late NOT ME and late YES cases;
- cancel;
- going offline and back online;
- restarting the relay during a request;
- **50 automated Lab attacks with 0 false greens.**

### 21.4 Load tests (P1, `apps/loadgen`)

A Node load generator (`ws` + WebCrypto + `worker_threads`), run from 2–3 GitHub Actions runners or teammates' laptops against staging, with `RATE_LIMIT_PROFILE=relaxed`:

1. **Capacity:** ramp to 20k sockets on one relay container over 10 min, hold for 60 min, with 5 checks per second. Record memory per socket, p95 routing latency and event-loop lag. Set `MAX_SOCKETS` at about 75% of the point where p95 exceeds 150 ms.
2. **Reconnect storm:** `docker kill` one relay container under load. Every socket reconnects to the other within 30 s, with errors below 1%.
3. **Soak:** 12 h at 50% capacity, with no memory growth.

### 21.5 Chaos tests (P1, on staging)

Run each of these while checks are in progress; each must end in a correct, safe outcome:
- `docker kill` a relay container mid-check, and reboot the whole VM mid-check;
- restart Redis;
- take Postgres down for 2 minutes;
- make the mock push service return 5xx;
- put a phone in airplane mode for 5 s during a check.

### 21.6 Real-phone matrix (P0 before judging)

| Dimension | Cover |
|---|---|
| Android | Pixel or Android One, Samsung, Xiaomi/Redmi, Vivo, Realme/Oppo, and one low-end phone with 3 GB RAM |
| iPhone | iOS 17, 18 and the current release, installed to the Home Screen |
| Network | Jio, Airtel, Vi, Wi-Fi, weak 4G (walk to the stairwell) |
| App state | Open; background; screen locked; app swiped away; phone just rebooted |
| Measure | Request → notification time; tap → verdict time; with the battery setting both default and Unrestricted |

Record the results in a table in `docs/`. Judges who ask "does it work on my phone?" get a real answer.

### 21.7 Security testing (P1)

- Property-based fuzzing of the envelope parser (`fast-check`).
- Scripted attacks:
  - replaying a login;
  - answering someone else's request;
  - bypassing a binding;
  - using `plain` when E2E is required;
  - oversized and binary frames;
  - holding upgrades open without logging in (slowloris);
  - subscribing with internal URLs (SSRF).
- **Before public launch:** have someone outside the team (a professor, the college security club, or a volunteer reviewer) review `packages/crypto` and this document's section 10.

---

## 22. Frontend changes required

Most screens stay as they are. These changes connect the finished frontend to the real backend.

### 22.1 Changes list

| # | Change | Where | Tier |
|---|---|---|---|
| FC-1 | Split `SIMULATION` into `SIM_RELAY`, `SIM_KEY` and `SIM_VERIFIER` (so, for example, the real relay can run with simulated keys during development). The badge shows whichever are simulated. | `flags.ts`, `services/index.ts` | P0 |
| FC-2 | Device identity at first launch: device signing key, encryption key and contact grant. `deviceId` derived from the signing key (5.2). | setup, `store` | P0 |
| FC-3 | Card v2: new fields, validation (6.1), safety words by PBKDF2 (6.3; never read from the card), and the **new-phone guard** (6.5) | `CardService`, C4, C5, C8 | P0 |
| FC-4 | `RealKey`: create (10.3); sign with challenges **precomputed when F1 opens** (10.4) | `services/real` | P0 |
| FC-5 | `RealVerifier` written by the team (10.5–10.6): the late policy, the used-nonce rules (10.9), and `CheckResult.skipped` for unreadable envelopes | `services/real`, E6 | P0 |
| FC-6 | `RealRelay`: protocol client, outbox with retries, receipts, reconnect with jitter, clock offset, processing of the push inbox | `services/real` | P0 |
| FC-7 | E2E seal and open inside `RealRelay` (section 9) | `services/real` | P1 |
| FC-8 | Push: A8 becomes a real setup step; the service worker moves to `injectManifest` with push and click handlers (11.5); "Send test alert" in Diagnostics | A8, `sw.ts`, J3 | P0 |
| FC-9 | Battery-reliability guidance by phone brand (11.8) | Settings → Alerts | P1 |
| FC-10 | iPhone: "Add to Home Screen" is setup step 1 on iOS. C8 in iOS Safari explains that alerts need the installed app. | A-flow, C8 | P0 |
| FC-11 | `navigator.storage.persist()` after setup; state shown in Diagnostics | A-flow, J3 | P0 |
| FC-12 | D3 status line: "Sent" → "Delivered" → "Seen" (from receipts) | D3 | P1 |
| FC-13 | `not_allowed` / `unknown_target` ends D3 on E3 with "{label}'s phone isn't accepting checks from you. Add them again in person." | D3, E3 | P0 |
| FC-14 | F1 time left from `ttlMs` (8.7), never from `expiresAt` | F1 | P0 |
| FC-15 | F1 cancelled state: "{asker} stopped waiting" (from `verify.cancel`) | F1 | P0 |
| FC-16 | Late answers: the E3 line for a late YES; the E2 meta line for a late NOT ME (10.7) | E2, E3 | P0 |
| FC-17 | D1 reachability hint for `offline` members (12) | D1 | P1 |
| FC-18 | Settings → Privacy: Reset my code; Who can reach me; Delete my data; the privacy notice (17) | Settings | P1 (Reset: P0) |
| FC-19 | C7 "Remove" also sends `contact.revoke`; adding in person sends `contact.unrevoke` | C7, C5 | P0 |
| FC-20 | Diagnostics: relay environment, gateway, round trip, clock offset, push state, storage state, E2E state, build hash, Lab opt-in with banner. **Hide "Reset used request numbers" in production.** | J3 | P0 |
| FC-21 | Security Lab page speaks the relay Lab protocol (14.2); forged answers built in WebCrypto (14.3) | J1 | P0 |
| FC-22 | Call Guard: "+ Add a phone" by card; prompts sent through the relay (13.2); consent line | J2 | P0 |
| FC-23 | "Update Pehchaan" handling for close code 4426 and new service-worker versions | global | P0 |
| FC-24 | A6: when passkeys are unsupported, continue as checks-only with the new copy (10.3) | A6 | P0 |
| FC-25 | Headers, build-time meta CSP, self-hosted fonts (16.5); Sentry scrubbing (16.7) | build | P0 |
| FC-26 | Hindi and English strings for every new state above | `i18n` | P0 |
| FC-27 | Request sanity checks: F1 drops any request whose `toDeviceId` isn't this device, or whose `fromDeviceId` isn't the envelope's sender | F1 | P0 |
| FC-28 | **Decision change from Part E:** the Security Lab also runs against the *production* relay, but only during the judging window, behind the runtime switch, the Lab password and opt-in on both phones (14.1). Part E's "never in production" becomes "never outside the judging window". | J1, docs | P0 |

### 22.2 Type changes (`services/types.ts`)

```ts
export type ReceiptState = 'accepted' | 'pushed' | 'delivered' | 'seen' | 'queued' | 'failed' | 'rejected';

export interface WireAnswer {                // replaces SignedAnswer on the wire and in the verifier
  requestId: string; nonce: string; decision: Decision; keyType: 'pk' | 'pin';
  credId: string; authenticatorData: string; clientDataJSON: string; signature: string; answeredAt: number;
}  // userPresent / userVerified are no longer fields: the verifier reads them from the flags

export interface CheckResult { n: 1|2|3|4|5|6|7; key: string; passed: boolean; skipped?: boolean; detail?: string }

export interface VerdictResult {             // additions only
  noResponseReason?: 'timeout' | 'offline' | 'relay_unreachable' | 'late' | 'not_allowed';
  late?: boolean;                            // DENIED that arrived after the timer
  /* …existing fields unchanged… */
}

export interface FamilyCard {                // v2
  v: 2; deviceId: string; name: string; phone?: string; color: AvatarColor; canBeVerified: boolean;
  devicePub: string; encPub: string; grant: string;
  keyType?: 'pk' | 'pin'; keyId?: string; publicKey?: string;       // passkey credential ID and public key
  safetyWords: [string, string, string, string];                    // derived locally, never from the link
}

export interface FamilyAlert {               // wire changes: victimLabel → victimName; aboutDeviceId added
  id: string; type: 'impersonation' | 'check_on'; aboutDeviceId?: string; aboutLabel: string;
  victimName: string; victimPhone?: string; amountInr?: number; createdAt: number; read: boolean;
}

export interface IncomingAnswer {            // what onAnswer now delivers (the verifier needs all of it)
  ans?: WireAnswer;                          // absent when the seal couldn't be opened (9.4)
  sealOk: boolean; envFrom: string; re: string; receivedAt: number; late?: boolean;
}

export interface VerifierService {           // changed signature
  verify(i: { req: VerifyRequest; incoming: IncomingAnswer; member: FamilyMember }): Promise<VerdictResult>;
  // `member` is always the card for req.toDeviceId (10.5)
}

export interface RelayService {              // changed: onAnswer(cb: (a: IncomingAnswer) => void). Additions:
  onReceipt(cb: (r: { of: string; re?: string; to?: string; state: ReceiptState; reason?: string }) => void): Unsubscribe;
  onCancel(cb: (c: { requestId: string; reason: 'asker_cancelled' | 'answered_elsewhere' | 'expired' }) => void): Unsubscribe;
  cancelRequest(requestId: string): Promise<void>;
  markSeen(requestId: string): void;
  queryPresence(deviceIds: string[]): Promise<Record<string, 'online' | 'push' | 'offline'>>;
  pushSubscribe(sub: { endpoint: string; p256dh: string; auth: string; vapidKeyId: string }): void;
  contacts(): Promise<Array<{ deviceId: string; since: number; via: 'grant' | 'unrevoked' }>>;
  revokeContact(deviceId: string): Promise<void>;
  unrevokeContact(deviceId: string): Promise<void>;
  rotateGrant(): Promise<string>;            // returns the new grant for the new card
  retire(): Promise<void>;
  clockOffsetMs(): number;
  sendTestAlert(): Promise<void>;             // push.test (11.8)
}
```

`SimRelay`, `SimKey` and `SimVerifier` get the same additions (simulated), so the simulation still exercises every screen state.

---

## 23. Failure modes (what happens when things go wrong)

| Situation | What the person sees | What the system does |
|---|---|---|
| Arjun's phone is off or has no data | Maa: "Not confirmed yet" after 60 s, with "Ask family" and "Call {label}" | The request waits in the inbox; the push expires with its 60 s TTL |
| Arjun's app is closed | Arjun gets a notification | Web Push (11) |
| A battery saver delays the push | The notification arrives late; Maa may see "Not confirmed yet" | High urgency; brand guidance (11.8); the test alert |
| iPhone app not installed, or alerts refused | Arjun gets nothing unless the app is open | Setup enforces install (FC-10); D1 shows the reachability hint (FC-17) |
| Maa is offline | D1 banner; the check ends "Not confirmed yet · Couldn't reach the network" | No `accepted` receipt → `relay_unreachable` |
| Maa's network flickers while waiting | Nothing (under 5 s) or "Reconnecting…" | Reconnect, then the inbox drain delivers the answer |
| Maa's app is in the background when the answer comes | Notification "Arjun answered" | Inbox + push to Maa |
| A relay container crashes, or a deploy happens mid-check | "Reconnecting…" for a moment | Drain or crash → reconnect to the other container → the inbox and request record survive |
| The whole VM goes down (hardware fault, maintenance, Oracle reclaims it) | New checks end "Not confirmed yet · Couldn't reach the network" | The uptime monitor alerts. After a reboot, every container starts again by itself (`restart: unless-stopped`). If the VM is gone, switch to the standby (24.3). |
| Redis unavailable | New checks: "Not confirmed yet · Couldn't reach the network" | The relay fails closed (`unavailable`); alarms fire |
| Redis restarted (data lost) | In-flight checks end "Not confirmed yet" | Routes self-heal; everything else continues |
| Postgres unavailable | Existing family works (warm caches); a brand-new contact fails once, then works | Fail closed on cache misses; alarms fire |
| Push service outage | Delays for closed apps | Receipts show `failed`; open apps unaffected |
| Push subscription expired | Arjun is alerted only once he opens the app | 410 → deleted → re-subscribed at the next login |
| A phone's clock is wrong | Nothing | `ttlMs`; own-clock rules (8.7) |
| Duplicate delivery | Nothing | Dedupe by message ID and request ID |
| Arjun double-taps, or answers on two devices | The first answer counts; the other device sees "Already answered" | First-answer-wins Lua (8.6) |
| Maa cancels | Arjun: "Maa stopped waiting" | `verify.cancel` (it also replaces an undelivered push) |
| Arjun answers after 60 s | Late policy (10.7) | 30 s relay grace, then `expired` |
| Arjun cancels the fingerprint prompt | F5: "Not confirmed. Tap to try again." | Nothing is sent |
| The passkey was deleted from the password manager | F5, then "Your key is missing. Set up again." | Re-enrol → new card → family re-adds |
| Browser storage cleared | The app starts fresh; the family must re-add | `persist()` makes this rare (5.4) |
| Phone lost | Family removes and re-adds; the finder can't answer without the screen lock | User verification required (check 5) |
| A family link leaks | Possible spam requests to Arjun | Rate limits; "Remove"; "Reset my code" |
| Scammer sends his own "new phone" link | Red warning; nothing added | New-phone guard (6.5) |
| Relay compromised | At worst "Not confirmed yet" or "Fake answer"; **never a false green** | The design (1.1) |
| Vercel down | The installed app still opens from its cache and works; new installs wait | Service-worker cache |
| App version too old | "Update Pehchaan" | Close code 4426 → service-worker update |
| Lab left on after the event | Only opted-in test phones are affected, and they show the banner | Runbook 24.6: `admin lab off` at once; `cfg:lab` also expires after 12 h and opt-ins after 4 h |

---

## 24. Runbooks

### 24.1 Normal deploy

1. Merge to `main` → CI → staging deploy → smoke tests → approve production → the canary passes.
2. Watch the Overview dashboard for 15 minutes: error rate, connections, delivery funnel.
3. If anything looks worse than before, roll back (24.2) first and investigate afterwards.

### 24.2 Rollback

- **Relay:** `ssh deploy@<vm-ip> /opt/pehchaan/deploy.sh <previous tag>`. The tags, newest last, are in `/opt/pehchaan/deploy.log`.
- **App:** Vercel → the previous deployment → Promote to Production.
- Migrations are expand-only, so a relay rollback never needs a database rollback.

### 24.3 Relay down or high error rate

1. Check the uptime monitor, then on the VM: `docker compose ps`, `docker compose logs --tail 200 relay-a relay-b caddy`. Check VM CPU, memory and disk in Grafana, and Oracle Cloud's status page.
2. One container unhealthy: `docker compose restart relay-a`. The VM unresponsive: reboot it from the Oracle console.
3. **VM or region gone: turn the staging VM into production** (target 30 minutes, practised before judging). Staging is sacrificed for the duration; both stacks can't share one project name, ports or volumes.
   - On the staging VM: `cd /opt/pehchaan && docker compose down`, then `mv .env .env.staging`, and copy the production `.env` into place.
   - `docker volume rm pehchaan_pgdata` (staging's test data), then `docker compose up -d --wait postgres valkey`.
   - Restore the latest production dump: download it, decrypt it with the offline `age` key, and run `pg_restore` into the new database.
   - Run `./deploy.sh <current production tag>`.
   - Point the `relay` DNS A record at this VM's IP (60 s TTL).
   - If Oracle itself is unusable, do the same on an Azure for Students VM set up with `cloud-init.yaml`.
   - **Afterwards:** rebuild a fresh staging VM, and restore staging's `.env.staging`.
4. If a dependency is failing (Valkey, Postgres): see 24.4.
5. Post a status note (a pinned message in the team chat now; a public status page later).

### 24.4 Redis or Postgres outage

- **Redis:**
  - `docker compose logs valkey`, then `docker compose restart valkey`.
  - The relay fails closed; nothing unsafe happens.
  - Routes rebuild themselves as the relays reconnect (15.4). In-flight checks end "Not confirmed yet".
- **Postgres:**
  - Warm caches keep existing families working for up to 10 minutes.
  - `docker compose restart postgres`. If the data is damaged, restore the latest dump into a fresh volume (`pg_restore`), then restart the relays.
  - Verify the `contact_bindings` revoked rows afterwards.

### 24.5 Suspected security incident

1. **Contain:** rotate the affected secrets (16.4), block suspicious devices, run `admin lab off`.
2. **Assess:** use `audit_events`, the logs and the provider access logs. What could have been exposed? Pseudonymous IDs, bindings and push endpoints. Names, numbers and contents are not on the servers.
3. **Notify:** if personal data was affected, inform the Data Protection Board and the affected users on the timeline the DPDP Rules require (17.2). Draft the notice in English and Hindi.
4. **Fix, write a blameless post-mortem in `docs/incidents/`, and add a test that would have caught it.**

### 24.6 Judging day (finals, 31 Oct – 1 Nov)

**T − 7 days**
- Feature freeze. Deploy the final version, then raise `MIN_CLIENT_VERSION` so every phone runs it.
- Run the full real-phone matrix (21.6).
- Run **50 or more Lab attacks** on the real phones and export the log (target: 0 false greens).
- Confirm last night's backup exists and that a restore works on the staging VM. Check the VM's disk space and that no Oracle budget alert has fired.
- Set a fresh Lab password for the event, and deploy the event build with `LAB_ENABLED=true` (the Lab stays off until switched on).
- **From T − 48 h: deploy freeze** (rollbacks only).

**T − 1 day**
- Both phones:
  - installed from `app.yourdomain.in`;
  - alerts on; storage protected;
  - Chrome battery set to **Unrestricted**;
  - Lab opt-in on.
- Put the two phones on two different carriers (for example Jio and Airtel), using mobile data.
- Run "Send test alert" with both screens locked; it should arrive within 5 s.
- `admin lab on`. Laptop: Security Lab and Call Guard open and logged in; dashboards open. The canary is green.
- Keep the backup screen recording and chargers ready (run sheet).

**T − 2 hours**
- Check `/healthz` and `docker compose ps` (both relay containers healthy). VM CPU should be below 30%.
- Check Oracle Cloud's status page for Mumbai.
- Run 3 genuine checks (YES, NOT ME, no answer) and one of each attack.
- Confirm nobody has deployed since the freeze began.

**During judging**
- One teammate watches the dashboard.
- If the relay fails, switch to the backup recording (run sheet) and say plainly what happened. Do not live-debug in front of judges.

**After judging**
- `admin lab off` immediately; opt the phones out; rotate the Lab password. After the freeze, deploy with `LAB_ENABLED=false`.
- Export the Lab log and `lab_attacks`.
- Check the standby VM is still ready (the latest dump restored cleanly this week).

### 24.7 Deletion request by email

- Ask the person to use Settings → Delete my data, which is instant and self-service.
- If they can't (a lost phone), ask for the device ID shown in the app's Diagnostics on any remaining device, or explain that the relay holds no names or numbers to search by. Run `admin retire <deviceId>` when it is identified.

### 24.8 Abusive device

`admin block <deviceId> --reason "<why>"`. Record it in `audit_events`. Review blocks weekly.

---

## 25. Build order

### 25.1 First, confirm the rules

The FAQ says projects are built **from scratch**. **Ask the GDG CRCE organisers in writing** what may be prepared before the 24 hours: designs and documents only, or code as well, and whether AI-assisted builders count.
- If code must be written at the venue, treat everything below as practice, and bring only the design (this document and the frontend pack) to the event. Use the 24-hour cut (25.3).
- If pre-built code is allowed, follow the 5-week plan.

### 25.2 Five-week plan (today → finals on 31 October)

| Week | Dates | Deliverables | Done when |
|---|---|---|---|
| 1 | 28 Sep – 4 Oct | **Oracle Cloud sign-up on day 1** (card checks and Arm capacity can take days); two Arm VMs with `cloud-init.yaml`; monorepo; `packages/protocol`; relay skeleton (Fastify + `ws`, login handshake, local and Redis routing, inbox, receipts, request records); `RealRelay` client; domains and DNS | Two browser tabs exchange messages through the relay running on the laptop (staging goes live in Phase 10, week 4) |
| 2 | 5 – 11 Oct | `packages/crypto` (canonical, vectors, DER, verifier); `RealKey` on real phones; card v2 + safety words + new-phone guard; grants and bindings; Playwright with the virtual authenticator | A real check between two real phones through the dev tunnel (18.12) shows correct verdicts, including tamper tests in unit tests |
| 3 | 12 – 18 Oct | Web Push end to end (service worker, A8, iOS install flow, test alert); presence; alerts; Call Guard pairing; the relay Lab module + J1 wiring; rate limits | A check reaches a phone whose app is closed and locked; all three Lab attacks work |
| 4 | 19 – 25 Oct | E2E encryption; security headers; metrics, Sentry, uptime, canary; the 20k-socket load test; the real-phone matrix; production deploy | Production passes the frontend Part D walkthrough on real phones |
| 5 | 26 – 30 Oct | Freeze; 50+ Lab attacks logged; run-sheet rehearsals (at least 5 full runs); runbooks; backup restore test | Judging-day checklist (24.6) complete |

**How the weeks map to Part D:**

| Week | Phases |
|---|---|
| 1 | 0, 1, 2, 3 |
| 2 | 4, 5 |
| 3 | 6, 7 |
| 4 | 8, 9, 10 |
| 5 | 11, the E4 real-phone script, rehearsals |

Keep the Oracle sign-up (A5) on day 1 whatever happens.

### 25.3 The 24-hour cut (if code must be written at the event)

Build only P0, in this order, with each owner working in parallel (section 26):

1. Protocol and schemas (1 h).
2. Relay: login, routing, inbox, request records, bindings via grants, Web Push (8–10 h).
3. App: `RealRelay` (4 h), `RealKey` + `RealVerifier` (5 h), card v2 + safety words (2 h), push service worker (3 h).
4. The relay Lab module + J1 wiring (3 h).
5. Deploy to the Oracle VM and Vercel, using accounts, VMs and domains set up before the event (1 h).
6. Rehearse (2 h).

Skip: E2E (say "next: end-to-end encryption, the protocol already carries it"), presence hints, the contacts screen, dashboards, load tests. **Never skip:** the 7 checks, user verification, the nonce store, first-answer-wins, and the Origin and rate limits.

### 25.4 Definition of done (backend)

- [ ] Every item in section 22 marked P0 is shipped; the frontend's Part D passes on real phones on production.
- [ ] The verifier test table (10.5) passes in CI, and the canonical vectors (10.2) reproduce.
- [ ] 50+ Lab attacks on real phones: 0 false greens, log exported.
- [ ] A check reaches a closed, locked app on Android and on an installed iPhone app.
- [ ] A relay deploy, a `docker kill` of one relay container and a VM reboot during a check all end correctly; the standby switch has been practised.
- [ ] There are no secrets in the repo, and 2FA is on for GitHub, Vercel, Oracle Cloud, Cloudflare and the registrar.
- [ ] Dashboards and alerts are live; the canary is green; the backup restore has been tested.
- [ ] Every teammate can explain section 1.1 and walk through `verifier.ts` line by line.

---

## 26. Ownership split (four people)

Claude Code writes the code (Part D), but each owner below reviews every change in their area, runs its gate, and must be able to explain it without notes.

| Owner | Builds | Explains to judges |
|---|---|---|
| **A: Relay** | Gateway, handshake, routing, inbox, request records, rate limits, the VM, deploys and draining | "The relay is untrusted by design. Here's what it can and can't do." (1.1) |
| **B: Crypto and verifier** | Passkeys, canonical format, the 7 checks, E2E, safety words, confirmation words | "Why nobody can fake Arjun's answer", walking through checks 1–7 |
| **C: App integration** | `RealRelay`, the push service worker, iOS and Android behaviour, the new screen states (section 22) | "What happens when Arjun's phone is locked, offline or on a battery saver" |
| **D: Lab, Guard and quality** | The relay Lab module and J1, Call Guard pairing, Playwright, load tests, the phone matrix, dashboards, judging-day operations | Runs the Security Lab live and shows the 0-false-greens log |

**Everyone** can answer these without notes:

| Judge asks | Short answer |
|---|---|
| "What if your server is hacked?" | It can delay or break messages, which shows "Not confirmed yet" or "Fake answer". It can never make a fake "Confirmed", because only Arjun's passkey can sign, and Maa's phone checks it. |
| "Why not just OTP or a code word?" | Codes can be phished or overheard on the call. A passkey signature can't be read out, is bound to one exact request, and needs Arjun's fingerprint. |
| "What if the scammer steals Arjun's phone?" | Every answer needs Arjun's own fingerprint or PIN (check 5). |
| "What if the scammer sends his own Pehchaan link as 'Arjun's new phone'?" | The app refuses cards that look like an existing family member (6.5). Changing phones is done face to face. |
| "Does it scale?" | Stateless relays, Redis routing and push. Adding machines is configuration only; section 20 has the numbers. |
| "What data do you keep?" | No names, numbers, amounts or messages on servers, only pseudonymous device IDs, and the privacy design follows the DPDP Act (17). |

---

## 27. Version 2 roadmap

| Item | What | Why it's safe to add later |
|---|---|---|
| Several phones per person | The card lists devices; requests fan out; first answer wins | Multi-target request records, `verify.cancel` and first-answer-wins already exist; `send` gains a per-recipient seal map (8.11) |
| Remote phone change and revocation | Arjun's synced passkey signs `{purpose: "rotate", oldDeviceId, newCard}`. Family phones verify it with the saved passkey key and update automatically. | Signed formats are versioned; the relay just forwards |
| Native wrappers | Android (TWA or Capacitor) with a full-screen, call-style incoming request, FCM direct, and optional `CallScreeningService` prompts; iOS app with APNs | `push-worker` gains senders; the protocol doesn't change |
| Verify an official (D4) | Banks and police publish organisation keys in a public, append-only registry; staff devices sign answers | A new card type and a registry; the verifier reuses the same checks |
| "Verify with Pehchaan" SDK | Payment and bank apps ask for a check before a large transfer that follows a call (D5) | The same protocol |
| Devanagari safety words, regional languages | Wordlists per script | Word derivation is versioned (`-v2` salt) |
| Encrypted family-list backup | Backup key from the passkey PRF extension | Phone-side only |
| Forward secrecy | Signed rotating pre-keys for E2E | The `alg` field versions the seal |
| Key transparency | A public log of card fingerprints, to detect key substitution at scale | Additive |
| Shared family state | G2 "I've reached them" visible to everyone | A new alert type |
| Multi-region active-active | Regions per state; a global directory | Hash-tagged keys and the `bus` interface |

---

## Appendix A: One complete check on the wire

These are the frames for one real check, with E2E fields shortened.

```jsonc
// 1. Relay → Maa (after connecting)
{"v":1,"t":"hello","id":"01JB…A1","sts":1761900000000,
 "body":{"serverNonce":"Qk2…","serverTime":1761900000000,"gatewayId":"e784…","minClient":"1.0.0","vapidKeyId":"v1","env":"production","e2eRequired":true}}

// 2. Maa → relay
{"v":1,"t":"auth","id":"01JB…A2","ts":1761899998000,
 "body":{"deviceId":"Mx9Qe2Lr7Tb4Nw1Kc6Vh0S","devicePub":"BHk…","sig":"3fQ…","client":{"ver":"1.0.0+9c1e2ab","platform":"android-chrome"}}}

// 3. Relay → Maa
{"v":1,"t":"auth.ok","id":"01JB…A3","sts":1761900000050,"body":{"serverTime":1761900000050,"pushStatus":"ok","lab":{"optedIn":false}}}

// 4. Maa → relay: the request (sealed to Arjun's encryption key; grant included)
{"v":1,"t":"send","id":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","ts":1761899999100,
 "body":{"kind":"verify.request","to":"Ar3Jn8Pk2Wq5Ez7Uy1Gd4F","re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","grant":"Zk3…","ttlMs":60000,
         "e2e":{"alg":"p256-hkdf-a256gcm","epk":"BEm…","iv":"yR…","ct":"8Hq…","sig":"Wm…"}}}

// 5. Relay → Maa
{"v":1,"t":"receipt","id":"01JB…A5","sts":1761900001140,"body":{"of":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","state":"accepted"}}
{"v":1,"t":"receipt","id":"01JB…A6","sts":1761900001420,"body":{"of":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","to":"Ar3Jn8Pk2Wq5Ez7Uy1Gd4F","state":"pushed"}}

// 6. Relay → Arjun (inside the Web Push payload, and again on the WebSocket after he opens the app)
{"v":1,"t":"deliver","id":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","sts":1761900001150,
 "body":{"from":"Mx9Qe2Lr7Tb4Nw1Kc6Vh0S","kind":"verify.request","re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","ttlMs":59000,"e2e":{…}}}

// 7. Arjun → relay
{"v":1,"t":"ack","id":"01JB…B1","ts":…,"body":{"of":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F"}}
{"v":1,"t":"seen","id":"01JB…B2","ts":…,"body":{"re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F"}}

// 8. Arjun → relay: the signed answer (sealed to Maa's encryption key, which came inside the request)
{"v":1,"t":"send","id":"01JB…B3","ts":…,
 "body":{"kind":"verify.answer","to":"Mx9Qe2Lr7Tb4Nw1Kc6Vh0S","re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","ttlMs":0,"e2e":{…}}}
// Opened, the answer payload is:
// {"spk":"BK…","ans":{"requestId":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","nonce":"q3v0…","decision":"NOT_ME","keyType":"pk",
//   "credId":"AbC…","authenticatorData":"zL2K…BQAAAAA","clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0Ii…",
//   "signature":"MEUCIQ…","answeredAt":1761900009800}}

// 9. Relay → Maa
{"v":1,"t":"deliver","id":"01JB…B3","sts":…,"body":{"from":"Ar3Jn8Pk2Wq5Ez7Uy1Gd4F","kind":"verify.answer","re":"01JB7Y8Q3Z6N4V5W2K9C0D1E2F","ttlMs":50200,"e2e":{…}}}
// Maa opens it, runs the 7 checks: all pass, the decision is NOT_ME → DENIED. She acks; the family alerts go out.
```

For answers, `ttlMs` on `send` is ignored. The relay applies the request record's deadline and grace instead.

---

*End of Part C. Parts D and E follow.*

---

# PART D: BUILD PHASES FOR CLAUDE CODE (paste one at a time)

**Every phase follows the same pattern:**
- **Read:** the exact spec sections.
- **Build:** what to create.
- **Test alongside:** the Part E test IDs to write *while* building, never afterwards.
- **Gate:** commands that must be green before the phase ends.
- **Report:** B2.

Start each phase in a fresh session, in plan mode. Never begin a phase while the previous gate is red.

### Phase 0 · Read, map and plan (no code)

```text
Phase 0 of docs/BACKEND_SPEC.md. Do not write application code in this phase.

Read, in full: CLAUDE.md; docs/BACKEND_SPEC.md Parts B, C (sections 0–27 and Appendix A), D and E;
docs/FRONTEND_SPEC.md sections B3, B4, B11–B13 and Part E; then the existing code in apps/web
(services/types.ts, services/index.ts, services/sim/*, services/real/*, the flags file, the store, the
service worker, the i18n files and every screen named in spec section 22.1).

Produce:
1. docs/BUILD_PLAN.md
   - For every phase 1–11, the concrete files you will create or change.
   - A mapping table from the frontend spec's names to the actual names in apps/web
     (types, services, routes, screen components).
   - Every place in apps/web that section 22.1 (FC-1 … FC-28) touches.
2. docs/TEST_MATRIX.md
   - One row for every test ID in Part E, plus one row for every "must", "never", limit, error code,
     TTL and table row in Part C that Part E doesn't already name.
   - Columns: ID | spec § | rule (one line) | test file › test name (planned) | type | phase | status.
3. docs/DECISIONS.md (empty template) and docs/OPEN_QUESTIONS.md, listing anything unclear or
   contradictory, with the exact quotes.

Gate: the three files exist. TEST_MATRIX.md has a row for every Part E ID (list any you couldn't map).
Report (B2), then stop and wait for answers to OPEN_QUESTIONS.md.
```

### Phase 1 · Monorepo, tooling and the test harness

```text
Phase 1 of docs/BACKEND_SPEC.md. Read: Part B, sections 3, 4, 18.12, 21, Part E (E1).

Build:
- pnpm workspaces + Turborepo with the section 4 layout.
  - apps/web moved in, unchanged in behaviour. Its own tests (if any) still pass.
  - Empty but compiling apps/relay, apps/loadgen, apps/canary, packages/protocol, packages/crypto.
- TypeScript strict everywhere (tsconfig.base.json), ESLint, Prettier.
- dependency-cruiser rules enforcing the section 4 boundaries.
- Vitest workspace:
  - unit and integration projects;
  - coverage thresholds from B1;
  - a `test:watch` script;
  - fast-check installed.
- Playwright configured with 3 browser contexts and a helper that adds a CDP virtual WebAuthn
  authenticator to a context (section 21.3).
- infra/compose/docker-compose.dev.yml (Valkey 8 + Postgres 16), plus test helpers that give each
  integration test file its own KEY_PREFIX (Valkey keys AND pub/sub channels) and its own Postgres schema,
  so suites can run in parallel without seeing each other.
- Check that .claude/settings.json and scripts/claude/*.mjs from B3 exist (create them exactly as in B3 if
  not), and prove the hooks now fire: a deliberately failing test is reported after an edit.
- .github/workflows/ci.yml as in section 18.8, without the `E2E_REQUIRED=true` step (Phase 8 adds it),
  plus gitleaks (secret scanning) and actionlint.

Test alongside:
- A deliberate forbidden import (apps/relay → packages/crypto/verifier) in a fixture makes depcruise fail.
- A sample Playwright test registers a passkey in the virtual authenticator and signs a challenge.
- The integration helpers start from a clean state.

Gate:
- pnpm install --frozen-lockfile
- pnpm turbo run lint typecheck test build
- pnpm test:integration
- pnpm test:e2e
- pnpm depcruise

All green; 0 skipped. Report (B2).
```

### Phase 2 · Protocol and crypto packages (the security core)

```text
Phase 2 of docs/BACKEND_SPEC.md. Read: sections 5, 6, 7, 9, 10 in full (including the reference code),
and Part E groups CRY and PRO.

Build in packages/crypto (WebCrypto only, zero dependencies): bytes.ts, canonical.ts (canonical,
canonicalRequest, challengeFor), device-auth.ts, e2e.ts (seal/open), plain-sig.ts (psig, 9.5),
verifier.ts (10.5–10.7 exactly), der.ts, authdata.ts, safety-words.ts (6.3, BIP-39 English list
vendored with its checksum), confirm-words.ts (10.8), card.ts (6.1 encode/decode/validate and the
6.5 new-phone guard as a pure function).

Build in packages/protocol: a zod schema for every message and payload in 7.4, 14.2 and Appendix A;
error codes (7.5); close codes; the limits from 16.2 as constants; inferred TypeScript types.

Test alongside (write these first; red, then green):
- CRY-01 … CRY-14 and PRO-01 … PRO-03.
- The 10.2 vectors must reproduce byte for byte.
- The mutation property test CRY-09: 10,000 random single-field or single-byte mutations of a valid
  answer; the verifier must never return VERIFIED for a mutated answer.
- Use a subagent to write the CRY-07 verifier table tests from section 10.5 alone, without reading
  verifier.ts. The implementation must pass them unchanged.

Gate:
- pnpm --filter @pehchaan/crypto --filter @pehchaan/protocol test --coverage
  → 100% lines and branches
- pnpm turbo run lint typecheck test

Report (B2). Include verifier.ts's line count and a one-paragraph plain-English walkthrough of it for the team.
```

### Phase 3 · Relay core: connections, login, routing, inbox, requests

```text
Phase 3 of docs/BACKEND_SPEC.md. Read: sections 2, 6.4, 7, 8, 15.1, 15.2, 16.1–16.3, 18.6, 18.7, 18.9, 23,
and Part E groups REL and CON-01 … CON-03.

Build in apps/relay:
- config.ts: zod-validated environment (18.7), exits on invalid config.
- HTTP routes (/healthz, /readyz, /v1/time, /metrics on the metrics port).
- ws/upgrade.ts: Origin, subprotocol, per-IP limit, TRUST_PROXY, MAX_SOCKETS.
- ws/session.ts: the hello/auth state machine, heartbeats, 3 sockets per device.
- core/router.ts and core/bus.ts (pub/sub; SPUBLISH-ready interface).
- core/inbox.ts, core/requests.ts, core/receipts.ts, core/dedupe.ts, core/authz.ts (one function per
  16.3 row), core/ratelimit.ts.
- The Lua scripts (inbox put, answer check, GCRA, request create), each in its own .lua file.
- Graceful drain (18.9).
- The Postgres schema and Drizzle migrations exactly as in 15.2, plus grants and bindings (6.4) and
  their authorisation, because request authorisation needs them from the start.

The relay must never import packages/crypto/verifier or e2e (depcruise enforces this).

Test alongside:
- REL-01 … REL-24 against real Valkey and Postgres, EXCEPT the parts that need later phases:
  REL-07's `pushed`/`failed` states and REL-12 (Phase 6), REL-18 (Phase 8), REL-23 (Phase 9), and the
  error codes and authorisation rows of features not built yet (Lab rows: Phase 7). Mark every deferred
  row in TEST_MATRIX.md with its phase; the later phase must close it.
- CON-01 … CON-03 (grants, first contact, revocation).
- Start TWO relay processes in the tests for cross-gateway routing.
- Race tests: 50 concurrent answers to one request → exactly one ok.
- Drain under traffic loses zero envelopes.
- Every error code in 7.5 is produced by at least one test.
- A log-capture test (REL-22) fails if any forbidden value (16.7) appears in logs during a full flow.

Gate:
- docker compose -f infra/compose/docker-compose.dev.yml up -d
- pnpm --filter @pehchaan/relay test:integration → green, coverage ≥ B1 thresholds (for the code built so far)
- pnpm turbo run lint typecheck test

Report (B2).
```

### Phase 4 · Contacts, data, presence, admin

```text
Phase 4 of docs/BACKEND_SPEC.md. Read: sections 6.4, 6.6, 11.3, 12, 15, 16.8, 17, and Part E group CON.

Build:
- (The schema, grants and bindings already exist from Phase 3.) contact.list; device.retire (tombstone + the exact deletions in 6.6); presence.query (12); push subscription
  storage (with the host allowlist from 11.3).
- The caches with invalidation (15.5), fail-closed on cold-cache database errors.
- The retention job (15.3); audit events with HMAC subjects.
- The admin CLI (16.8: block, unblock, retire, stats, lab on/off) with the admin:events kick.
- A CI check that rejects destructive migrations unless marked as a contract step.

Test alongside: CON-04 … CON-13, and the Phase 3 rows now unblocked. In particular:
- a revoked sender that retires and comes back can never re-bind;
- a new identity holding an old, rotated grant is refused;
- self-healing after wiping Valkey and after wiping allowed bindings;
- time-travel tests for the retention job.

Gate:
- pnpm test:integration → green
- pnpm turbo run lint typecheck test
- pnpm depcruise

Report (B2).
```

### Phase 5 · Connect the frontend

```text
Phase 5 of docs/BACKEND_SPEC.md. Read: sections 5, 6, 8.4–8.10, 10, 12, 22 (all of it), and
docs/FRONTEND_SPEC.md B3, B4, B11–B13, E, F and Part D. Part E: APP-01 … APP-11, APP-14, and the journeys listed below.

Build in apps/web (follow the code's own names; record the mapping in DECISIONS.md):
- FC-1 flags; FC-2 device identity + storage.persist; FC-3 card v2 + PBKDF2 safety words +
  new-phone guard; FC-4 RealKey with challenges precomputed when F1 opens; FC-5 RealVerifier
  (calls packages/crypto; member looked up by req.toDeviceId; the used-nonce timing from 10.5).
- FC-6 RealRelay (outbox, receipts, backoff with jitter, clock offset, tombstones, dedupe).
- FC-11 … FC-20, FC-23, FC-24, FC-26, FC-27; the 22.2 type changes (and the same additions in the Sim*
  services, so simulation mode still works).
- Do not change any screen's layout or motion beyond what section 22 lists.

Test alongside:
- Unit tests for every real service.
- Playwright journeys J-01, J-02, J-05, J-07 … J-11, J-15 and J-17 with virtual authenticators and a
  real relay. J-03 and J-04 up to the verdict; their alert steps come in Phase 7. APP-06's
  unreadable-seal case comes in Phase 8.
- F1's countdown with Arjun's browser clock set 2 minutes ahead (Playwright clock API) still shows about 60 s.
- The complete frontend Part D walkthrough (APP-14) against the real backend.
- The i18n completeness test and the banned-words test (APP-11).

Gate:
- pnpm turbo run lint typecheck test
- pnpm test:integration
- pnpm test:e2e (all journeys green, 0 retries needed)
- pnpm build for apps/web

Report (B2), including a list of real-phone checks for the team to run now (E4 steps 1–8).
```

### Phase 6 · Web Push end to end

```text
Phase 6 of docs/BACKEND_SPEC.md. Read: section 11 in full, 8.3, 16.1, 22 (FC-8, FC-9, FC-10), and
Part E group PSH, plus J-06.

Build:
- The relay push sender (web-push; TTL, Urgency high, Topic only with re, the 11.3 response table,
  retries, the SSRF allowlist); the 1.5 s ack timer fallback; push.test (after 10 s, limited to
  3 per hour).
- /v1/inbox/fetch and /v1/push/resubscribe (signed, time-checked, rate-limited, CORS for the app
  origin only); wake pushes for oversized frames.
- infra/scripts/vapid-keys.ts: prints a VAPID key pair and key ID for one environment.
- apps/web: vite-plugin-pwa switched to injectManifest; sw.ts push and notificationclick handlers
  exactly as in 11.5 (vibrate never together with silent); pushInbox processing; A8 real; the iOS
  install-first flow; "Send test alert" in Diagnostics; battery guidance (11.8).

Test alongside:
- PSH-01 … PSH-08 with a local mock push service that records requests and verifies the VAPID JWT
  and the RFC 8291 encryption by decrypting the payload with the subscription's keys.
- Service-worker logic unit-tested in isolation (notification options per kind, and lock-screen text
  that never contains an amount or reason).
- J-06: the Arjun page is closed, the mock push service captures the push, the test opens the
  notification URL, and the check completes.

Gate: pnpm turbo run lint typecheck test && pnpm test:integration && pnpm test:e2e → green.
Report (B2), including E4 steps 9–12 for the team (real push on locked Android and iPhone).
```

### Phase 7 · Alerts, Call Guard and the Security Lab

```text
Phase 7 of docs/BACKEND_SPEC.md. Read: sections 13, 14, 16.3 (lab rows), 22 (FC-21, FC-22, FC-28),
and frontend J1–J3. Part E: J-12, J-13, SEC-09.

Build:
- Alerts G1/G2: one envelope per recipient; receipts drive "Family alerted".
- Call Guard: "+ Add a phone" via card, prompts through the relay, the consent line.
- The relay Lab module (loaded only when LAB_ENABLED; active only while cfg:lab is on; password with a
  shared rate limit; per-device opt-in expiring after 4 h; interception only when both ends are opted in;
  hold/release/inject with the 10 s timeout; lab.report; lab_attacks rows; audit events).
- The J1 page speaking this protocol, with forged answers built in WebCrypto (fresh key, random credId).
- infra/scripts/lab-password-hash.ts (prints an Argon2id hash of a password typed at the prompt).

Test alongside:
- J-12: 50 automated attacks (a mix of change, replay and forge, including forge with a copied credId).
  Every verdict is INVALID with the reason in the 10.5 table; the false-greens counter stays 0.
- SEC-09: Lab off → every lab.* is refused; Lab on but a phone not opted in → its traffic is never
  visible or changed.
- J-13 Call Guard scripted mode end to end.
- The alert steps of J-03 (G1 reaches Papa) and J-04 (G2), and APP-08's "Family alerted" row.

Gate: all suites green. Report (B2) with the exported Lab attack log attached (docs/lab-log-phase7.json).
```

### Phase 8 · End-to-end encryption and signed plain mode

```text
Phase 8 of docs/BACKEND_SPEC.md. Read: section 9 in full, 7.4, 16.3 (plain row), 18.3. Part E: J-16,
SEC-05, CRY-10, CRY-11.

Build:
- RealRelay seals every request, answer, alert and prompt with packages/crypto e2e (FC-7). It always
  sends e2e, except between two Lab-opted-in devices, which use plain + psig.
- Receivers: open, validate with zod, check spk against the saved card; drop failed requests, alerts
  and prompts; unreadable answers → INVALID `changed` with skipped checks (9.4).
- Refuse incoming plain unless this device's own Lab opt-in is on.
- The relay: E2E_REQUIRED enforcement and hello.e2eRequired.
- Add the `E2E_REQUIRED=true pnpm test:e2e` step to ci.yml (18.8).

Test alongside:
- J-16: every journey from Phases 5–7 passes again with E2E_REQUIRED=true.
- A relay-side frame capture proves that no label, name, phone number, amount, reason, nonce or
  signature appears in any frame.
- SEC-05: a downgrade attempt (the relay strips e2e and sends plain) is refused by the app.

Gate: all suites green, with E2E on and with E2E off. Report (B2).
```

### Phase 9 · Hardening and observability

```text
Phase 9 of docs/BACKEND_SPEC.md. Read: sections 16 and 19 in full, 17, 22 (FC-25). Part E: SEC-*,
APP-12, APP-13, REL-22, REL-23, OPS-10.

Build:
- vercel.json headers and the build-time meta CSP (16.5); self-hosted fonts; Sentry in both apps with
  the scrubber (16.7).
- Every metric in 19.1; pino logging per 19.2; Grafana dashboards as JSON (19.3).
- A `test:security` script that runs SEC-01 … SEC-12.
- The alert rules as code (19.5).
- apps/canary with two commands: `canary` (19.6, scheduled by .github/workflows/canary.yml) and `smoke`
  (the staging smoke test used by deploy-relay.yml).
- The privacy notice page texts (17), in English and Hindi.

Test alongside:
- SEC-01 … SEC-12 (fuzzing, replay, injection, bypass, oversize, slowloris, SSRF, Lab, gitleaks, audit).
- apps/canary unit tests. (OPS-10, running it against the full local stack, is in Phase 10.)
- Playwright checks that the app makes no request to any third-party host except the relay and Sentry.

Gate: all suites green; `trivy fs .` and `pnpm audit` report no critical or high issues. Report (B2).
```

### Phase 10 · Infrastructure: Docker, Compose, Caddy, CI/CD, backups

```text
Phase 10 of docs/BACKEND_SPEC.md. Read: section 18 in full, 24, 15.3. Part E group OPS.

Build:
- infra/docker/Dockerfile.relay and Dockerfile.backup (multi-arch).
- infra/vm/: compose.yml, Caddyfile, cloud-init.yaml, deploy.sh, config.alloy, env.example — exactly as in 18.4–18.10.
- The backup script (pg_dump → age → rclone, 30-day pruning, then the retention SQL).
- .github/workflows/deploy-relay.yml (build once, multi-arch, Trivy, staging, smoke tests, approval,
  production, canary).
- docs/RUNBOOKS.md from section 24, with every command checked.
- A `test:ops` script that runs OPS-01 … OPS-11.

Test alongside (locally, no cloud account needed):
- OPS-01 … OPS-11. The whole production compose stack runs on this machine with Caddy using its
  internal certificate authority for a local hostname.
- The rolling deploy.sh switches between two locally built tags while apps/loadgen keeps 1,000 sockets
  and 2 checks per second running: zero failed checks.
- Backup → restore into an empty Postgres → identical row counts, including revoked bindings.
- J-14 through Caddy: relay-a is killed while a request is pending, relay-b takes over, and the verdict is correct.
- The arm64 image boots under QEMU. shellcheck, `hadolint --failure-threshold warning`, actionlint and
  `cloud-init schema` are all clean.

Gate: all OPS tests green; all earlier suites still green. Report (B2), including the exact human steps
still needed on Oracle Cloud (A5) and the list of secrets to create.
```

### Phase 11 · Load, chaos and the final full verification

```text
Phase 11 of docs/BACKEND_SPEC.md. Read: sections 20, 21, 23, 25.4, and Part E in full.

Build:
- apps/loadgen scenarios (21.4) and the chaos scripts (21.5).
- The `test:load:short` and `test:chaos` scripts.
- scripts/check-test-matrix.mjs, which fails if any row of TEST_MATRIX.md is not ✅ or "manual".

Run, in parallel where independent:
- LOAD-01 … LOAD-03 against the local production-like stack, with each relay limited to 1 CPU by a compose
  override (the laptop is faster than the VM). The shortened soak runs locally. The final MAX_SOCKETS
  number and the full soak come from staging, once it is live.
- CHAOS-01 … CHAOS-05.
- The ENTIRE automated suite: unit, integration, e2e with E2E on and off, OPS, SEC.

Then:
- Go through every row of docs/TEST_MATRIX.md. Each row must be ✅ with a passing test, or "manual" with
  the E4 step that covers it. Fix anything missing: add the test first, then the code.
- Walk through every row of the section 23 failure table and name the test proving it.
- Check the section 25.4 definition of done.

Gate: everything green; TEST_MATRIX.md has 0 open rows. Report (B2), including the measured capacity
(sockets per container at p95 < 150 ms) and the final list of E4 real-phone steps for the team.
```

---

# PART E: THE COMPLETE TEST PLAN

"Test every working of the app" means every behaviour below has an automated test, and a real-phone check where a real device matters. Test IDs are used in `docs/TEST_MATRIX.md` and in the Part D phases.

### E1. The traceability matrix (`docs/TEST_MATRIX.md`)

| ID | Spec § | Rule | Test | Type | Phase | Status |
|---|---|---|---|---|---|---|
| CRY-07.3 | 10.5 | A changed decision fails check 3 → INVALID `changed` | `packages/crypto/test/verifier.test.ts › change NOT_ME→ME` | unit | 2 | ✅ |
| REL-10.2 | 8.6 | 50 concurrent answers → exactly one accepted | `apps/relay/test/requests.int.test.ts › first answer wins race` | integration | 3 | ✅ |
| E4-11 | 11.7 | Push arrives on a locked iPhone (installed app) | manual: E4 step 11 | manual | 6 | ⏳ |

Every ID below gets at least one row. Rules in Part C that no ID covers yet get their own new row (Phase 0).

### E2. Automated tests by area

**CRY: `packages/crypto` (unit, 100% coverage)**

| ID | What is proven |
|---|---|
| CRY-01 | Canonical JSON: sorted keys (recursively), `undefined` omitted, no whitespace, non-integers throw, Devanagari kept as raw UTF-8 |
| CRY-02 | The 10.2 test vectors reproduce exactly (canonical strings, both challenges for A and B, rpIdHash) |
| CRY-03 | Property test: changing any signed field, or the decision, changes the challenge |
| CRY-04 | `deviceIdFrom`: 22 characters, deterministic, distinct for distinct keys |
| CRY-05 | Login signature: valid; wrong relay host, nonce or device ID; key not 65 bytes or not `0x04`; ID not matching the key → all rejected |
| CRY-06 | `derToRaw`: round-trips 1,000 real signatures; rejects short, long, wrong tag, extra bytes, a 33-byte integer without a leading zero, zero length |
| CRY-07 | Every row of the 10.5 table, plus: `crossOrigin: true`; wrong `type`; wrong rpIdHash; UP missing; YES at exactly `expiresAt` (passes) and 1 ms later (late); malformed `clientDataJSON`; authenticatorData under 37 bytes; invalid base64url; unknown decision value |
| CRY-08 | Property test: for any set of failed checks, the reason is the highest in the priority order |
| CRY-09 | Property test: 10,000 random mutations of a valid answer; never VERIFIED unless the mutation changes nothing |
| CRY-10 | E2E: round trip; changing each header field (`kind`, `id`, `from`, `to`, `re`), `ct`, `iv`, `epk`, `sig` or `alg` → `tampered`; spoofed sender; saved-key mismatch; relay re-seal forgery; wrong recipient key |
| CRY-11 | `psig`: valid; payload changed; header changed → rejected |
| CRY-12 | Safety words: deterministic; four BIP-39 words; any key change → different words; PBKDF2 at 600,000 iterations; words are never read from the card |
| CRY-13 | Confirmation words: identical on both sides; rewriting the signature to `(r, n−s)` doesn't change them |
| CRY-14 | Card v2: encode/decode; each validation failure in 6.1; the new-phone guard, every row of the 6.5 table |

**PRO: `packages/protocol`**

| ID | What is proven |
|---|---|
| PRO-01 | Each message and payload type: a valid sample passes; unknown fields, oversized strings and bad ID formats are rejected |
| PRO-02 | Fuzz: random JSON never crashes the parser; it is always rejected or accepted cleanly |
| PRO-03 | The relay and the app import the same schema module (no copies) |

**REL: the relay (integration with real Valkey and Postgres; two relay processes)**

| ID | What is proven |
|---|---|
| REL-01 | Upgrade and frames: bad Origin → 403; wrong subprotocol → 426; binary frame → 1003; a 16–64 KiB frame → `too_large`; over 64 KiB → 1009; three bad frames in a minute → 4400; connection rate limit → 4429; a reader with over 1 MiB waiting → 1008; no compression negotiated; at `MAX_SOCKETS`, `/readyz` → 503 and new upgrades → 503 |
| REL-02 | Login: hello fields; valid → `auth.ok`; bad signature → 4401; reused server nonce fails; 10 s timeout → 4408; retired or blocked → 4403; old client → 4426; message before login → `unauthenticated` |
| REL-03 | Heartbeats: the relay pings every 25 s; two missed pongs → terminated; app `ping` → `pong` |
| REL-04 | Up to 3 sockets per device; the 4th closes the oldest (4409); deliveries reach all; the first `ack` counts |
| REL-05 | Routing: on the same gateway; across gateways by pub/sub; a dead gateway's routes cleaned lazily; routes rebuilt after a Valkey restart |
| REL-06 | Inbox: offline → `queued`; login → drained soonest-expiry first; `ack` removes; expired frames dropped; 50-entry cap; `ttlMs` rewritten on every delivery |
| REL-07 | Each receipt state (`accepted`, `pushed`, `delivered`, `seen`, `queued`, `failed`, `rejected`) produced in its situation |
| REL-08 | The same message ID re-sent → routed once, same receipt |
| REL-09 | Request records: created; `duplicate_request`; deadline on the relay clock, clamped to 10–60 s; record TTL |
| REL-10 | Answers: only the target to the asker; `not_allowed`, `already_answered`, `cancelled`, `expired`; `ok_late` within 30 s with `late: true`; **the 50-way race gives exactly one `ok`** |
| REL-11 | Cancel: only by the asker; targets receive `verify.cancel`; the state becomes cancelled |
| REL-12 | A frozen socket (no `ack` in 1.5 s) → push fallback, only when push is allowed for that kind |
| REL-13 | Drain: `/readyz` 503 → 6 s → spread `reconnect` frames → 1012 after the timeout; zero envelopes lost under traffic |
| REL-14 | Every error code in 7.5 is produced by a test |
| REL-15 | One test per row of the 16.3 authorisation table |
| REL-16 | Every row of the 16.1 rate-limit table (limit, burst, `retryAfterMs`); the GCRA script (a burst, then a steady rate); many devices behind one IP aren't blocked at realistic numbers |
| REL-17 | A 4th open request from one device is refused |
| REL-18 | With `E2E_REQUIRED=true`, `plain` → `e2e_required` unless both ends are opted in to the Lab |
| REL-19 | Fail closed: Valkey down → `unavailable`; Postgres down with a cold cache → `unavailable`; warm cache → still works |
| REL-20 | Invalid configuration → the process exits with a clear message |
| REL-21 | `X-Forwarded-For` honoured only from `TRUST_PROXY` |
| REL-22 | Log leak test: logs captured during full flows contain no payload, nonce, signature, grant, endpoint, name, label or phone number |
| REL-23 | `/metrics` exposes the 19.1 metrics; no label carries a device ID |
| REL-24 | `/healthz` vs `/readyz` semantics (readiness fails while draining or when Valkey is down) |

**CON: contacts, devices and data**

| ID | What is proven |
|---|---|
| CON-01 | `grant.set` stores only the hash; `rotate` revokes older grants |
| CON-02 | First contact with a valid grant creates the binding; an invalid grant, or no grant and no binding → `not_allowed` |
| CON-03 | A revoked sender is refused even with a valid grant; `unrevoke` by the target works; **a revoked row survives the blocked device retiring** |
| CON-04 | Retire: tombstone; logins refused (4403); the exact deletions of 6.6; revoked rows kept |
| CON-05 | 50 bindings per target; 20 new bindings a day per target and per sender |
| CON-06 | Presence: `online` / `push` / `offline`; strangers always `offline`; no timestamps anywhere |
| CON-07 | `contact.list` is correct; the schema has no name or phone columns |
| CON-08 | Caches are invalidated on change; a cold-cache database error fails closed |
| CON-09 | The retention job deletes per 15.3; inactive devices are tombstoned after 12 months (time-travel test) |
| CON-10 | Migrations apply from empty; destructive migrations are rejected unless marked as a contract step |
| CON-11 | Self-healing: wipe Valkey → recovers; wipe the allowed bindings → rebuilt on the next message carrying the grant |
| CON-12 | Admin CLI: block (sockets closed with 4403 on every gateway), unblock, retire, stats, lab on/off |
| CON-13 | Every audit event kind is written with an HMAC subject, never a raw ID |

**PSH: Web Push (a mock push service decrypts and records every push)**

| ID | What is proven |
|---|---|
| PSH-01 | Subscriptions: allowlisted hosts accepted; `http:`, `localhost`, `169.254.169.254` and internal names rejected |
| PSH-02 | Headers: TTL (whole seconds), `Urgency: high`, `Topic` only when `re` exists (≤ 32 URL-safe characters); VAPID JWT valid (`aud`, `exp`, `sub`); the payload decrypts with the subscription keys (RFC 8291) |
| PSH-03 | The responses 201, 404/410, 413 (wake push), 429 (`Retry-After`), 403, 400 and 5xx/timeouts are each handled as in the 11.3 table |
| PSH-04 | Frames ≤ 3,000 bytes travel inside the push; larger ones use a wake push; `/v1/inbox/fetch` requires a valid signature and a fresh time, is rate-limited, and allows CORS only from the app origin |
| PSH-05 | `push.test` arrives after 10 s; the fourth in an hour is refused |
| PSH-06 | VAPID rotation: each subscription is pushed with its own key; a mismatch triggers a re-subscribe |
| PSH-07 | Service-worker logic: the notification options per kind; `silent` and `vibrate` never together; tag and URL correct |
| PSH-08 | Lock-screen text never contains an amount or a reason, for any kind |

**APP: the frontend with the real backend**

| ID | What is proven |
|---|---|
| APP-01 | Every combination of `SIM_RELAY`, `SIM_KEY` and `SIM_VERIFIER` works |
| APP-02 | The device ID is derived from the key; keys are non-extractable and persisted; `storage.persist()` is called |
| APP-03 | Card v2 QR and link round trip; every validation error shows its message; words are derived locally |
| APP-04 | Every row of the new-phone guard table (6.5) in the UI |
| APP-05 | RealKey: a passkey is created in the virtual authenticator; user verification is required; the errors map to A6/F5 text; `credentials.get` runs with no `await` before it in the tap handler |
| APP-06 | Every verdict and reason reachable through the UI: VERIFIED; DENIED; NO_RESPONSE (`timeout`, `offline`, `relay_unreachable`, `late`, `not_allowed`); INVALID (each reason); skipped checks for an unreadable seal |
| APP-07 | The used nonce is marked right after a verdict or cancel, but after a timeout only when the late window closes; old nonces are pruned after 30 days |
| APP-08 | RealRelay: backoff with jitter; the outbox re-sends the same ID; `sendRequest` resolves on `accepted` and rejects after 5 s; receipts drive D3 and "Family alerted"; tombstones; dedupe; the push inbox is processed; the clock offset is used only for display |
| APP-09 | Every new state from 22.1: D3 status line; the `not_allowed` ending; F1 countdown correct with a 2-minute clock skew; F1 cancelled; the E3 late line; the E2 late meta line; the D1 hint; Settings → Privacy; C7 revoke and reset; Diagnostics fields; the update prompt on 4426; the A6 checks-only path; F1 dropping a mis-addressed request |
| APP-10 | Confirmation words are identical on both phones |
| APP-11 | Every new i18n key exists in `en.json` and `hi.json`; no word from `scripts/banned-words.txt` appears in code, UI text or docs |
| APP-12 | Security headers are present; the meta CSP names the right relay; fonts are self-hosted; no requests go to third-party hosts except the relay and Sentry |
| APP-13 | The Sentry scrubber removes every field listed in 16.7 |
| APP-14 | The whole frontend Part D walkthrough passes against the real backend |

**J: end-to-end journeys (Playwright; contexts for Maa, Arjun, Papa, and a judge or the Lab)**

| ID | Journey | Expected |
|---|---|---|
| J-01 | Both set up; they add each other in person (pasted codes); words compared | Both saved; words identical |
| J-02 | Genuine YES | VERIFIED; the same two confirmation words on both |
| J-03 | NOT ME | DENIED; Papa receives G1 |
| J-04 | No answer | NO_RESPONSE at 60 s exactly; "Ask family" → Papa receives G2 |
| J-05 | Maa offline / relay down | `offline` / `relay_unreachable` endings |
| J-06 | Arjun's page closed → push (mock) → the notification URL opened → answer | Correct verdict |
| J-07 | Maa cancels | Arjun: "Maa stopped waiting" |
| J-08 | Late NOT ME / late YES | DENIED (late) / "Not confirmed yet" with the late line |
| J-09 | The judge opens Arjun's family link and checks him | Checks-only profile; correct verdict |
| J-10 | A "new phone" link with Arjun's name | Blocked with the red warning |
| J-11 | Arjun removes Maa (with reset); Maa checks | "isn't accepting checks from you"; a new person with the old card is refused |
| J-12 | 50 Lab attacks (change, replay, forge, forge with a copied credId) | All INVALID with the expected reasons; false greens = 0 |
| J-13 | Call Guard scripted call → prompt → Maa's D2 prefilled | Prompt arrives; fields correct |
| J-14 | `relay-a` killed while a request is pending (Phase 10, through Caddy) | `relay-b` takes over; correct verdict |
| J-15 | Double tap on NOT ME | One answer counted; no duplicate verdict |
| J-16 | Every journey above with `E2E_REQUIRED=true` | All pass; captured frames contain no readable personal data |
| J-17 | Arjun open in two tabs | Both show the request; answering in one closes the other |

**OPS: infrastructure (local, no cloud account needed)**

| ID | What is proven |
|---|---|
| OPS-01 | `docker compose config` is valid for the production and staging example `.env` files; the profiles are right |
| OPS-02 | The full production stack runs locally behind Caddy (internal certificate authority) |
| OPS-03 | A rolling `deploy.sh` under load (1,000 sockets, 2 checks/s): zero failed checks |
| OPS-04 | Migrations run during a deploy; rolling back to the previous tag works |
| OPS-05 | Backup → restore → identical row counts, including revoked bindings; the dump is unreadable without the `age` key |
| OPS-06 | Restarting the whole stack (a VM reboot simulation): everything healthy within 60 s |
| OPS-07 | The image manifest includes `linux/arm64` and `linux/amd64`; the arm64 image boots |
| OPS-08 | shellcheck (`deploy.sh`, backup script), `hadolint --failure-threshold warning` (Dockerfiles), actionlint (workflows) and `cloud-init schema` are clean |
| OPS-09 | Only ports 80 and 443 are published |
| OPS-10 | The canary passes against the local stack |
| OPS-11 | Dashboards and alert rules are valid JSON/YAML and load in Grafana's validator |

**LOAD, CHAOS, SEC**

| ID | What is proven |
|---|---|
| LOAD-01 | Capacity per relay container at p95 routing < 150 ms (21.4); sets `MAX_SOCKETS` |
| LOAD-02 | Reconnect storm: one container killed; all sockets back within 30 s; errors below 1% |
| LOAD-03 | Soak: no memory growth (a shortened run locally, 12 h on staging) |
| CHAOS-01…05 | Each 21.5 scenario ends in a correct, safe outcome, never a false green |
| SEC-01 | Envelope parser fuzzing: no crash, no unhandled rejection |
| SEC-02 | A replayed login is refused |
| SEC-03 | An answer from a non-target is refused |
| SEC-04 | Binding bypass: revoked + valid grant; a new identity with a rotated grant; both refused |
| SEC-05 | Downgrade: the relay strips `e2e` and sends `plain` → the app refuses it |
| SEC-06 | Oversized and binary frames are handled |
| SEC-07 | Connections that never log in close at 10 s; the number of pending unauthenticated sockets per IP is capped |
| SEC-08 | SSRF push subscriptions are refused |
| SEC-09 | Lab off → every `lab.*` refused; Lab on but not opted in → nothing intercepted; wrong passwords rate-limited on both `lab.join` and `lab.optin` |
| SEC-10 | gitleaks finds no secrets in the repository or its history |
| SEC-11 | `pnpm audit` and Trivy report no critical or high issues |
| SEC-12 | Presence never reveals anything about strangers |

### E3. The final gate (end of Phase 11, before judging, and after any large change)

On every push, CI runs the unit, integration and both end-to-end passes. On every deploy, the deploy workflow runs the staging smoke test. This full list adds everything else:

```bash
docker compose -f infra/compose/docker-compose.dev.yml up -d
pnpm install --frozen-lockfile
pnpm turbo run lint typecheck test build          # unit + coverage thresholds (parallel)
pnpm depcruise
pnpm test:integration                             # relay with real Valkey/Postgres, two relay processes
pnpm test:e2e                                     # all J-journeys, E2E off
E2E_REQUIRED=true pnpm test:e2e                   # all J-journeys, E2E on (J-16)
pnpm test:ops                                     # OPS-01 … OPS-11 (local compose stack)
pnpm test:security                                # SEC-01 … SEC-12
pnpm test:load:short && pnpm test:chaos           # LOAD and CHAOS (short versions)
node scripts/check-test-matrix.mjs                # fails if any TEST_MATRIX.md row is not ✅ or "manual"
```

### E4. The real-phone script (the team runs it; results go in `docs/REAL_DEVICE_RESULTS.md`)

**Devices:**
- Phone A: Android with Chrome, as "Maa".
- Phone B: an iPhone with the app installed to the Home Screen, as "Arjun". Swap the roles on a second pass.
- A third phone as "the judge".
- Put the phones on two different carriers.

| # | Step | Expected |
|---|---|---|
| 1 | Install both from `app.yourdomain.in`; set up; create keys with fingerprint | Keys created; safety words shown |
| 2 | Add each other face to face (QR) | The same four words on both screens |
| 3 | Diagnostics on both | Connected; storage protected; push on; the right relay and build |
| 4 | Genuine YES, both apps open | "Confirmed" in under 5 s after the fingerprint; the same two words on both |
| 5 | NOT ME | "Not Arjun"; the third phone gets the alert |
| 6 | No answer | "Not confirmed yet" at 60 s |
| 7 | Maa cancels | Arjun sees "Maa stopped waiting" |
| 8 | Airplane mode on Maa for 5 s during the wait | Recovers; the verdict arrives |
| 9 | "Send test alert" with both screens locked | Arrives within 5 s on both |
| 10 | Android: Arjun's app swiped away, screen locked → Maa asks | Notification; tap → fingerprint → verdict on Maa |
| 11 | iPhone: the same as step 10 | The same |
| 12 | Battery saver on (brand default), then Unrestricted | Record delivery times for both |
| 13 | The judge's phone opens Arjun's family link (no install) and checks him | Works end to end |
| 14 | Someone sends Maa a "new phone" link named Arjun | Red warning; nothing added |
| 15 | Security Lab on the laptop: one change, one replay, one forge | "Fake answer" each time, with the right reason |
| 16 | Call Guard scripted mode sends a prompt to Maa | Banner → D2 prefilled |
| 17 | (Staging) deploy during a pending check | The check still completes |
| 18 | (Staging) reboot the VM during idle | Everything back by itself within 2 minutes |
| 19 | (Staging) rehearse the standby switch (24.3) | Done within 30 minutes |
| 20 | Hindi language on one phone for steps 4–7 | All new texts appear in Hindi |

### E5. The regression rule

Every bug found anywhere (a test, a real phone, a judge's question):
1. **First**, a new test that fails because of it, with a new row in `TEST_MATRIX.md`.
2. **Then** the fix.
3. **Then** the full gate (E3).

No bug is ever fixed without a test that would catch it coming back.

---

*End of the build prompt. Build in the order of Part D, prove every rule with Part E, own it as described in section 26, and keep section 1.1 true in every change: the relay moves sealed envelopes; only Maa's phone decides.*
