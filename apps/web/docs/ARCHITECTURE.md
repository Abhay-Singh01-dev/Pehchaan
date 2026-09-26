# Architecture

## Layers

```
screens/  ──►  app/ controllers (verification.ts, answering.ts) ──►  services/ interfaces
    │                                                                   │
    └──────────────►  store/ (Dexie, useLiveQuery)  ◄───────────────────┘
```

- **Screens never call the network or crypto.** They read the database through live queries
  (`store/*`, `useLiveQuery`) and call the two controllers or a service interface.
- **`services/index.ts` picks the implementation** by `flags.SIMULATION`: `services/sim/*` today,
  `services/real/*` later. The real classes are never constructed while simulating.
- **The database is the source of truth for UI.** A check in progress lives in the `outgoing`
  table; an incoming request in `incoming`. Screens render those records, so a check keeps
  running if the person navigates away, and a reload resumes correctly.

## Devices in simulation (spec B3 #1–2)

`app/device.ts` reads `?device=<name>` once per tab (kept in `sessionStorage`): the tab uses DB
`pehchaan-<name>` and device id `sim-<name>`. Seeds (`store/seed.ts`) create Maa, Arjun and Priya
with matching device ids and keys, so tabs can verify each other immediately.

## The simulated relay (`services/sim/SimRelay.ts`, `sim/bus.ts`)

One `BroadcastChannel("pehchaan-sim")`. Messages (`WireMsg`) carry `from`, `to`, `kind`
(`request | answer | alert | guard`) and a **hop**:

- `deliver` — straight to the recipient (normal case).
- `up` — to the relay, when the Security Lab has taken control (attacker mode). Only the Lab
  turns an `up` message into a `deliver` — after tampering with it if an attack is armed.

Other wire traffic: `presence` (every 2 s; reachable = seen in the last 6 s), `bye` (tab closing),
`lab` (the Lab's attacker-mode state), `report` (the asker's phone tells the test-environment Lab
which verdict it showed).

Behaviour that matches a real relay, including failures: 250–600 ms latency per message;
`reconnecting` holds outgoing and incoming messages until connected; `offline` rejects sends and
drops incoming messages. The Simulation panel can force any state.

**Why attacker-mode routing is “sticky”.** Background tabs throttle timers, and a reloaded tab
forgets everything. So:
- phones keep routing `up` until the Lab says otherwise (or is silent for 150 s);
- each tab remembers the Lab's state in `sessionStorage`, so a reloaded phone routes its very
  first message correctly;
- the Lab answers every presence heartbeat while in attacker mode (event-driven, not timer-driven);
- and if a request still slips past directly, an armed replay/forge answers it anyway — the
  attacker simply races the genuine answer, which is also a realistic attack.

## The Security Lab (`services/sim/SimLab.ts`, `screens/lab/*`)

Observes every message; in attacker mode it is the relay. Armed attacks fire on the next check:

| Attack | What it does on the wire | Verifier result |
| --- | --- | --- |
| change | flips `decision` on the next answer; `clientData` still says the original | check 3 fails (6 passes) → **changed** |
| replay | holds the new request; sends the target's earlier genuine YES, relabelled with the new `requestId` | checks 1, 3, 7 fail → **reused** |
| forge | holds the request; answers ME signed with the Lab's own key | checks 2, 6 fail → **wrong_key** |

Every attack and its reported outcome is stored in the Lab's IndexedDB (`labAttacks`) —
the permanent log, exportable as JSON. “False greens” counts attacks that ended VERIFIED
(it must stay 0).

Only one Lab instance may exist per tab: `loadLab()` caches the *promise*, because React
StrictMode's double effects would otherwise create two Labs that forward every message twice.

## A check, end to end (`app/verification.ts`)

1. **D2** → `startCheck()` builds the request through `services.requests` (fresh id, 32-byte
   nonce, `expiresAt = createdAt + 60 s`), stores it as `pending`, and sends it.
2. **`watch()`** arms the 60 s timeout and a relay watch: offline for 5 s → NO_RESPONSE
   (`relay_unreachable`); a send that fails because we're offline → NO_RESPONSE (`offline`).
3. **`relay.onAnswer`** (installed once) → `verifier.verify()` → the result is persisted with
   `assertMayPersist` → a History row → `relay.reportVerdict` → on DENIED, G1 alerts to every other
   family member.
