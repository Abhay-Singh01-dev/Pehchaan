# Checklists

## Phase 0 · Plan

**1. The core loop, in five lines**
1. During a suspicious call, Maa taps *Verify a caller*, picks who the caller claims to be, and what they want.
2. A fresh request (random nonce, 60 s expiry) goes through a relay that only passes messages, to that person's own phone.
3. Arjun's phone asks him full-screen; he answers *NO, NOT ME* or *Yes, it's me* and unlocks with fingerprint or PIN.
4. His key signs the exact request together with his answer, and the signed answer travels back.
5. Maa's phone runs 7 checks itself and shows green (all pass + yes), red (all pass + no, or any check fails) or amber (no answer / can't check).

**2. Folder structure** — see the README's “Where things live”.

**3. Screens** (all routes in `src/app/routes.tsx`)

| ID | Route | File |
| --- | --- | --- |
| A0 Splash | `/` | `screens/setup/Splash.tsx` |
| A1 Install | `/install` | `screens/setup/Install.tsx` |
| A2 Language | `/setup/language` | `screens/setup/Language.tsx` |
| A3 Welcome | `/setup/welcome` | `screens/setup/Welcome.tsx` |
| A4 Name | `/setup/name` | `screens/setup/NameStep.tsx` |
| A5 Role | `/setup/role` | `screens/setup/RoleStep.tsx` |
| A6 Key | `/setup/key` | `screens/setup/KeyStep.tsx` |
| A7 Done · A8 Notifications (extras) | `/setup/done` · `/setup/notifications` | `screens/setup/Done.tsx` |
| B1 Home · B2 Call Guard banner | `/home` · overlay | `screens/home/Home.tsx` · `app/Banners.tsx` |
| C1 Family | `/family` | `screens/family/FamilyList.tsx` |
| C2 Add | `/family/add` | `screens/family/AddFamily.tsx` |
| C3 My code | `/family/my-code` | `screens/family/MyCode.tsx` |
| C4 Scan | `/family/scan` | `screens/family/Scan.tsx` |
| C5 Confirm | `/family/confirm` | `screens/family/ConfirmMember.tsx` |
| C6 Member · C7 Remove | `/family/:memberId` | `screens/family/MemberDetail.tsx` |
| C8 Family link | `/join#c=…` | `screens/family/Join.tsx` |
| C9 Far away (extras) | `/family/far-away` | `screens/family/FarAway.tsx` |
| D1 Who | `/verify/who` | `screens/verify/Who.tsx` |
| D2 What | `/verify/what` | `screens/verify/What.tsx` |
| D3 Waiting | `/verify/waiting/:requestId` | `screens/verify/Waiting.tsx` |
| D4 Official | `/verify/official` | `screens/verify/Official.tsx` |
| D5 Payment check (extras) | `/verify/payment` | `screens/verify/PaymentCheck.tsx` |
| E1–E5 Verdicts · E6 Why? · E7 Words | `/verify/result/:requestId` | `screens/verify/Result.tsx`, `components/VerdictScreen.tsx`, `components/ChecksList.tsx` |
| F1 Incoming · F4 · F5 | `/request/:requestId` | `screens/answer/Incoming.tsx` |
| F2 Unlock | sheet | `components/UnlockSheet.tsx` |
| F3 Sent | `/request/:requestId/sent` | `screens/answer/Sent.tsx` |
| G0 Alerts · G1 · G2 | `/alerts` · banner · cards | `screens/alerts/Alerts.tsx`, `app/Banners.tsx`, `components/AlertCard.tsx` |
| H1 History · H2 Detail | `/history` · `/history/:eventId` | `screens/history/*` |
| I1 Settings · I1a–I1d · I5 | `/settings/*` | `screens/settings/*` (I1d reuses A2's cards) |
| I2 · I3 · I4 · I6 (extras) | `/help/*` | `screens/help/*` |
| J1 Security Lab | `/lab` | `screens/lab/*` |
| J2 Call Guard | `/guard` | `screens/guard/*` |
| J3 Diagnostics | `/diagnostics` | `screens/diagnostics/Diagnostics.tsx` |

**4. Libraries and substitutes** — as specified, except React 19 (React Router's current line
needs it), Motion `domMax` loaded lazily (layoutId + drag), and self-hosted fonts via `@fontsource`
(offline, no third party). Added: Zustand (tiny UI stores), `@tanstack/react-virtual` (the Lab's
virtualised log), Vitest + fake-indexeddb, Playwright.

**5. Ambiguities, and how they were resolved**
1. *Several checks fail — which INVALID reason?* The most specific: `wrong_key` › `reused`/`expired` › `changed` › `wrong_app` › `not_unlocked` › `bad_signature` (`services/verdict.ts`).
2. *Where do confirmation words come from?* Both phones derive two words from SHA-256 of the signed answer (`services/words.ts`).
3. *Checks-only people have no key — what are their safety words?* Derived from their device id, so their card can still be confirmed in person.
4. *How can the Lab intercept a BroadcastChannel?* In attacker mode, phones send messages “up” and only the Lab delivers them (ARCHITECTURE.md).
5. *Alerts carry the sender's labels, which differ per phone.* Alerts also carry device ids; each receiver shows its own labels.
6. *Priya's tab has no seed in the spec but Part D uses it.* Priya is seeded too.
7. *How does the Lab know what Maa's phone showed?* The asker reports the verdict on the relay's lab channel (`relay.reportVerdict`), in the test environment only.

**6. Confirmed:** no login, backend, database server, analytics or AI features (B16).

## Phase 8 · Motion (spec B6)

All tokens in `design/motion.ts`. Only transform, opacity, clip-path and stroke animate.

| Item | Where |
| --- | --- |
| B6.2 forward / back navigation | `app/RouteFrame.tsx` (variants), `app/transitions.ts` |
| Tab crossfade + sliding pill (`layoutId`, spring.ui) | `RouteFrame` “tab”, `components/TabBar.tsx` |
| Sheets: rise with spring.soft, blurred scrim, velocity-aware drag-to-dismiss, `dismissible` | `components/Sheet.tsx` |
| Full-screen takeovers: circular clip-path from the origin | `RouteFrame` → `RevealLayer`, `design/origin.ts` |
| Shared elements: list avatar → detail header | `layoutId="avatar-{id}"` in `Member.tsx`, `Home.tsx`, `MemberDetail.tsx` |
| Toasts: drop in, 3.5 s, swipe up | `components/Toasts.tsx` |
| B6.3 buttons (0.97, spring.ui, 2px highlight shift, disabled static) | `components/Button.tsx` |
| Chips fill from the centre, text crossfades | `components/controls.tsx` → `ChipGroup` |
| Cards/rows stagger in (45 ms, max 8), press 0.985 | `riseIn` in `design/motion.ts`; `Member.tsx`, `List.tsx` |
| Connection pill (crossfade, pulsing dots, ✕ slides in) | `components/ConnectionPill.tsx` |
| Amount input: rolling digits, commas slide | `components/AmountInput.tsx`, `components/Rolling.tsx` |
| Countdown ring/bar: smooth depletion, amber last 10 s | `components/Countdown.tsx` |
| Skeletons only after 300 ms | `components/Skeleton.tsx` |
| Pull to refresh: the seal rotates and presses | `components/PullToRefresh.tsx` (Home, History) |
| B6.4 #1 Launch | `screens/setup/Splash.tsx`, `Seal intro` |
| #2 Waveform → seal, parallax cards | `components/illustrations/WaveformSeal.tsx`, `screens/setup/Welcome.tsx` |
| #3 Key into vault, 30° lock, words flip in | `KeyVault` in `components/illustrations/index.tsx`, `KeyStep.tsx`, `SafetyWords.tsx` |
| #4 QR ripple, brass frame, 6 s sweep | `components/QRCard.tsx` |
| #5 Brackets breathe, scan line, snap, check burst | `screens/family/Scan.tsx`, `ConfirmMember.tsx` |
| #6 Verify breathing + colour flood | `components/BigButton.tsx`, transition “brand” |
| #7 Waiting arc, travelling dot, pulse, dot returns, reveal from Maa | `screens/verify/Waiting.tsx`, `ArcTraveler` |
| #8 The verdict (reveal, stamp, ripple, draw, rise, per-verdict detail) | `components/VerdictScreen.tsx` |
| #9 Why? sheet (70 ms stagger, 220 ms draw, red ✕ shake, count-up) | `components/ChecksList.tsx` |
| #10 Incoming takeover (centre reveal over blur, heartbeat, bar, NO glow) | `screens/answer/Incoming.tsx`, `RouteFrame` “takeover” |
| #11 Sealed envelope flies to the top edge | `screens/answer/Sent.tsx` |
| #12 Family alert banner with a red edge glow | `app/Banners.tsx` |
| B6.5 Lab pipeline, capsules, mutation, shatter, rolling counters | `screens/lab/Pipeline.tsx`, `Lab.tsx` |
| Call Guard waveform, words fade, chips pop, stage fills, capsule flies | `screens/guard/*` |
| B6.6 Reduced motion | `MotionConfig reducedMotion` (`app/Providers.tsx`), `useReduced()` in every looped/moving element, CSS loops disabled (`index.css`), reduced route variants |

Deviation: D1 → D3's avatar isn't a shared element — `layoutId` fought the D3 clip-path reveal,
which is the spec's primary motion there; the reveal starts from the tapped button instead.

## Phase 9 / B17 · Definition of done

| Item | Status | Evidence |
| --- | --- | --- |
| Every B12 screen, every state, English and Hindi, light and dark | ✅ | `routes.tsx`; `npm run i18n` (734 keys, parity); visual tours in both themes and languages |
| Full loop across two tabs, all five verdicts | ✅ | `tests/e2e/walkthrough.spec.ts` (Confirmed, Not them, Fake answer, Not confirmed yet, Can't verify) |
| Lab: change, replay, forge → Fake answer with the right reason, 0 false greens | ✅ | e2e “4–6”; `tests/unit/verifier.test.ts` |
| Call Guard scripted → B2 banner on Maa | ✅ | e2e “10” |
| Family link in a fresh profile → verdict | ✅ | e2e “11” |
| Every B6.4 moment; reduced motion → fades | ✅ | table above; reduced-motion run of the loop |
| Haptics, sounds, wake lock on Android Chrome; silent elsewhere | ⚠️ | Implemented with feature detection and user-activation checks; silent in desktop browsers. **Test on a real Android phone** (Part A #6). |
| Installs on Android and iOS; opens offline; update toast | ⚠️ | Manifest, service worker and offline start verified on the production build. **Install on real phones**, and exercise the update toast by deploying twice. |
| Contrast AA; visible focus; verdicts announced | ✅ | `npm run contrast`; global `:focus-visible` ring; `aria-live="assertive"` in `VerdictScreen` |
| Nothing clips at Extra large / 200% zoom | ✅ | `tests/e2e/reflow.spec.ts` (320 px, Extra large, en + hi) |
| Nothing from B16 | ✅ | copy + code sweep; only the spec's own “safe” lines remain |
| Simulation badge; documented `services/real/*` stubs | ✅ | `components/SimulationBadge.tsx`; `docs/HANDOVER.md` |
| Initial JS < 250 KB gzipped (B15) | ✅ | `npm run budget` → ~232 KB |
