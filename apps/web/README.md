# Pehchaan · पहचान — the app

**Two-factor authentication for humans.** During a suspicious call, one tap asks the claimed
person's *own phone* whether it's really them. They unlock with their fingerprint or PIN, their
passkey signs the answer, and the parent's phone runs 7 checks before it shows a verdict:
**green** (really them), **red** (not them, or a fake answer), **amber** (no answer yet / can't check).

This is the installable PWA: the family app (A0–I6), the Security Lab (`/lab`), Call Guard (`/guard`) and
Diagnostics (`/diagnostics`). It talks to the Pehchaan relay (`apps/relay`) through `src/services`; each
service can also run **simulated**, so the whole app works in one browser with no backend. See
[`docs/HANDOVER.md`](docs/HANDOVER.md) for which file implements which backend rule.

> ⚠️ While anything is simulated a **“Simulated: …”** badge shows on every screen.
> Never show judges a build with that badge.

## Quick start

From the repository root:

```bash
pnpm install
pnpm db:up             # Valkey + Postgres in Docker (127.0.0.1 only)
pnpm dev               # the relay on :8080 and this app on http://localhost:5180 (Vite proxies /relay)
```

That runs against the **real relay**. For real passkeys and the real verifier, set in `apps/web/.env.local`:

```bash
VITE_SIM_RELAY=false
VITE_SIM_KEY=false
VITE_SIM_VERIFIER=false
```

(`localhost` is a secure context, so passkeys work there; for real phones use a tunnel, backend spec 18.12.)

### Fully simulated (no backend)

With `VITE_SIMULATION=true` (the default in `.env`), open these as tabs **in the same browser window**; they
talk over a BroadcastChannel:

| Tab | URL | Plays |
| --- | --- | --- |
| Maa | `http://localhost:5180/?device=maa` | Sunita Sharma, checks others (seeded) |
| Arjun | `http://localhost:5180/?device=arjun` | Arjun Sharma, can be verified (seeded) |
| Priya | `http://localhost:5180/?device=priya` | Priya Sharma, receives family alerts (seeded) |
| Lab | `http://localhost:5180/lab?device=lab` | Security Lab (laptop) |
| Guard | `http://localhost:5180/guard?device=guard` | Call Guard (laptop) |

`?device=<name>` gives a tab its own IndexedDB (`pehchaan-<name>`), and so its own device identity; the tab
remembers it for the session. The seeded names have fixed test keys, so they can verify each other at once.
Any other name starts a fresh, un-set-up phone. On a single phone, use **Settings → tap the version 5× →
Diagnostics → Simulation panel → Auto-answer** to test every verdict without a second tab.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` (here) | This app only, on :5180 |
| `pnpm build` | Production build (PWA + service worker) into `dist/` |
| `pnpm preview` | Serve `dist/` on :4180 (the service worker only runs here, not in dev) |
| `pnpm test` | i18n parity, WCAG contrast, then the unit tests with the `services/real` coverage thresholds |
| `pnpm e2e` | The Part D walkthrough, fully simulated (its own server on :5190). The real-backend journeys are `pnpm test:e2e:real` at the root |
| `pnpm budget` | After a build: initial JS must be < 250 KB gzipped (spec B15) |
| `pnpm contrast` | Every token text/background pair against WCAG 2.2 AA |
| `pnpm i18n` | en/hi key parity, and every key used in code exists |
| `pnpm fonts` / `pnpm brand` | Re-copy self-hosted fonts / regenerate the seal glyph and PWA icons |

`PW_CHANNEL=msedge` makes Playwright use an installed Edge/Chrome; otherwise run
`pnpm exec playwright install chromium` once.

## Settings

Set in `.env.local` (see `.env.example`), read by `src/app/flags.ts` and `src/app/config.ts`:

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_SIMULATION` | `true` | Default for the three below |
| `VITE_SIM_RELAY` / `VITE_SIM_KEY` / `VITE_SIM_VERIFIER` | `VITE_SIMULATION` | Simulate the relay / the passkey / the verifier's expected address, independently |
| `VITE_ORIGIN`, `VITE_RP_ID` | this page's own | The address passkeys sign for; the rpId never changes after launch |
| `VITE_RELAY_URL` | `ws(s)://<this host>/relay/v1/ws` | The relay |
| `VITE_ENV` | `development` in dev | `production` hides "Reset used request numbers" |
| `VITE_PRIVACY_CONTACT` | none | The grievance contact on the privacy notice |
| `VITE_ENABLE_LAB` | `true` | `/lab` exists, and Diagnostics offers the Lab opt-in when the relay is real |
| `VITE_ENABLE_GUARD` | `true` | `/guard` and the Call Guard banner exist |
| `VITE_ENABLE_EXTRAS` | `false` | Optional screens A8, C9, D5, I6 (entry points appear in Settings → Help and Add family) |

## Stack

React 19 · TypeScript 7 · Vite 8 · Tailwind CSS 4 (driven by CSS variables) · Motion 13 (`LazyMotion`)
· Phosphor Icons · React Router 7 · i18next · Dexie (IndexedDB) · `qrcode` / `qr-scanner`
· `vite-plugin-pwa` · Vitest · Playwright.

## Where things live

```
src/
  app/          boot, router + transitions, providers, flags, i18n, theme, PWA,
                and the two controllers: verification.ts (asker) and answering.ts (answerer)
  design/       tokens.css, fonts.css, motion.ts, haptics.ts, sounds.ts, wakeLock.ts, origin.ts, glyphs.ts
  components/   shared UI (Seal, VerdictScreen, ChecksList, Sheet, Button, Avatar, QRCard…)
  screens/      one folder per area: setup home family verify answer alerts history
                settings help lab guard diagnostics
  services/     types.ts (all interfaces), index.ts (sim/real switch), identity.ts, verifier.ts (the 7 checks),
                verdict.ts (the green guard), card.ts, requests.ts, guard/rules.ts, sim/*, real/* (relay, passkey)
  store/        Dexie database, repositories, seed data
  i18n/         en.json, hi.json   (hi.json: have a native speaker review it)
tests/unit      Vitest     tests/e2e   Playwright (Part D)
scripts/        fonts, brand assets, contrast, i18n, bundle budget
docs/           ARCHITECTURE.md · HANDOVER.md · CHECKLISTS.md
```

## Where this build deliberately differs from the spec

All in the spirit of the spec; none change behaviour the team relies on.

- **React 19** instead of 18: React Router's current line requires it. No visible difference.
- **Motion `domMax`** (loaded after first paint) instead of `domAnimation`: shared-element
  `layoutId` transitions and drag-to-dismiss sheets need it.
- **Fonts are self-hosted** (the same four families, from `@fontsource`) instead of the Google
  Fonts CDN: they work offline from the first launch and add no third-party request.
- **`?device=priya` is seeded too**, so the Part D walkthrough works out of the box.
- **A guilloché rosette** (the fine line-work printed on banknotes and stamp paper) appears very
  faintly on the Verify button and the splash — the “seal on an official document” metaphor.
- Small, documented **interface extensions** (marked `EXTENSION` in `services/types.ts`) for
  Diagnostics, the Lab and Call Guard — e.g. `relay.announce/onPeers/ping`. See HANDOVER.md.
- Call Guard also recognises **names it has never seen** (“main Rohit bol raha hoon”), because a
  scammer's claimed name may not be on the laptop.
- **On screens 640 px and wider the family app is shown as a 375 × 667 phone card** centred on
  the page (phones get the full screen). Everything — tab bar, sheets, banners, verdicts — stays
  inside the card. Screen heights use `min-h-app` / `h-app` (the `--app-h` variable), never raw
  viewport units. The Lab and Call Guard remain full-width laptop pages.
- **Browser machine translation is switched off** (`translate="no"`): Pehchaan has its own
  English/Hindi switch, and auto-translate garbles Hindi and safety wording.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together, and
[`docs/CHECKLISTS.md`](docs/CHECKLISTS.md) for Phase 0 answers, the B6 motion checklist and the
B17 definition of done.