4. **D3** watches the record and, when it's done, sends the dot home and opens `/verify/result/:id`.

## Answering (`app/answering.ts`)

`relay.onRequest` (in `GlobalListeners`) stores the request and opens F1 from any screen (or
leaves it queued if F1 is already open — F1 shows “1 more request”). `answerRequest()` →
`key.signAnswer()` (which opens the F2 unlock) → `relay.sendAnswer()`, retrying every 2 s until
expiry if offline → History row → F3.

## The seven checks (`services/verdict.ts`, `services/sim/SimVerifier.ts`)

`makeCheck()` builds each `CheckResult`; `decideVerdict()` maps them to a verdict. When several
checks fail, the most specific cause wins: `wrong_key` › `reused`/`expired` › `changed` ›
`wrong_app` › `not_unlocked` › `bad_signature`. The team's RealVerifier should reuse these two
functions so both behave identically (the unit tests describe the expected behaviour).

## Safety rules (spec B9) — where each is enforced

| Rule | Where |
| --- | --- |
| #1 No green without all 7 checks | `decideVerdict` only returns VERIFIED when all 7 pass and decision is ME; `finalizeVerdict` marks verifier output; `assertMayPersist` refuses to store any other VERIFIED; `safeVerdict()` in the verdict screen shows a non-conforming green as a fake |
| #2 Amber never turns green | answers are verified only while the request is `pending`; after NO_RESPONSE it isn't |
| #3 Verdicts can't be dismissed by accident | no swipe or tap-outside; `useBlocker` turns the back gesture into an in-page “Close this result?” (`screens/verify/Result.tsx`) |
| #4 Answering always needs an unlock | `SimKey.signAnswer` awaits the unlock sheet for both answers |
| #5 60 s expiry | `REQUEST_TTL_MS`; timers in `verification.ts`; F1 expiry |
| #6 Fail closed | offline / unreachable / silence → NO_RESPONSE (amber) |
| #7 Never auto-fill from a call | Call Guard only prompts; “Verify now” still needs a tap |
| #8 Numbers shown as text | `components/PhoneNumber.tsx` (selectable number + `tel:` + copy) |
| #9 One primary action at the bottom | `components/screen/Page.tsx → BottomActions` |
| #10 No browser dialogs | `InlineConfirm` / `Sheet` everywhere |

## Design system

- **Tokens** (`design/tokens.css`) define every colour for light and dark; components use tokens
  only. `npm run contrast` checks every pair against WCAG AA. Changes from the spec's values:
  `--muted` and the saffron avatar were deepened slightly, and chip text colours tuned, to pass AA.
- **Type scale** multiplies by `--ts` (Large ×1.1, Extra large ×1.22); Hindi gets ~8% more line height.
- **Motion tokens** live in `design/motion.ts` (durations, easings, the three springs, stagger).
- **The seal** (`components/Seal.tsx`) is pure SVG: the “प” glyph is extracted from Anek
  Devanagari into path data (`npm run brand`), so it never waits on a font and matches the app icons.

## Route transitions (`app/transitions.ts`, `app/RouteFrame.tsx`)

Each screen is its own scroll container in a stacked frame. Kinds: forward/back (x ±28 → 0),
tab crossfade, **reveal** (circular clip-path from the tapped point — waiting screen and verdicts;
the clip is removed when it ends), **brand** (Home → Who: the Verify button's colour floods out),
**takeover** (incoming request: reveal from the centre over a blurred backdrop), and fade.
Exiting screens keep their own `location`, so their params never change mid-animation.

## Internationalisation

`src/i18n/en.json` and `hi.json` (734 keys each). Only the active language loads at startup; the
other is prefetched when idle. Hindi verbs that agree with the reader have `_m` / `_f` variants;
`useG()` applies the profile's `hindiForm` as i18next context (the base key is the respectful plural).

## PWA

`vite-plugin-pwa` generates the manifest and a Workbox service worker that precaches the shell,
icons and fonts (relay traffic never touches it). A waiting update shows “Update ready · Reload” —
never during D3, F1 or a verdict. `beforeinstallprompt` is captured for A1.

## Performance

Initial JS ≈ 232 KB gzipped (budget 250, `npm run budget`). Screen areas are lazy chunks,
prefetched when idle; the Lab, Guard, Diagnostics, scanner and QR generator load only when used;
the unlock sheet and banner host mount on first need; Motion's full feature set loads after first paint.
