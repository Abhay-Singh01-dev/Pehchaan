# Pehchaan · पहचान — frontend

**Two-factor authentication for humans.** During a suspicious call, one tap asks the claimed
person's *own phone* whether it's really them. They unlock with their fingerprint or PIN, their
key signs the answer, and the parent's phone runs 7 checks before it shows a verdict:
**green** (really them), **red** (not them, or a fake answer), **amber** (no answer yet / can't check).

This is the complete frontend described in `../Pehchaan_Frontend_Build_Prompt.md` (Part B, phases 0–10):
the family app (A0–I6), the Security Lab (`/lab`), Call Guard (`/guard`) and Diagnostics
(`/diagnostics`). There is **no backend**: every network and crypto call goes through
`src/services`, which currently uses **simulated** implementations. The team replaces them with
the real ones without touching any screen — see [`docs/HANDOVER.md`](docs/HANDOVER.md).

> ⚠️ While `VITE_SIMULATION=true` a **“Simulated network”** badge shows on every screen.
> Never show judges a build with that badge.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5180
```

Open these as separate tabs **in the same browser window** (they talk over a BroadcastChannel):

| Tab | URL | Plays |
| --- | --- | --- |
| Maa | `http://localhost:5180/?device=maa` | Sunita Sharma, checks others (seeded) |
| Arjun | `http://localhost:5180/?device=arjun` | Arjun Sharma, can be verified (seeded) |
| Priya | `http://localhost:5180/?device=priya` | Priya Sharma, receives family alerts (seeded) |
| Lab | `http://localhost:5180/lab?device=lab` | Security Lab (laptop) |
| Guard | `http://localhost:5180/guard?device=guard` | Call Guard (laptop) |

`?device=<name>` gives a tab its own IndexedDB (`pehchaan-<name>`) and device id (`sim-<name>`);
the tab remembers it for the session. Any other name starts a fresh, un-set-up phone.
On a single phone, use **Settings → tap the version 5× → Diagnostics → Simulation panel →
Auto-answer** to test every verdict without a second tab.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :5180 |
| `npm run build` | Typecheck, then production build (PWA + service worker) into `dist/` |
| `npm run preview` | Serve `dist/` on :4180 (the service worker only runs here, not in dev) |
| `npm run check` | Typecheck + i18n parity + WCAG contrast + unit tests |
| `npm test` | Unit tests (Vitest): the 7 checks and every INVALID reason, cards, Guard rules, words |
| `npm run e2e` | The Part D walkthrough end to end (Playwright). `PW_CHANNEL=msedge npm run e2e` uses an installed Edge/Chrome; otherwise run `npx playwright install chromium` once |
| `npm run budget` | After a build: initial JS must be < 250 KB gzipped (spec B15) |
| `npm run contrast` | Every token text/background pair against WCAG 2.2 AA |
| `npm run i18n` | en/hi key parity, and every key used in code exists |
| `npm run fonts` / `npm run brand` | Re-copy self-hosted fonts / regenerate the seal glyph and PWA icons |

## Feature flags

Set in `.env` (see `.env.example`), read by `src/app/flags.ts`:

| Flag | Default | Effect |
| --- | --- | --- |
| `VITE_SIMULATION` | `true` | Simulated services + the “Simulated network” badge |
| `VITE_ENABLE_LAB` | `true` | `/lab` exists |
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
  services/     types.ts (all interfaces), index.ts (sim/real switch), verdict.ts (7 checks → verdict),
                card.ts, requests.ts, words.ts, guard/rules.ts, sim/*, real/* (team-owned stubs)
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
