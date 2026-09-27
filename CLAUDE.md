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
- pnpm test:security   (SEC-01 … SEC-12: fuzzing, relay security tests, gitleaks, pnpm audit, Trivy; needs Docker)
- E2E_REQUIRED=true pnpm test:e2e:real   (J-16: every journey with readable envelopes refused)
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
