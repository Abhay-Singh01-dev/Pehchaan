# Open questions

Questions the specification and the code couldn't answer. Answered ones stay here with the answer and date.

## Answered

| ID | Question | Answer (2026-09-26) |
|---|---|---|
| Q-1 | The spec puts the frontend at `apps/web`, but the build session runs inside `frontend/`, which Windows can't move while it's in use. | Copy it into `apps/web`; the team deletes the old folder afterwards (D-001). |
| Q-2 | `scripts/banned-words.txt` is "the team's list", which isn't in the codebase. What does it contain? | demo, hacker-proof, unhackable, 100% secure, AI-powered, unbreakable, military-grade, guaranteed. Whole words, case-insensitive; "test", "mock" and "safe" are banned on family screens only (D-004). |
| Q-3 | `Pehchaan/` wasn't its own git repository. | `git init`, with one commit per phase after its gate passes (D-006). |
| Q-4 | Is the production domain known? Passkeys are bound to it forever. | Not yet: use `yourdomain.in` placeholders, and rpId `localhost` locally (D-005). |

## Open

| ID | Question | Quote | Status |
|---|---|---|---|
| Q-5 | The PIN fallback (10.10, P2) defines the signature input but not the answer's wire fields (what goes in `credId`, `authenticatorData` and `clientDataJSON` for `keyType: "pin"`), and no Part D phase builds it. | "It is signed by the device signing key over `"pehchaan-pin-answer-v1\n" + ORIGIN + "\n" ‖ challenge`." | Deferred (D-015). Needs a wire definition before it's built. |
| Q-6 | 25.1: what may be prepared before the 24-hour event? | "Ask the GDG CRCE organisers in writing what may be prepared before the 24 hours." | For the team (A5). |
| Q-7 | Accounts and secrets (A5): Oracle Cloud, Vercel, Cloudflare, GitHub environments, Sentry, Grafana Cloud, the backup bucket, VAPID keys, the Lab password. | Part A5 | For the team. Every file that needs one reads it from the environment; `infra/vm/env.example` lists the names. |
