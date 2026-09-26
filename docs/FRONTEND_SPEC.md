# Pehchaan: Frontend Build Prompt Pack

**For:** Claude Code to produce React web app.
**Builds:** the complete Pehchaan frontend. That covers:

- everything from the first time someone opens the link to the verdict screen;
- the Security Lab and Call Guard laptop screens;
- the hidden Diagnostics screen;
- every state needed for the live judging session.

**How this file is organised:**

| Part  | What it is                   | What you do with it                                                                                                                      |
| ----- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Team notes                   | Read it. **Don't paste it into the builder.**                                                                                            |
| **B** | Master specification         | Paste it first. If the builder has a project knowledge, instructions or context field, put it there too so every later prompt can see it |
| **C** | Phase prompts (0–10)         | Paste one at a time. Check its acceptance list before moving on                                                                          |
| **D** | Full walkthrough test        | Run it once all phases are done                                                                                                          |
| **E** | Handover to the real backend | What the team replaces later                                                                                                             |

---

**Before starting building keep in mind that do a production type build like of code and file structure of everything you do so that no management problem comes later**

# PART A: Team notes (do not paste)

1. **Check the rules first.** The event FAQ says prototypes are built "from scratch" in the 24 hours. Ask the organisers two questions before generating code:
   - Can code be written before 31 October?
   - Are AI app builders allowed?

   If the answer is no, use this file to rehearse the design and run the phases during the event.

2. **Ownership is a mandatory judging pillar.** Every teammate must be able to explain the generated code. After each phase, one person reads the new files and explains them to another.
   - The **verification logic stays team-written** (Part E). The builder only creates a mock with the same interface.
3. **Build in phases.** Paste Part B, then Phase 0 (plan only), then Phases 1–9 in order. Phase 10 is optional.
   - If the builder drifts from the spec, say: _"Re-read the Pehchaan master specification section B** and fix \_** to match it exactly."_
4. **Why simulation mode exists.** This frontend has no backend yet. Every network and crypto call goes through a service layer with **simulated** implementations:
   - a relay between browser tabs;
   - a mock key and mock verifier that behave exactly like the real ones.

   A visible "Simulated network" badge shows whenever simulation is on. **Never show judges a build with that badge.** The real relay and verifier replace the simulations before the event (Part E).

5. **Pick the final web address early.** Real passkeys (added later) are tied to the domain. Preview URLs from builders often change, so connect a custom domain before the real key code goes in.
6. **Test on real phones every phase:** one Android on Chrome and one iPhone on Safari. Add to Home Screen and use the installed app.
7. **The builder may add things you didn't ask for** (login screens, a database, analytics, "AI" badges). Delete them. Part B, section B16 lists what's forbidden.

---

# PART B: Master specification (paste this first)

> You are building the complete frontend of **Pehchaan** (पहचान, "identity / recognition"), a mobile-first Progressive Web App.
>
> Build only the frontend. **Do not create a backend, API server, database, login, sign-up or user accounts.** All data lives on the device. All network and security operations go through a service layer with simulated implementations (section B3) that the team will later replace with real ones without touching any screen.
>
> Follow this specification exactly. When something is not specified, choose what a senior product designer at a premium fintech company would choose, and keep it consistent with the design system in B5 and the motion system in B6.

## B1. What Pehchaan is

**One line:** two-factor authentication for humans.

**The problem.** Scammers call elderly parents using a perfect AI clone of their son's or daughter's voice ("Maa, I've had an accident, send ₹50,000, don't tell Papa"). They often claim to be calling from a friend's phone. In "digital arrest" scams they pose as police or CBI officers. People cannot tell a cloned voice from a real one.

**The idea.** Don't try to judge the voice. During a suspicious call, one tap on the parent's phone sends a fresh request to the **claimed person's own phone**. Only that person can answer, by unlocking their phone with their fingerprint or PIN, which signs a "Yes, it's me" or "NO, NOT ME" for that exact request. The parent's phone checks the signed answer itself and shows a clear verdict:

- **Green:** it's really them.
- **Red:** it's not them, or someone tampered with the answer.
- **Amber:** no answer yet, or the person can't be checked.

**Two roles** (one person can be both):

- **Checks only** (typically elderly parents, called "Maa" in examples). Adds family members and verifies callers. Needs no key.
- **Can be verified** (children and relatives a scammer might copy, called "Arjun" in examples). Has a key in their phone and answers requests.

**The core loop:**

1. Maa taps **Verify a caller**, picks **Arjun**, picks **Money ₹50,000**, taps **Ask Arjun's phone**.
2. The request travels to Arjun's phone (through a relay server that only passes messages).
3. Arjun's phone shows a full-screen question: _"Maa is asking: Are YOU on a call with her right now, asking for ₹50,000?"_ with two buttons, **NO, NOT ME** and **Yes, it's me**.
4. Arjun taps an answer and unlocks with his fingerprint or PIN; his key signs the request and the answer together.
5. The signed answer travels back.
6. Maa's phone runs **7 checks** on it.
7. Maa's phone shows the verdict.

**Personality:** calm, trustworthy, premium, warm, Indian without cliché. It should feel like a private bank's app crossed with a beautifully made family app. It must be easy for a 65-year-old in Hindi or English, and impressive to a security engineer.

## B2. Scope of this build

**Build:**

1. The family app: every screen in B12, sections A to I.
2. **Security Lab** (`/lab`): a laptop page that plays an attacker who controls the relay, with three attacks (section J1).
3. **Call Guard** (`/guard`): a laptop page that listens to a call on speakerphone and suggests verification (section J2).
4. **Diagnostics** (`/diagnostics`): a hidden phone screen for connection info and clearing data (section J3).
5. The service layer with **simulated** implementations and a **Simulation panel** inside Diagnostics.
6. PWA install, offline shell, English and Hindi, light and dark themes, full motion system, haptics and sounds.

**Do not build:**

- Real cryptography.
- A real relay server.
- Push notifications (stub only).
- Accounts or login.
- Any backend.

## B3. Stack and architecture

**Stack** (if your platform can't install a library, build the equivalent with standard web APIs and CSS):

| Need            | Use                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Framework       | React 18 + TypeScript + Vite                                                                             |
| Styling         | Tailwind CSS, driven by the CSS variables in B5 (no hard-coded colours in components)                    |
| Animation       | Motion (formerly Framer Motion), using `LazyMotion` + `domAnimation` to keep the bundle small            |
| Icons           | Phosphor Icons (`@phosphor-icons/react`); "regular" weight in UI, "duotone" for large illustrative icons |
| Routing         | React Router (all routes public; no auth guards)                                                         |
| Language        | i18next + react-i18next; `en` and `hi` resource files                                                    |
| Local storage   | IndexedDB via Dexie or idb (never localStorage for family data)                                          |
| QR code, create | `qrcode` or `qrcode.react`                                                                               |
| QR code, scan   | `qr-scanner` (uses the native BarcodeDetector when available, with a fallback) or `html5-qrcode`         |
| PWA             | `vite-plugin-pwa` (manifest + service worker)                                                            |
| Fonts           | Google Fonts: Anek Latin, Anek Devanagari, Mukta, JetBrains Mono (B5.3)                                  |

**Folder structure:**

```
src/
  app/            router, providers, theme, i18n setup, feature flags
  design/         tokens.css, motion.ts (tokens), haptics.ts, sounds.ts
  components/     shared UI (B12.0)
  screens/        one folder per area: setup/ home/ family/ verify/ answer/ alerts/ history/ settings/ help/ lab/ guard/ diagnostics/
  services/
    types.ts      all interfaces in B3 and B4
    index.ts      picks simulated or real implementations by flag
    sim/          SimRelay, SimKey, SimVerifier, SimGuard, SimLab
    real/         empty adapters with TODO comments (the team fills these)
  store/          Dexie database, repositories
  i18n/en.json, i18n/hi.json
```

**Feature flags** (in `src/app/flags.ts`, from environment variables with these defaults):

| Flag            | Default | Effect                                                        |
| --------------- | ------- | ------------------------------------------------------------- |
| `SIMULATION`    | `true`  | Uses `services/sim/*` and shows the "Simulated network" badge |
| `ENABLE_LAB`    | `true`  | The `/lab` route exists                                       |
| `ENABLE_GUARD`  | `true`  | The `/guard` route and the B2 banner exist                    |
| `ENABLE_EXTRAS` | `false` | Shows the optional screens A8, C9, D5, I6                     |

**Service interfaces.** Put these in `services/types.ts`. Screens only ever call these interfaces:

```ts
export type Unsubscribe = () => void;

export interface KeyService {
  checkSupport(): Promise<{
    passkeys: boolean;
    screenLock: "yes" | "no" | "unknown";
  }>;
  createKey(p: { deviceId: string; name: string }): Promise<{
    keyId: string;
    publicKey: string;
    safetyWords: [string, string, string, string];
  }>;
  // Opens the phone's own fingerprint/PIN prompt, then signs request + decision together.
  signAnswer(req: VerifyRequest, decision: Decision): Promise<SignedAnswer>;
  deleteKey(): Promise<void>;
}

export interface RelayService {
  connect(deviceId: string): void;
  onState(cb: (s: ConnectionState) => void): Unsubscribe;
  onPresence(cb: (reachableDeviceIds: string[]) => void): Unsubscribe;
  sendRequest(req: VerifyRequest): Promise<void>;
  onRequest(cb: (req: VerifyRequest) => void): Unsubscribe;
  sendAnswer(ans: SignedAnswer, toDeviceId: string): Promise<void>;
  onAnswer(cb: (ans: SignedAnswer) => void): Unsubscribe;
  sendAlert(alert: FamilyAlert, toDeviceIds: string[]): Promise<void>;
  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe;
  sendGuardPrompt(p: GuardPrompt, toDeviceId: string): Promise<void>;
  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe;
}

export interface VerifierService {
  // Runs the 7 checks. Never returns VERIFIED unless all 7 pass and decision === 'ME'.
  verify(
    req: VerifyRequest,
    ans: SignedAnswer,
    member: FamilyMember,
  ): Promise<VerdictResult>;
}

export interface CardService {
  toLink(card: FamilyCard): string; // https://<origin>/join#c=<base64url JSON>
  fromLink(urlOrText: string): FamilyCard; // throws CardError: 'not_pehchaan' | 'corrupt' | 'own_card'
}

export interface LabService {
  onTraffic(cb: (e: RelayEvent) => void): Unsubscribe;
  arm(attack: "change" | "replay" | "forge"): void;
  disarm(): void;
  setAttackerMode(on: boolean): void;
  onCounters(
    cb: (c: { attacks: number; falseGreens: number }) => void,
  ): Unsubscribe;
  reset(): void;
}

export interface GuardService {
  start(mode: "microphone" | "scripted"): Promise<void>;
  stop(): void;
  onTranscript(
    cb: (line: { text: string; final: boolean; at: number }) => void,
  ): Unsubscribe;
  onSignals(cb: (s: GuardSignals) => void): Unsubscribe;
}
```

**Simulated implementations (`services/sim/`).** These must behave exactly like the real thing, including every failure.

1. **SimRelay** uses a `BroadcastChannel('pehchaan-sim')`, so two browser tabs act as two phones and a third tab can be the Security Lab.
   - Add 250–600 ms of random latency per message.
   - Presence heartbeat every 2 s; a device counts as reachable if seen in the last 6 s.
   - Connection state can be forced to `reconnecting` or `offline` from the Simulation panel.
2. **Separate devices per tab.** In simulation mode, `?device=<name>` in the URL (for example `?device=maa`, `?device=arjun`) makes that tab use its own IndexedDB database (`pehchaan-<name>`) and its own device ID. Without the parameter, use `pehchaan-default`.
3. **SimKey:**
   - `createKey` waits 1.2 s (as if the fingerprint sheet were open), then returns a random `keyId` and `publicKey` and four safety words derived from a SHA-256 of the public key (use Web Crypto `crypto.subtle.digest`).
   - `signAnswer` shows the simulated unlock sheet (B12, F2).
   - It returns `signature = hex(SHA-256(keyId | requestId | nonce | decision | origin))` and `clientData = { requestId, nonce, decision, origin, type: 'answer' }`, with `userPresent` and `userVerified` both set to true.
4. **SimVerifier** runs the same 7 checks as the real verifier (B4, "The 7 checks") against the simulated signature and stores used nonces in IndexedDB.
   - It must return INVALID with the right reason when the Security Lab tampers with an answer:
     - decision changed → `changed`;
     - old answer reused → `reused`;
     - unknown key → `wrong_key`.
   - It must never return VERIFIED for a tampered answer.
   - Check 3 compares the request and decision recorded inside `clientData` with the ones the answer claims. Check 6 verifies the signature over `clientData`. So a changed decision fails check 3 and passes check 6, exactly as the real verifier behaves.
5. **Simulation panel** (in Diagnostics, simulation mode only). An "Auto-answer my requests" option, used to test on one device:
   - Off (a real person answers in another tab)
   - Answer NOT ME after 2 s
   - Answer YES after 2 s
   - Never answer
   - Tamper: changed
   - Tamper: reused
   - Tamper: wrong key

   Plus buttons to force the connection to Connected, Reconnecting or Offline.

6. **SimGuard:**
   - `scripted` mode plays the six call lines from B12 J2 at realistic timing.
   - `microphone` mode uses the Web Speech API (`webkitSpeechRecognition`, `lang: 'hi-IN'`, interim results) where available. Otherwise it shows "Live listening needs Chrome" and offers scripted mode.
7. **SimLab** listens to the same BroadcastChannel, shows every message, and when armed rewrites the next matching message (J1).

**Real implementations (`services/real/`).** Create empty classes implementing each interface, with `throw new Error('Not implemented: team-owned')` and a comment block describing what goes there (Part E). Never call them while `SIMULATION` is true.

## B4. Data model

```ts
export type Lang = "en" | "hi";
export type Role = "can_be_verified" | "checks_only";
export type AvatarColor =
  | "indigo"
  | "teal"
  | "saffron"
  | "rose"
  | "plum"
  | "slate";
export type Relation =
  | "son"
  | "daughter"
  | "mother"
  | "father"
  | "husband"
  | "wife"
  | "brother"
  | "sister"
  | "grandchild"
  | "other";
export type AskReason =
  | "money"
  | "otp"
  | "bank_details"
  | "install_app"
  | "nothing_yet";
export type Decision = "ME" | "NOT_ME";
export type Verdict =
  | "VERIFIED"
  | "DENIED"
  | "NO_RESPONSE"
  | "INVALID"
  | "UNKNOWN_PERSON";
export type InvalidReason =
  | "changed"
  | "reused"
  | "wrong_key"
  | "wrong_app"
  | "not_unlocked"
  | "bad_signature"
  | "expired";
export type ConnectionState = "connected" | "reconnecting" | "offline";

export interface Profile {
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  role: Role;
  keyId?: string;
  publicKey?: string;
  safetyWords?: [string, string, string, string];
  lang: Lang;
  hindiForm: "m" | "f" | "n"; // Hindi verb endings only (रहा/रही/रहे); 'n' = respectful plural
  theme: "system" | "light" | "dark";
  textSize: "normal" | "large" | "xlarge";
  reduceMotion: boolean;
  soundsOn: boolean;
  createdAt: number;
  setupComplete: boolean;
}

export interface FamilyCard {
  // what a QR code / family link carries
  v: 1;
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  canBeVerified: boolean;
  keyId?: string;
  publicKey?: string;
  safetyWords: [string, string, string, string];
}

export interface FamilyMember extends FamilyCard {
  id: string;
  label: string; // what I call them, e.g. "Arjun" or "Maa"
  relation: Relation;
  addedAt: number;
  addedBy: "in_person" | "family_link";
}

export interface VerifyRequest {
  requestId: string;
  nonce: string; // nonce: 32 random bytes, base64url
  fromDeviceId: string;
  fromLabel: string; // how the answerer knows the asker, resolved on the answerer's side
  fromName: string;
  toDeviceId: string;
  claimedLabel: string;
  reason?: AskReason;
  amountInr?: number;
  channel: "call";
  createdAt: number;
  expiresAt: number; // expiresAt = createdAt + 60_000
}

export interface SignedAnswer {
  requestId: string;
  nonce: string;
  decision: Decision;
  keyId: string;
  signature: string;
  clientData: string;
  userPresent: boolean;
  userVerified: boolean;
  answeredAt: number;
  fromDeviceId: string;
}

export interface CheckResult {
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  key: string;
  passed: boolean;
  detail?: string;
}

export interface VerdictResult {
  requestId: string;
  verdict: Verdict;
  invalidReason?: InvalidReason;
  noResponseReason?: "timeout" | "offline" | "relay_unreachable";
  checks: CheckResult[];
  memberId?: string;
  memberLabel: string;
  reason?: AskReason;
  amountInr?: number;
  elapsedMs?: number;
  confirmationWords?: [string, string];
  decidedAt: number;
}

export interface FamilyAlert {
  id: string;
  type: "impersonation" | "check_on";
  aboutLabel: string;
  victimLabel: string;
  victimPhone?: string;
  amountInr?: number;
  createdAt: number;
  read: boolean;
}

export interface HistoryEvent {
  id: string;
  kind: "checked" | "answered";
  personLabel: string;
  verdict?: Verdict;
  invalidReason?: InvalidReason;
  decision?: Decision;
  reason?: AskReason;
  amountInr?: number;
  at: number;
  checks?: CheckResult[];
  elapsedMs?: number;
}

export interface GuardSignals {
  claimedLabel?: string;
  amountInr?: number;
  tactics: Array<
    "identity" | "money" | "urgency" | "secrecy" | "otp" | "authority"
  >;
  stage: 0 | 1 | 2 | 3 | 4; // idle, claim, pressure, secrecy, money
}
export interface GuardPrompt {
  claimedLabel: string;
  amountInr?: number;
  tactics: GuardSignals["tactics"];
  at: number;
}

export interface RelayEvent {
  id: string;
  at: number;
  kind: "request" | "answer" | "alert" | "presence";
  from: string;
  to: string;
  summary: string;
  payload: unknown;
  tampered?: "change" | "replay" | "forge";
  verdictSeen?: Verdict;
}
```

**The 7 checks.** Plain-language labels are shown on screen in this order:

| #   | key         | English label (shown)             | Fails when                                                   |
| --- | ----------- | --------------------------------- | ------------------------------------------------------------ |
| 1   | `fresh`     | Fresh request, sent {n} s ago     | The nonce doesn't match a pending request, or it has expired |
| 2   | `key`       | Signed with {name}'s key          | The key isn't the one saved for this person                  |
| 3   | `exact`     | Answer matches this exact request | The request or decision was changed after signing            |
| 4   | `address`   | Made for this Pehchaan address    | The signature was made for a different website               |
| 5   | `unlocked`  | {name} unlocked their phone       | User presence or user verification is missing                |
| 6   | `signature` | Signature is genuine              | The signature doesn't verify                                 |
| 7   | `unused`    | This answer wasn't used before    | The nonce was already used                                   |

**Mapping the checks to a verdict:**

| Outcome                                          | Verdict                         |
| ------------------------------------------------ | ------------------------------- |
| All 7 pass, decision ME                          | **VERIFIED**                    |
| All 7 pass, decision NOT_ME                      | **DENIED** (a genuine "not me") |
| Any check fails                                  | **INVALID**, with a reason      |
| No answer in 60 s, offline, or relay unreachable | **NO_RESPONSE**                 |
| Claimed person not in the family list            | **UNKNOWN_PERSON**              |

**INVALID reasons:**

| Failing check | Reason                                      |
| ------------- | ------------------------------------------- |
| 3             | `changed`                                   |
| 1 or 7        | `reused` (or `expired` if the time ran out) |
| 2             | `wrong_key`                                 |
| 4             | `wrong_app`                                 |
| 5             | `not_unlocked`                              |
| 6             | `bad_signature`                             |

**Seed data** (created only when a simulation device name is `maa` or `arjun` and the database is empty; this is what the builder's preview shows):

- `?device=maa`: Profile **Sunita Sharma**, role checks only, language English, hindiForm `f`, phone "+91 98xxx xxx21", colour rose. Family:
  - **Arjun** (son, can be verified, phone "+91 98xxx xxx10", indigo, safety words TIGER · MANGO · RIVER · LAMP);
  - **Priya** (daughter, can be verified, teal);
  - **Ramesh** (husband, checks only, saffron).
- `?device=arjun`: Profile **Arjun Sharma**, role can be verified, key created, indigo, hindiForm `m`. Family:
  - **Maa** (mother, checks only, rose, phone "+91 98xxx xxx21");
  - **Priya** (sister).
- History for Maa: two past events (one VERIFIED Priya 3 days ago; one DENIED "Arjun" 12 days ago, ₹20,000).
- Device IDs must match across the two seeds so the tabs can talk to each other.

## B5. Design system

### B5.1 Direction: "Neel and brass"

The look comes from two things India has trusted for centuries: **neel** (indigo dye) and a **brass seal** pressed onto an official document. The seal is the brand metaphor. A verdict is Pehchaan "stamping" an answer as genuine or not.

- Surfaces are calm and uncluttered: deep midnight ink in dark mode, cool porcelain in light mode.
- Indigo is the single brand colour. Brass appears only on the seal and a few premium details.
- Green, red and amber are **reserved for verdicts** and never used decoratively.
- It must **not** look like a generic AI app:
  - no purple-to-blue gradient heroes;
  - no neon;
  - no glassmorphism everywhere;
  - no emoji as icons;
  - no stock photos of hackers or padlocks;
  - no warm cream backgrounds with terracotta.

### B5.2 Colour tokens

Define every token as a CSS variable on `:root` (light) and `[data-theme="dark"]` plus `@media (prefers-color-scheme: dark)` when the theme setting is "system". Components use tokens only.

| Token            | Light                                                                         | Dark                                                                            | Use                                                       |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `--bg`           | `#F5F6FB` porcelain                                                           | `#0A0E1F` midnight ink                                                          | App background                                            |
| `--bg-glow`      | `radial-gradient(120% 60% at 50% -10%, rgba(58,69,214,.10), transparent 60%)` | `radial-gradient(120% 60% at 50% -10%, rgba(140,149,255,.16), transparent 60%)` | Soft glow at the top of main screens                      |
| `--surface`      | `#FFFFFF`                                                                     | `#121834`                                                                       | Cards, sheets                                             |
| `--surface-2`    | `#EEF0F8`                                                                     | `#1A2146`                                                                       | Inputs, pressed states, secondary cards                   |
| `--ink`          | `#0F1430`                                                                     | `#EEF0FF`                                                                       | Primary text                                              |
| `--ink-2`        | `#454B6B`                                                                     | `#C3C8E8`                                                                       | Secondary text                                            |
| `--muted`        | `#6B7194`                                                                     | `#8D94BC`                                                                       | Hints, captions                                           |
| `--line`         | `#DDE1EF`                                                                     | `#262E5A`                                                                       | Borders, dividers                                         |
| `--brand`        | `#3A45D6` neel indigo                                                         | `#8C95FF`                                                                       | Primary buttons, links, focus, active tab                 |
| `--brand-strong` | `#2A33B0`                                                                     | `#B3B9FF`                                                                       | Pressed primary                                           |
| `--brand-soft`   | `#E6E8FF`                                                                     | `#1F2660`                                                                       | Selected chips, info banners                              |
| `--on-brand`     | `#FFFFFF`                                                                     | `#0A0E1F`                                                                       | Text on brand                                             |
| `--brass`        | `#B8904A`                                                                     | `#D9B874`                                                                       | Seal ring, premium hairlines, 1–2 uses per screen at most |
| `--brass-soft`   | `#F3EAD8`                                                                     | `#2A2414`                                                                       | Seal backgrounds                                          |
| `--focus`        | `#3A45D6`                                                                     | `#B3B9FF`                                                                       | 2px focus ring, 2px offset                                |

**Verdict colours.** These are identical in both themes. Full-screen verdicts use a vertical gradient; body text always sits on the darker part.

| Verdict                      | Gradient (top → bottom)                                    | Base (text contrast) | Text      | Used for                    |
| ---------------------------- | ---------------------------------------------------------- | -------------------- | --------- | --------------------------- |
| Confirmed                    | `#12A35C → #065C34`                                        | `#087A45`            | `#FFFFFF` | VERIFIED                    |
| Not them                     | `#E5463A → #8E1B12`                                        | `#C4291C`            | `#FFFFFF` | DENIED                      |
| Fake answer                  | `#8E1B12 → #4A0C07`, plus a 45° hairline hatch at 6% white | `#8E1B12`            | `#FFFFFF` | INVALID                     |
| Not confirmed / can't verify | `#FDB022 → #E07A0B`                                        | `#F79009`            | `#1F1300` | NO_RESPONSE, UNKNOWN_PERSON |
| Waiting                      | `#3A45D6 → #1E2380`                                        | `#2A33B0`            | `#FFFFFF` | Waiting screen              |

Small verdict chips (history, Lab log) use the base colour at 14% opacity for the background and the base colour for text (in dark mode, a 20% lighter tint of the base for text).

**Avatar colours:** indigo `#3A45D6`, teal `#0E7C86`, saffron `#E07B39`, rose `#D1437A`, plum `#7A4FC4`, slate `#52607A`. Initials are white, 600 weight.

Every text/background pair must meet WCAG AA: 4.5:1 for body, 3:1 for text 24px and larger. Check each pair above. If the platform's defaults differ, the tokens win.

### B5.3 Typography

| Role                                 | Font                                                   | Weight          | Notes                                                                     |
| ------------------------------------ | ------------------------------------------------------ | --------------- | ------------------------------------------------------------------------- |
| Display and headings                 | **Anek Latin** (English) / **Anek Devanagari** (Hindi) | 600–700         | Slightly condensed, confident; tight tracking (−0.01em) on 28px and above |
| Body and UI                          | **Mukta** (covers Latin and Devanagari)                | 400 / 500 / 700 | Very readable for older users                                             |
| Numbers, codes, timers, safety words | **JetBrains Mono**                                     | 500–600         | `font-variant-numeric: tabular-nums`                                      |

Fallbacks: `system-ui, "Noto Sans Devanagari", sans-serif` and `ui-monospace, monospace`.

**Type scale (mobile).** Body is deliberately large for elderly users.

| Token     | Size / line height | Use                                                       |
| --------- | ------------------ | --------------------------------------------------------- |
| `display` | 36 / 42            | Verdict headline, splash                                  |
| `h1`      | 28 / 34            | Screen titles                                             |
| `h2`      | 22 / 28            | Section titles                                            |
| `h3`      | 19 / 26            | Card titles                                               |
| `body`    | 17 / 26            | Default text                                              |
| `body-sm` | 15 / 22            | Secondary text                                            |
| `caption` | 13 / 18            | Labels (uppercase + 0.06em tracking only for tiny labels) |
| `mono-lg` | 22 / 28            | Countdown, amount                                         |
| `mono`    | 15 / 22            | Safety words, codes                                       |

**Text size setting.** Large multiplies every size by 1.1; Extra large by 1.22. Layouts must reflow without clipping at Extra large.

Headings use `text-wrap: balance`. Hindi text needs about 8% more line height; use `:lang(hi)` to adjust.

### B5.4 Layout, spacing, shape, elevation

- **Mobile first,** 360–430px wide.
  - On wider screens the family app sits in a centred column, max 480px, with the background glow filling the rest.
  - `/lab` and `/guard` are laptop layouts (min 1024px wide, but still usable at 768px).
- **Spacing:** a 4-pt scale (4, 8, 12, 16, 20, 24, 32, 40, 56). Screen side padding is 20px.
- **Safe areas:** respect `env(safe-area-inset-*)`. The bottom tab bar and bottom action buttons add the bottom inset.
- **Radii:** 12 (inputs, chips); 18 (cards); 24 (sheets, big tiles); 28 (primary big buttons); full (pills, avatars).
- **Elevation, light mode:**
  - `shadow-1`: `0 1px 2px rgba(15,20,48,.06), 0 4px 14px rgba(15,20,48,.06)`
  - `shadow-2`: `0 18px 40px rgba(15,20,48,.14)`
- **Elevation, dark mode:** no shadows; use `--surface`/`--surface-2` plus a 1px inner border `rgba(255,255,255,.06)`.
- **Texture:** a 2–3% opacity noise overlay on `--bg` (tiny inline SVG noise) for a premium, non-flat feel. None on verdict screens except the Fake-answer hatch.
- **Touch targets:** at least 48×48px. Primary actions are 56px tall; the Verify button on Home is at least 120px tall.

### B5.5 Brand mark, icons, illustrations

**The seal (brand mark).** Build it as an SVG component `<Seal size state>`:

- an outer ring in 2px solid `--brass`;
- an inner ring in 1px dashed `--brand` (4 dash, 3 gap);
- the Devanagari letter **प** centred in Anek Devanagari 700, `--brand`.

The wordmark reads "Pehchaan" (Anek Latin 600), with a smaller "पहचान" underneath.

**Seal states used by verdicts:**

- `confirmed`: white rings, and the letter replaced by a check mark drawn with stroke animation.
- `denied`: an ✕ drawn with stroke.
- `fake`: a shield with ✕.
- `waiting`: rings slowly rotate in opposite directions.
- `unknown`: a question mark.
- `clock`: for no-response.

**Icons.** Phosphor, regular weight, 24px default, 1.5px optical stroke. Duotone weight for the big illustrative icons (lock, key, shield, users, phone-call).

**Illustrations.** Build them in-app from SVG shapes, not images:

- a waveform that morphs into the seal;
- two phones connected by a dotted arc;
- a key sliding into a vault ring;
- a shield.

Use the colours `--brand`, `--brass` and `--ink-2` only.

**App icon and splash.** The seal on `#0A0E1F` for the dark icon and on `#3A45D6` for the maskable icon. Sizes: 192, 512 and 512 maskable. The splash background is `#0A0E1F`.

## B6. Motion system

Motion should feel **calm, weighty and precise**, like a heavy brass seal pressed onto paper. Never bouncy or toy-like. Every animation has a purpose: showing where something came from, what changed, or that the system is working.

### B6.1 Tokens (`src/design/motion.ts`)

| Token          | Value                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| `dur.instant`  | 90 ms                                                                      |
| `dur.fast`     | 160 ms                                                                     |
| `dur.base`     | 240 ms                                                                     |
| `dur.slow`     | 380 ms                                                                     |
| `dur.verdict`  | 650 ms                                                                     |
| `ease.out`     | `cubic-bezier(0.22, 1, 0.36, 1)`                                           |
| `ease.inOut`   | `cubic-bezier(0.65, 0, 0.35, 1)`                                           |
| `spring.ui`    | stiffness 420, damping 34, mass 0.9 (buttons, chips, tabs)                 |
| `spring.soft`  | stiffness 220, damping 26 (sheets, cards, page elements)                   |
| `spring.stamp` | stiffness 520, damping 22 (the seal press)                                 |
| `stagger`      | 45 ms between list items (max 8 items staggered; the rest appear together) |

**Performance rules:**

- Animate only `transform` and `opacity` (plus `clip-path` for the verdict reveal and SVG `stroke-dashoffset` for drawn lines).
- Never animate width, height, top or left.
- Use `will-change` only during an animation.
- Target 60 fps on a mid-range Android phone.

### B6.2 Global transitions

- **Forward navigation:** the new screen enters from `x: 28px, opacity 0` to `x: 0, opacity 1` (`dur.base`, `ease.out`). The old screen exits to `x: -12px, opacity 0` (`dur.fast`).
- **Back navigation:** the mirror image.
- **Tab switches:** crossfade only (`dur.fast`). The active-tab indicator is a pill that slides between tabs using a shared `layoutId` (`spring.ui`).
- **Sheets and dialogs:** rise from `y: 100%` with `spring.soft`. The backdrop fades to `rgba(10,14,31,.45)` with a `blur(8px)`. Drag down to dismiss with velocity-aware close, except for sheets that must not be dismissed accidentally (B9).
- **Full-screen takeovers** (incoming request, verdicts): circular clip-path reveal from the origin point (the tapped button, or the screen centre for incoming requests), `dur.verdict`, `ease.inOut`.
- **Shared elements:** a family member's avatar and name morph from the list row into the detail header, and from the D1 tile into the waiting screen (`layoutId`).
- **Toasts:** drop in from the top with `spring.soft` and auto-dismiss after 3.5 s with a fade. Swipe up to dismiss.

### B6.3 Components

- **Buttons:**
  - Press: scale 0.97 (`dur.instant`), release with `spring.ui`.
  - Primary buttons have a soft inner highlight that shifts 2px on press.
  - Disabled buttons don't animate.
- **Chips:** selection fills from the centre (scale 0.9 → 1 on the fill layer) and the text colour crossfades.
- **Cards and list rows:** appear with `y: 8px → 0, opacity 0 → 1`, staggered. Press state is scale 0.985.
- **Connection pill:** colour crossfades between states. "Reconnecting" shows three dots pulsing in sequence. "Offline" slides a small ✕ in.
- **Amount input:** digits roll vertically when they change (each digit is its own column). Indian grouping commas slide into place.
- **Countdown ring:** an SVG ring that depletes smoothly (not per second). The number ticks with a subtle vertical roll. In the last 10 s the ring turns amber.
- **Skeletons:** a soft shimmer (a gradient sweep, 1.4 s) only where data loads for more than 300 ms.
- **Pull to refresh (History):** the seal rotates with pull distance and presses when released.

### B6.4 Signature moments

These are the moments people remember. Build them with care.

1. **Launch (splash, at most 1.1 s):**
   - The seal's outer brass ring draws clockwise (stroke, 500 ms).
   - The inner dashed ring fades in and rotates 20°.
   - "प" scales from 0.8 to 1 and fades in.
   - The wordmark fades up.
   - It then shrinks into its position in the next screen's header (shared element) if that screen shows the seal.
2. **Onboarding card 1:**
   - A live audio waveform (12 bars animating at different phases) sits beside the headline.
   - On "Next" it morphs into the seal (the bars collapse into the ring), expressing "voices can be copied, the seal can't".
   - Card changes use a parallax: the illustration moves 1.5× the text.
3. **Creating the key (A6):**
   - A large key icon slides into a vault ring.
   - The ring locks with a 30° rotation click and a light haptic.
   - The success check draws, and the four safety words flip in one by one (`rotateX 90° → 0`, staggered 80 ms).
4. **QR reveal (C3):**
   - QR modules appear from the centre outward in a quick ripple (400 ms).
   - A brass hairline frame draws around the code.
   - Every 6 s a single light sweep glides across the code to show it's live.
5. **Scanning (C4):**
   - Corner brackets breathe (scale 1 → 1.03).
   - A soft scan line glides top to bottom.
   - On success, the brackets snap to the code's bounds (`spring.ui`), a check bursts from the centre, and the camera view crossfades to the confirm screen with the member's avatar growing from the code's position.
6. **Verify button (Home):**
   - Idle breathing: every 3.2 s, scale 1 → 1.012 with the inner glow rising 10%.
   - On press, the button's colour becomes the origin of the D1 screen's circular reveal.
7. **Waiting (D3):**
   - Maa's avatar (left) and Arjun's avatar (right) are connected by a dotted arc.
   - A glowing dot travels along the arc from Maa to Arjun (1.1 s, `ease.inOut`, looping while waiting). Arjun's avatar gets a gentle pulse ring each time the dot arrives.
   - When the answer arrives, the dot travels back **once**, faster, then the verdict reveal starts from Maa's avatar.
   - The countdown ring sits behind Arjun's avatar.
8. **The verdict (E1–E5), the most important animation in the product.** Total about 1 s:
   1. The verdict colour floods the screen as a circular clip-path reveal from the origin (`dur.verdict`, `ease.inOut`).
   2. At 60% of the reveal, the seal **stamps** in: it starts at scale 1.35, rotation −8°, opacity 0, and presses to scale 1, rotation 0 with `spring.stamp`. When it lands, a single soft "ink ring" ripple expands from the seal and fades (500 ms). A haptic fires at the moment of impact (B7).
   3. The icon inside the seal draws with a stroke animation (check, ✕, shield or clock) over 300 ms.
   4. The headline rises 12px and fades in (80 ms after impact), then the body text, then the buttons, staggered 60 ms.
   5. Per-verdict detail:
      - **Confirmed:** one slow light sweep across the seal (brass sheen), then stillness.
      - **Not them:** a firm 2-cycle horizontal shake of the seal only (±6px, 260 ms), never the whole screen.
      - **Fake answer:** a 180 ms "glitch" on the seal (RGB-split offset of 2px, two frames), then it settles into the shield. The hatch texture fades in behind.
      - **Not confirmed:** the clock hand in the seal sweeps once, slowly.
      - **Can't verify:** the question mark rocks once (±4°).
9. **Why? sheet (E6).** The sheet rises; each of the 7 checks appears with a 70 ms stagger. Each tick draws (stroke, 220 ms). A failed check draws a red ✕ and its row tints red, with a tiny 4px shake. The timing line ("Answered in 3.8 s") counts up from 0.
10. **Incoming request (F1):**
    - A full-screen takeover rises with a circular reveal from the screen centre, over a backdrop blur of whatever was open.
    - The asker's avatar has a heartbeat pulse ring (two beats, pause, repeat) until the person answers.
    - A thin countdown bar at the top depletes smoothly.
    - The **NO, NOT ME** button has a very subtle glow breathing.
    - After a tap, both buttons except the chosen one fade out, and the chosen one expands slightly while the unlock sheet (F2) rises.
11. **Answer sent (F3):** the chosen answer compresses into a small sealed envelope shape that flies along an arc toward the top edge (to Maa), then the confirmation text appears.
12. **Family alert (G1):** it arrives as a top banner that drops with `spring.soft` and a brief red edge glow, not a full-screen takeover.

### B6.5 Laptop pages

- **Security Lab:**
  - A horizontal pipeline shows three nodes (Maa's phone → Relay → Arjun's phone). Messages travel as small labelled capsules along the lines (700 ms).
  - When an attack is armed, the Relay node turns red with a slow-moving static-noise texture and a "controlled by attacker" label.
  - A tampered capsule visibly **mutates** in the Relay node: for "Change the next answer" the label "NOT ME" flips to "ME" with a glitch; "Replay" shows a ghost copy from history; "Forge" shows a capsule with a different key colour.
  - On arrival at Maa's node, a shield flashes up and the capsule **bounces off and shatters** into small fragments (8–12 particles, 500 ms), and "Rejected: {reason}" appears.
  - The counters roll up.
- **Call Guard:**
  - A live waveform (canvas, 30 fps is fine).
  - Transcript words appear with a soft fade as they're recognised.
  - Tactic chips pop in (scale 0.8 → 1, `spring.ui`) when detected.
  - The stage bar fills segment by segment.
  - When the prompt is sent, a capsule flies from the page toward a phone icon.

### B6.6 Reduced motion

When `prefers-reduced-motion: reduce` is set, or "Reduce motion" is on in Settings:

- Replace every movement with a 120 ms crossfade.
- No shakes, pulses, breathing, particles, parallax or glitch.
- The verdict still shows its colour, seal and text, just without the reveal and stamp.
- Countdowns still count.

## B7. Haptics and sound

**Haptics** use `navigator.vibrate`, supported on Android only. Wrap every call in feature detection. Patterns are in milliseconds:

| Event                        | Pattern                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| Button press (primary only)  | `[8]`                                                      |
| Chip select                  | `[5]`                                                      |
| Incoming request             | `[220, 120, 220, 900]`, repeated until answered or expired |
| Confirmed                    | `[40, 40, 60]`                                             |
| Not them                     | `[260, 120, 260]`                                          |
| Fake answer                  | `[70, 50, 70, 50, 70]`                                     |
| Not confirmed / can't verify | `[140]`                                                    |
| Key created / member added   | `[30, 60, 30]`                                             |
| Error                        | `[120, 80, 120]`                                           |

**Sounds** are generated with the Web Audio API (no audio files needed). They're on by default and there's a Settings toggle. Browsers require a user gesture before sound, so unlock audio on the first tap anywhere.

| Event                  | Sound                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Incoming request       | A two-note soft chime (E5 → B5, 160 ms each, sine + a little triangle), repeated every 2 s |
| Confirmed              | A rising major third (C5 → E5), gentle                                                     |
| Not them / Fake answer | Two low notes (A3, A3), firm but not alarming                                              |
| Not confirmed          | A single mid note (G4)                                                                     |

**Screen wake lock:** request `navigator.wakeLock.request('screen')` while on D3 (waiting) and F1 (incoming request). Release it on leaving. Ignore failures.

## B8. Copy, language and tone

**Voice:**

- Plain, warm, respectful and short.
- Speak like a calm, knowledgeable family member.
- Never blame the user, and never use technical jargon on family screens.

**Rules:**

- Never write "safe", "100% secure", "AI-powered", "hacker-proof", "demo", "mock" or "test" on family screens. The only verdict words are **Confirmed**, **Not {name}**, **Fake answer**, **Not confirmed yet** and **Can't verify**.
- Buttons say exactly what happens ("Ask Arjun's phone", not "Submit").
- Errors say what happened and what to do next.
- Numbers:
  - Rupees use Indian grouping via `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`, which gives ₹50,000 and ₹1,00,000. Use Latin digits in both languages.
  - Phone numbers always show as selectable text and link with `tel:`.
- Names are dynamic. Use the label the user saved ("Arjun", "Maa"), never a hard-coded name. Handle Hindi grammar with i18next interpolation.
- **Hindi gender forms:** Hindi verbs change with the person addressed (रहा / रही / रहे).
  - A4 asks "How should Hindi address you?" with three options: पुरुष / महिला / बताना नहीं (male / female / prefer not to say), stored as `hindiForm`.
  - Use i18next context keys (`key_m`, `key_f`); `n` falls back to the respectful plural (रहे हैं).
  - Where a neutral phrasing exists (for example "{{asker}} का सवाल"), prefer it.

**Key strings.** Create full `en.json` and `hi.json`. The Hindi below is a starting point; mark `hi.json` for review by a native speaker.

| Key                                    | English                                                                                        | Hindi                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| app.name                               | Pehchaan                                                                                       | पहचान                                                                                      |
| app.tagline                            | Check it's really them.                                                                        | पक्का करें कि सच में वही हैं।                                                              |
| lang.title                             | Choose your language                                                                           | अपनी भाषा चुनें                                                                            |
| welcome.1.title                        | Voices can be copied. Phones can't.                                                            | आवाज़ की नकल हो सकती है। फ़ोन की नहीं।                                                     |
| welcome.1.body                         | A scammer can sound exactly like your son. They can't unlock his phone.                        | ठग बिल्कुल आपके बेटे जैसी आवाज़ निकाल सकता है, पर उसका फ़ोन अनलॉक नहीं कर सकता।            |
| welcome.2.title                        | During a suspicious call, tap Verify.                                                          | शक वाली कॉल आए, तो "जाँचें" दबाएँ।                                                         |
| welcome.2.body                         | Pehchaan asks their own phone if it's really them.                                             | पहचान उनके अपने फ़ोन से पूछता है कि क्या सच में वही हैं।                                   |
| welcome.3.title                        | Red means don't pay. Green means it's really them.                                             | लाल यानी पैसे न भेजें। हरा यानी सच में वही हैं।                                            |
| welcome.3.body                         | Family rule: no green, no money.                                                               | परिवार का नियम: हरा नहीं, तो पैसा नहीं।                                                    |
| name.title                             | What's your name?                                                                              | आपका नाम क्या है?                                                                          |
| name.phone                             | Phone number (optional)                                                                        | फ़ोन नंबर (ज़रूरी नहीं)                                                                    |
| role.title                             | Could someone pretend to be you?                                                               | क्या कोई आपकी नकल करके ठगी कर सकता है?                                                     |
| role.yes                               | Yes, set up my key                                                                             | हाँ, मेरी चाबी बनाएँ                                                                       |
| role.yes.hint                          | For anyone a scammer might copy: children, relatives.                                          | उनके लिए जिनकी नकल हो सकती है: बच्चे, रिश्तेदार।                                           |
| role.no                                | No, I only check others                                                                        | नहीं, मुझे सिर्फ़ दूसरों की जाँच करनी है                                                   |
| role.no.hint                           | Good for parents and grandparents.                                                             | माता-पिता और दादा-दादी के लिए।                                                             |
| key.title                              | Create your key                                                                                | अपनी चाबी बनाएँ                                                                            |
| key.body                               | It stays inside this phone. You unlock it with your fingerprint or PIN.                        | यह चाबी इसी फ़ोन में रहती है। इसे आप फ़िंगरप्रिंट या पिन से खोलते हैं।                     |
| key.cta                                | Create my key                                                                                  | मेरी चाबी बनाएँ                                                                            |
| key.done                               | Your key is ready. It never leaves this phone.                                                 | आपकी चाबी तैयार है। यह इस फ़ोन से बाहर नहीं जाती।                                          |
| done.title                             | You're set up                                                                                  | सब तैयार है                                                                                |
| done.body                              | Now add your family. Do it together, in person.                                                | अब अपने परिवार को जोड़ें। यह साथ बैठकर, आमने-सामने करें।                                   |
| home.verify                            | Verify a caller                                                                                | कॉल करने वाले की जाँच करें                                                                 |
| home.verify.hint                       | Tap during a suspicious call                                                                   | शक वाली कॉल के दौरान दबाएँ                                                                 |
| home.family                            | Your family                                                                                    | आपका परिवार                                                                                |
| home.rule                              | Family rule: no green, no money.                                                               | परिवार का नियम: हरा नहीं, तो पैसा नहीं।                                                    |
| conn.connected                         | Connected                                                                                      | जुड़ा हुआ                                                                                  |
| conn.reconnecting                      | Reconnecting…                                                                                  | फिर से जुड़ रहा है…                                                                        |
| conn.offline                           | Offline                                                                                        | ऑफ़लाइन                                                                                    |
| family.add                             | Add family member                                                                              | परिवार का सदस्य जोड़ें                                                                     |
| family.show                            | Show my code                                                                                   | मेरा कोड दिखाएँ                                                                            |
| family.scan                            | Scan their code                                                                                | उनका कोड स्कैन करें                                                                        |
| family.inperson                        | Do this together, in person. That's what makes it safe.                                        | यह साथ बैठकर, आमने-सामने करें। इसी से यह भरोसेमंद बनता है।                                 |
| family.words                           | Safety words                                                                                   | सुरक्षा शब्द                                                                               |
| family.words.ask                       | Does {{name}}'s phone show these words?                                                        | क्या {{name}} के फ़ोन पर यही शब्द दिख रहे हैं?                                             |
| family.words.yes                       | Yes, they match                                                                                | हाँ, मेल खाते हैं                                                                          |
| verify.who                             | Who does the caller say they are?                                                              | कॉल करने वाला ख़ुद को कौन बता रहा है?                                                      |
| verify.someone                         | Someone else                                                                                   | कोई और                                                                                     |
| verify.official                        | Police, bank or government                                                                     | पुलिस, बैंक या सरकारी अधिकारी                                                              |
| verify.what                            | What are they asking for?                                                                      | वे क्या माँग रहे हैं?                                                                      |
| reason.money                           | Money                                                                                          | पैसे                                                                                       |
| reason.otp                             | OTP or code                                                                                    | OTP या कोड                                                                                 |
| reason.bank                            | Bank or card details                                                                           | बैंक या कार्ड की जानकारी                                                                   |
| reason.app                             | Install an app                                                                                 | कोई ऐप डलवाना                                                                              |
| reason.none                            | Nothing yet                                                                                    | अभी कुछ नहीं                                                                               |
| verify.ask                             | Ask {{name}}'s phone                                                                           | {{name}} के फ़ोन से पूछें                                                                  |
| wait.title                             | Asking {{name}}'s phone…                                                                       | {{name}} के फ़ोन से पूछ रहे हैं…                                                           |
| wait.say                               | Tell the caller: "Please hold for a minute."                                                   | कॉल करने वाले से कहें: "एक मिनट रुकिए।"                                                    |
| wait.calm                              | Scammers rush. Real emergencies can wait a minute.                                             | ठग जल्दबाज़ी कराते हैं। असली मुसीबत एक मिनट रुक सकती है।                                   |
| v.ok.title                             | Confirmed                                                                                      | पुष्टि हुई                                                                                 |
| v.ok.body                              | It's really {{name}}.                                                                          | यह सच में {{name}} ही हैं।                                                                 |
| v.denied.title                         | Not {{name}}                                                                                   | यह {{name}} नहीं हैं                                                                       |
| v.denied.body                          | {{name}}'s own phone says this is not them. Do not send money.                                 | {{name}} के अपने फ़ोन ने बताया कि यह वे नहीं हैं। पैसे न भेजें।                            |
| v.none.title                           | Not confirmed yet                                                                              | अभी पुष्टि नहीं हुई                                                                        |
| v.none.body                            | {{name}} hasn't answered. Don't pay until they do.                                             | {{name}} ने अभी जवाब नहीं दिया। जवाब आने तक पैसे न भेजें।                                  |
| v.fake.title                           | Fake answer                                                                                    | नकली जवाब                                                                                  |
| v.fake.body                            | Someone tried to fake {{name}}'s answer. Do not trust this call.                               | किसी ने {{name}} का जवाब नकली बनाने की कोशिश की। इस कॉल पर भरोसा न करें।                   |
| v.unknown.title                        | Can't verify                                                                                   | जाँच संभव नहीं                                                                             |
| v.unknown.body                         | This person isn't in your family list, so we can't check them. Treat the caller as unverified. | यह व्यक्ति आपकी परिवार सूची में नहीं है, इसलिए जाँच नहीं हो सकती। इस कॉल को संदिग्ध मानें। |
| v.why                                  | Why?                                                                                           | क्यों?                                                                                     |
| v.say                                  | What to say to the caller                                                                      | कॉल करने वाले से क्या कहें                                                                 |
| v.say.line                             | "I'll call you back on your usual number."                                                     | "मैं आपके पुराने नंबर पर वापस फ़ोन करती/करता हूँ।"                                         |
| ask.title                              | {{asker}} is asking                                                                            | {{asker}} का सवाल                                                                          |
| ask.q.money                            | Are YOU on a call with them right now, asking for {{amount}}?                                  | क्या आप अभी उनसे फ़ोन पर {{amount}} माँग रहे हैं? (`_f`: माँग रही हैं)                     |
| ask.no                                 | NO, NOT ME                                                                                     | नहीं, मैं नहीं                                                                             |
| ask.yes                                | Yes, it's me                                                                                   | हाँ, मैं ही हूँ                                                                            |
| sent.no.title                          | We told {{asker}} it's not you                                                                 | हमने {{asker}} को बता दिया कि यह आप नहीं हैं                                               |
| sent.no.body                           | Someone may be pretending to be you. Call {{asker}} now.                                       | कोई आपके नाम से ठगी की कोशिश कर रहा है। अभी {{asker}} को फ़ोन करें।                        |
| official.title                         | Real police never arrest anyone over a video call                                              | असली पुलिस कभी वीडियो कॉल पर गिरफ़्तारी नहीं करती                                          |
| official.helpline                      | Cyber helpline: 1930                                                                           | साइबर हेल्पलाइन: 1930                                                                      |
| alert.imp.title                        | Someone pretended to be {{about}}                                                              | किसी ने {{about}} बनकर कॉल किया                                                            |
| common.done                            | Done                                                                                           | ठीक है                                                                                     |
| common.cancel                          | Cancel                                                                                         | रद्द करें                                                                                  |
| common.retry                           | Try again                                                                                      | फिर से कोशिश करें                                                                          |
| tab.home / family / history / settings | Home / Family / History / Settings                                                             | होम / परिवार / इतिहास / सेटिंग्स                                                           |

The Hindi "say" line (v.say.line) is gendered; choose the form from the user's profile or show the neutral version "मैं आपको पुराने नंबर पर वापस फ़ोन करूँगा/करूँगी". The team will finalise gendered forms.

## B9. Global UX and safety rules

These are non-negotiable.

1. **No green without all 7 checks.** Only `VerifierService` can produce VERIFIED. No screen can show green based on anything else.
2. **Amber never turns green by itself.** A late answer after NO*RESPONSE opens a \_new* verdict screen only if its nonce is still valid (it isn't, after expiry), so it shows as "Request expired" on the answerer's side.
3. **Verdict screens can't be dismissed accidentally.** No swipe-to-dismiss, no tap-outside, and the Android back gesture shows "Close this result?" with Close and Stay buttons (built in the page, not a browser dialog). They close only with an explicit button.
4. **Answering always needs an unlock** (F2), including for NO, NOT ME.
5. **Requests expire after 60 s.**
6. **Silence, offline and errors fail closed.** They lead to amber "Not confirmed yet", never green.
7. **Never auto-fill a family member from a call.** The user picks who the caller claims to be (or taps the Call Guard banner, which shows who was claimed and still needs a tap).
8. **Calls to action for phoning someone always show the number as text** alongside a `tel:` link.
9. **One primary action per screen,** at the bottom within thumb reach.
10. **No blocking browser dialogs** (`alert`, `confirm`, `prompt`). All confirmations are in-page.

## B10. Accessibility

- WCAG 2.2 AA contrast for every text/background pair in both themes and on every verdict colour.
- All interactive elements are reachable by keyboard with a visible focus ring (`--focus`, 2px, offset 2px).
- Screen-reader labels on every icon button.
- Verdicts are announced with `aria-live="assertive"`, for example "Not Arjun. Arjun's own phone says this is not him. Do not send money."
- Never rely on colour alone: every verdict has an icon inside the seal, a word headline and a colour.
- Text size setting (Large, Extra large) plus the browser's text scaling; nothing clips at 200% zoom.
- Honour `prefers-reduced-motion` and the in-app "Reduce motion" toggle (B6.6).
- Hindi pages set `lang="hi"`; English pages `lang="en"`.
- Minimum body text 17px. Tap targets at least 48px.

## B11. Routes and navigation

**Tab bar** (visible on Home, Family, History and Settings only): Home · Family · History · Settings. Use a floating pill bar with a sliding active indicator.

| Route                        | Screen ID | Notes                                                     |
| ---------------------------- | --------- | --------------------------------------------------------- |
| `/`                          | A0 Splash | Decides where to go (B12 A0)                              |
| `/install`                   | A1        | Browser only, not in installed mode                       |
| `/setup/language`            | A2        |                                                           |
| `/setup/welcome`             | A3        |                                                           |
| `/setup/name`                | A4        |                                                           |
| `/setup/role`                | A5        |                                                           |
| `/setup/key`                 | A6        | Can-be-verified only                                      |
| `/setup/done`                | A7        |                                                           |
| `/setup/notifications`       | A8        | Only with `ENABLE_EXTRAS`                                 |
| `/home`                      | B1        | Tab                                                       |
| `/alerts`                    | G0        | From the bell on Home                                     |
| `/family`                    | C1        | Tab                                                       |
| `/family/add`                | C2        |                                                           |
| `/family/my-code`            | C3        | Has a "Larger" full-screen mode                           |
| `/family/scan`               | C4        |                                                           |
| `/family/confirm`            | C5        | Receives the decoded card via navigation state            |
| `/family/:memberId`          | C6        | C7 remove confirm is in-page                              |
| `/join`                      | C8        | Family link; the card is in the URL fragment `#c=…`       |
| `/verify/who`                | D1        |                                                           |
| `/verify/what`               | D2        |                                                           |
| `/verify/waiting/:requestId` | D3        |                                                           |
| `/verify/official`           | D4        |                                                           |
| `/verify/result/:requestId`  | E1–E5     | E6 is a sheet on top; E7 is a section in E1               |
| `/request/:requestId`        | F1        | Opened automatically from anywhere when a request arrives |
| `/request/:requestId/sent`   | F3        | F4 and F5 are states of F1                                |
| `/history`                   | H1        | Tab                                                       |
| `/history/:eventId`          | H2        |                                                           |
| `/settings`                  | I1        | Tab                                                       |
| `/settings/profile`          | I1a       |                                                           |
| `/settings/key`              | I1b       |                                                           |
| `/settings/display`          | I1c       | Theme, text size, reduce motion, sounds                   |
| `/settings/language`         | I1d       |                                                           |
| `/help/how-it-works`         | I2        |                                                           |
| `/help/limits`               | I3        |                                                           |
| `/help/suspicious-call`      | I4        |                                                           |
| `/settings/delete`           | I5        |                                                           |
| `/diagnostics`               | J3        | Hidden: tap the version number 5 times in Settings        |
| `/lab`                       | J1        | Laptop; only when `ENABLE_LAB`                            |
| `/guard`                     | J2        | Laptop; only when `ENABLE_GUARD`                          |

**Global listeners** (mounted once at the app root):

- `relay.onRequest` → navigate to `/request/:id` with the takeover animation, from any screen.
- `relay.onAlert` → show the G1/G2 banner and store the alert.
- `relay.onGuardPrompt` → show the B2 banner.
- `relay.onState` → update the connection pill.

## B12. Screen-by-screen specification

Each screen lists: **Route · Purpose · Layout** (top to bottom) **· Behaviour · States and errors · Motion.** Copy comes from B8 (both languages). "Maa" and "Arjun" are example labels; always use the real saved labels.

### B12.0 Shared components (build these first)

| Component                       | Description                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`                      | Background with `--bg`, the `--bg-glow` and the noise texture; safe-area padding; centred 480px column on wide screens                                           |
| `TopBar`                        | Back button (Phosphor `CaretLeft`), a centred title that fades in when the page scrolls past its big heading, and an optional right action                       |
| `TabBar`                        | Floating pill: 4 tabs, icons + labels, sliding active indicator, hidden on non-tab screens                                                                       |
| `Seal`                          | Brand mark with states (B5.5), sizes 24 / 40 / 72 / 120                                                                                                          |
| `ConnectionPill`                | Connected / Reconnecting… / Offline (B6.3)                                                                                                                       |
| `SimulationBadge`               | Fixed top-left chip "Simulated network" (caption size, `--surface-2` background, `--muted` text, flask icon) shown on every screen whenever `SIMULATION` is true |
| `BigButton`                     | Primary, 56px (or the 120px Home variant), with icon, label and optional hint line                                                                               |
| `Button`                        | Variants: primary, secondary (surface + border), ghost, danger-outline, on-verdict (white or dark depending on the verdict colour)                               |
| `Avatar`                        | Initials on the avatar colour; sizes 28 / 40 / 56 / 88; optional "reachable" dot (green 10px with a surface ring) and an optional pulse ring                     |
| `MemberTile`, `MemberRow`       | For grids and lists                                                                                                                                              |
| `ChipGroup`                     | Single-select chips                                                                                                                                              |
| `AmountInput`                   | ₹ prefix, rolling digits, Indian grouping, numeric keypad (`inputmode="numeric"`), quick chips ₹5,000 / ₹10,000 / ₹25,000 / ₹50,000                              |
| `CountdownRing`, `CountdownBar` | B6.3                                                                                                                                                             |
| `SafetyWords`                   | Four words in mono, separated by thin dots, in a `--brand-soft` panel, with flip-in animation                                                                    |
| `QRCard`                        | QR code + name + safety words + brass hairline frame                                                                                                             |
| `Scanner`                       | Camera view with animated brackets and scan line; "Paste code instead" fallback                                                                                  |
| `Sheet`                         | Bottom sheet with drag handle; `dismissible` prop                                                                                                                |
| `InlineConfirm`                 | In-page confirmation panel (never browser dialogs)                                                                                                               |
| `VerdictScreen`                 | Full-screen verdict with reveal, stamp and choreography (B6.4 #8), driven by a `VerdictResult`                                                                   |
| `ChecksList`                    | The 7 checks with the draw animation                                                                                                                             |
| `Banner`                        | Top banner for alerts and Call Guard prompts                                                                                                                     |
| `Toast`                         | Short confirmations                                                                                                                                              |
| `EmptyState`                    | Illustration + one line + one action                                                                                                                             |
| `PhoneNumber`                   | Shows the number as selectable text + a call button (`tel:`) + a copy button                                                                                     |

---

### A · First launch and setup

**A0 · Splash** · Route `/`

- **Purpose:** brand moment and routing.
- **Layout:** centred `Seal` (120) and wordmark on `#0A0E1F` (or `--bg` in light theme).
- **Behaviour.** After the launch animation (at most 1.1 s), route to the first match:
  1. A pending unexpired incoming request exists → `/request/:id`.
  2. `/join` fragment present → C8.
  3. Not in standalone mode and install not dismissed → A1.
  4. No profile → A2.
  5. `setupComplete` false → resume the last setup step.
  6. Otherwise → `/home`.
- **Motion:** B6.4 #1. Reduced motion: seal fades in for 200 ms.

**A1 · Install Pehchaan** · Route `/install` (browser only)

- **Purpose:** help people add the app to their home screen, or continue in the browser.
- **Layout:**
  - Seal (72).
  - "Pehchaan" in h1, with the tagline.
  - An illustration of a phone with the seal on its home screen.
  - **Android / Chrome:** primary "Add to Home Screen" (uses the saved `beforeinstallprompt` event).
  - **iPhone / Safari:** a 2-step visual guide ("Tap Share", then "Add to Home Screen", with the Share icon drawn).
  - Secondary "Continue in browser".
- **Behaviour.** Detect the platform. After a successful install, show a toast: "Pehchaan is on your home screen. Open it from there." When opened in standalone mode, A1 never shows.
- **States:**
  - Unsupported browser (in-app browsers like Instagram's): "Open this link in Chrome or Safari", with a copy-link button.
  - Already installed: go straight to A2 or Home.
- **Motion:** the phone illustration floats (±3px, 4 s loop); the seal "drops" into the home-screen grid once.

**A2 · Choose language** · Route `/setup/language`

- **Layout:** Seal (56); title in both languages ("Choose your language / अपनी भाषा चुनें"); two big cards: **English** and **हिन्दी** (each 88px tall, with a sample line in that language); caption "You can change this later".
- **Behaviour:** a tap sets the language immediately. The whole UI (including this screen's caption) crossfades to that language, then continues to A3 after 300 ms.
- **Motion:** the selected card fills from the centre; the other fades to 40%.

**A3 · Welcome** · Route `/setup/welcome`

- **Layout:**
  - Three swipeable cards with an illustration, title and body (B8 `welcome.1–3`).
  - Progress dots (the active one is a stretched pill).
  - "Skip" (top right) and "Next" (bottom primary), which becomes "Get started" on card 3.
- **Illustrations:**
  1. A waveform that morphs into the seal.
  2. Two phones with an arc and a dot travelling between them.
  3. A split seal, green check on one side and red ✕ on the other.
- **Motion:** B6.4 #2; parallax swipe; the dot pill stretches between positions.

**A4 · Your name** · Route `/setup/name`

- **Layout:**
  - Title "What's your name?" with a hint "Family will see this when you ask or answer."
  - Fields: **Name** (required, autofocus, max 30 characters); **Phone number (optional)**, with a +91 prefix, used for "Call {name}" buttons on other family phones.
  - "How should Hindi address you?" (only shown in Hindi, or in English as a small optional row): पुरुष / महिला / बताना नहीं.
  - Avatar colour picker (6 swatches) with a live avatar preview showing the initials.
  - Primary "Continue".
- **States:**
  - Empty name → inline error "Enter your name so family can recognise you."
  - Invalid phone → "Enter a 10-digit mobile number, or leave it empty."
- **Motion:** the avatar preview's initials cross-fade as you type; the colour swatch selection uses `spring.ui`.

**A5 · Could someone pretend to be you?** · Route `/setup/role`

- **Layout:**
  - Title (B8 `role.title`) and one line: "Scammers copy the voices of children and relatives to fool parents."
  - Two large selectable cards:
    - **Yes, set up my key** (key icon, hint).
    - **No, I only check others** (eye icon, hint).
  - Primary "Continue".
- **Behaviour:**
  - Yes → A6.
  - No → A7 with role `checks_only`.
  - Nothing is preselected; the button stays disabled until a choice is made.
- **Motion:** the selected card lifts (`y: -2`, shadow-2) and its border animates to `--brand`.

**A6 · Create your key** · Route `/setup/key`

- **Layout:**
  - Duotone key illustration inside a vault ring.
  - Title and body (B8 `key.*`).
  - A three-item "What this means" list with icons:
    - "Your key never leaves this phone"
    - "Only your fingerprint or PIN can use it"
    - "Family can check it's really you"
  - Primary "Create my key".
- **Behaviour:**
  - Call `key.checkSupport()` first, then `key.createKey()`.
  - While waiting, show the caption "Use your fingerprint or PIN when your phone asks."
  - On success: animation B6.4 #3, the text "Your key is ready. It never leaves this phone.", the four **safety words**, and the caption "Your family will see these same words when they add you." Then "Continue".
- **States and errors:**
  - **No screen lock:** "Set a screen lock (fingerprint or PIN) in your phone settings, then come back." Buttons: "I've set it, try again" / "Skip for now" (the role becomes checks-only, with a note that it can be changed in Settings).
  - **Passkeys not supported:** "This phone can't create a key here." Buttons: "Use a 6-digit Pehchaan PIN instead" (a PIN entry screen twice, with a matching check) / "Skip for now".
  - **Cancelled:** "Key not created. Tap to try again."
- **Motion:** B6.4 #3. The vault ring rotates while waiting (slow, continuous).

**A7 · You're set up** · Route `/setup/done`

- **Layout:** a success seal with a check drawn; title and body (B8 `done.*`); primary "Add family"; ghost "Later".
- **Behaviour:** sets `setupComplete: true`. "Add family" → C2. "Later" → Home.
- **Motion:** the check draws, then the brass ring sheens once.

**A8 · Allow notifications** · Route `/setup/notifications` (`ENABLE_EXTRAS` only, because push isn't built yet)

- **Layout:** a bell illustration; "Get requests even when Pehchaan is closed"; "Allow" / "Not now".
- **Behaviour:** both buttons continue. "Allow" only records the choice (a real push comes later). Shown after A7 only when `ENABLE_EXTRAS` is on and the Notification API exists. With extras off, the family app never promises alerts while closed.

---

### B · Home

**B1 · Home** · Route `/home` (tab)

- **Layout:**
  1. **Header row:** your avatar (40) + "Namaste, {name}" (h2), a bell icon with an unread-alerts badge (→ G0), and `ConnectionPill` under the greeting.
  2. **Verify card:** a `BigButton` (at least 120px tall, radius 28, `--brand` with a subtle inner gradient) with a Phosphor `ShieldCheck` duotone icon, "Verify a caller" (h2 weight) and the hint "Tap during a suspicious call". Breathing animation (B6.4 #6).
  3. **Recent check chip** (only within 10 minutes of a check): "Arjun · Money ₹50,000 · Check again". Tap starts D3 directly with the same person and details.
  4. **Incoming request banner** (only if a request is pending while the app was open elsewhere): "{asker} is asking you to confirm" → F1.
  5. **Alerts** (unread G1/G2 as cards, newest first, max 2, with "See all").
  6. **Your family:** a horizontal row of avatars with labels and a reachable dot, plus a "+" tile. Tap an avatar → C6.
  7. **Family rule card:** the seal (24) + "Family rule: no green, no money." with "How it works" → I2.
  8. `TabBar`.
- **Behaviour:** pulling down refreshes presence.
- **States:**
  - No family yet: the family row becomes an `EmptyState` "Add the people a scammer might pretend to be." with "Add family" → C2.
  - Offline: the pill shows Offline; tapping Verify still opens D1 but with a warning banner (D1 states).
  - A checks-only user with no members who can be verified: the Verify button shows the hint "Add a family member first".
- **Motion:** header, then Verify card, then rows, staggered on first mount only (not on every tab return).

**B2 · Call Guard prompt** (banner over any screen when `onGuardPrompt` fires)

- **Layout:**
  - A top `Banner` with the Call Guard icon (`Waveform`) and "Caller says he is {claimedLabel} and wants {amount}".
  - Tactic chips (Urgency, Secrecy, Money, OTP, Authority).
  - Buttons: "Verify now" (primary) / "Dismiss".
- **Behaviour:**
  - "Verify now" opens D3 directly if the claimed label matches a member who can be verified; otherwise it opens D1 with the amount prefilled.
  - Auto-hides after 30 s.
  - Never verifies by itself.
- **Motion:** drops in with `spring.soft`; the chips pop in staggered.

---

### C · Family

**C1 · Family list** · Route `/family` (tab)

- **Layout:**
  - h1 "Family" with a count.
  - Sections "Can be verified" and "Checks only". Each row: avatar with reachable dot, label, relation, role badge, and "Added in person · 12 Sep".
  - Primary "Add family member".
- **States:** empty → `EmptyState`.
- **Motion:** rows stagger in; tapping a row does a shared-element transition to C6.

**C2 · Add family member** · Route `/family/add`

- **Layout:**
  - Title.
  - Two big tiles:
    - **Show my code** (QR icon), "They scan you".
    - **Scan their code** (camera icon), "You scan them".
  - An info panel: "Do this together, in person. That's what makes it safe."
  - If the user's role is checks-only, the "Show my code" tile still exists (so others can reach them for alerts), with the sub-note "Family can send you alerts".

**C3 · My code** · Route `/family/my-code`

- **Layout:**
  - `QRCard`: the QR encodes `CardService.toLink(myCard)`, a full `https://…/join#c=…` link, so any phone camera can open it.
  - Name, and `SafetyWords` with the caption "Read these aloud. Their phone must show the same words."
  - Buttons: "Larger" (full-screen QR on a white background for scanning from a distance or a laptop screen), "Copy link", "Done".
- **Behaviour:** increase screen brightness is not possible from the web, so show the tip "Turn your brightness up if scanning is slow."
- **Motion:** B6.4 #4.

**C4 · Scan their code** · Route `/family/scan`

- **Layout:** full-bleed camera view with brackets, the instruction "Point at the code on their phone", a torch toggle (if supported) and "Paste code instead" (opens a sheet with a text area).
- **Behaviour:** decode, then `CardService.fromLink`, then → C5 with the card.
- **States and errors:**
  - **Camera refused:** a full panel "Camera is off for Pehchaan. Paste their code instead, or allow the camera in your browser settings." with "Paste code instead".
  - **Not a Pehchaan code:** a shake of the brackets + a toast "This isn't a Pehchaan code. Ask them to open My code."
  - **Own code:** "That's your own code. Scan the other person's phone."
  - **Already added:** "{name} is already in your family." with "Open" → C6.
- **Motion:** B6.4 #5.

**C5 · Confirm and label** · Route `/family/confirm`

- **Layout:**
  - Avatar (88) grows in from the scan position.
  - Name from the card, and the role badge.
  - "Does {name}'s phone show these words?" with `SafetyWords`.
  - Buttons: "Yes, they match" (primary) / "No" (secondary).
  - On "Yes": a **"{name} is your…"** chip group (Son, Daughter, Mother, Father, Husband, Wife, Brother, Sister, Grandchild, Other) and an editable **label** field (default: the card name; for a mother the suggestion is "Maa").
  - Primary "Save".
- **Behaviour:** after Save:
  - Success haptic.
  - A toast "{label} added".
  - A sheet: "Now let {label} scan your code so you can verify each other" with "Show my code" (→ C3) / "Not now".
- **States:** "No" → a warning panel "Don't add this person. Scan again, face to face." with "Scan again".
- **Motion:** the words flip in; the relation chips stagger; Save → the avatar flies to the family tab icon.

**C6 · Member details** · Route `/family/:memberId`

- **Layout:**
  - Header with avatar (88, shared element), label, relation and role badge.
  - Actions row: **Verify now** (if they can be verified), **Call** (`PhoneNumber`, if a phone number is saved).
  - Info list: Safety words, Added on (date) and how, and whether a key is present.
  - "Recent checks": the last 5 history events with this person.
  - Danger zone: "Rename", "Change relation", "Remove from family".
- **C7 · Remove (in-page):** `InlineConfirm` with "Remove {label}? You won't be able to verify them until you add them again." and the buttons "Remove" (danger) / "Cancel". After removal → C1 with the toast "{label} removed".

**C8 · Add from a family link** · Route `/join#c=…` (opened by scanning a QR with any phone camera)

- **Purpose:** someone (for example a judge, or a relative) can check a person on their **own phone in about a minute**, with no install and no key.
- **Layout (a compact flow in one screen with steps):**
  1. Seal and "{name} shared their Pehchaan card with you."
  2. If there's no profile yet: "Your name" (one field, optional; defaults to "Guest") + a language toggle.
  3. `SafetyWords` from the card + "Do these match the words on {name}'s phone?" with "Yes, they match" / "No".
  4. On Yes: "Saved. You can now check {name} anytime." + primary "Verify {name} now" (→ D2 with the member preselected) + ghost "Go to Home".
- **Behaviour:** creates a minimal checks-only profile (`setupComplete: true`) if none exists, stores the member with `addedBy: 'family_link'`, and never asks to create a key.
- **States:**
  - Corrupt link: "This link is incomplete. Ask {name} to show their code again."
  - Browser too old: "Open this in Chrome or Safari."
  - Words don't match: nothing is saved.
- **Motion:** the steps slide horizontally.

**C9 · Add someone far away** (`ENABLE_EXTRAS` only)

- **Layout:** explainer "Two family members who already have {name} must approve"; a request status list; a placeholder action (the real logic comes later).

---

### D · Verify a caller

**D1 · Who does the caller say they are?** · Route `/verify/who`

- **Layout:**
  - h1 (B8 `verify.who`).
  - A 2-column grid of `MemberTile`s (avatar 56, label, relation) for members who can be verified, sorted by most recently checked.
  - A full-width tile **Someone else** (→ E5 with UNKNOWN_PERSON, no network call).
  - A full-width tile **Police, bank or government** (→ D4).
- **States:** offline → a top amber banner "You're offline, so we can't check right now. Don't pay until you can." Tiles stay tappable (the flow ends in E3 with reason "offline").
- **Motion:** tiles stagger in; the tapped tile's avatar is a shared element into D3.

**D2 · What are they asking for?** · Route `/verify/what`

- **Layout:**
  - The chosen member's avatar + label at the top.
  - h1 (B8 `verify.what`).
  - `ChipGroup` with the reasons (Money preselected).
  - If Money: `AmountInput` with quick chips.
  - Primary "Ask {label}'s phone"; ghost "Skip" (sends without a reason).
- **Behaviour:**
  - Builds the `VerifyRequest`: new `requestId`, 32-byte nonce, `expiresAt` = now + 60 s.
  - `relay.sendRequest`, then → D3.
  - The request text shown on the other phone must match exactly what's chosen here.
- **Motion:** the amount digits roll; the primary button morphs into the D3 avatar arc (shared element).

**D3 · Waiting** · Route `/verify/waiting/:requestId`

- **Layout:**
  - Waiting gradient background (B5.2).
  - The two-avatar arc (Maa left, member right) with the `CountdownRing` behind the member.
  - "Asking {label}'s phone…" (h1, white).
  - A "say" card: "Tell the caller: 'Please hold for a minute.'"
  - A small line: "Scammers rush. Real emergencies can wait a minute."
  - Ghost "Cancel" (on-verdict style).
- **Behaviour:**
  - Screen wake lock on.
  - On `onAnswer` for this request: run `verifier.verify`, then → `/verify/result/:id`.
  - At 60 s with no answer: NO_RESPONSE (reason `timeout`) → result.
  - Relay offline for more than 5 s: NO_RESPONSE (reason `relay_unreachable`).
  - Cancel: `InlineConfirm` "Stop waiting? {label} won't be able to answer this request." → Home, recorded as cancelled in History (no verdict).
- **Motion:** B6.4 #7. In the last 10 s the ring turns amber and the "say" card text changes to "Still waiting for {label}…".

**D4 · The caller says they're police, bank or government** · Route `/verify/official`

- **Layout:**
  - A warning seal (amber) + h1 (B8 `official.title`).
  - Three rule cards with icons:
    - "CBI, ED and police don't do 'digital arrest' over video calls."
    - "No real officer asks you to transfer money to 'verify' it."
    - "Never share OTPs or install apps a caller asks for."
  - Helpline: "Cyber helpline: **1930**" (`PhoneNumber`) + "cybercrime.gov.in" (link).
  - Disabled button "Verify an official" with the caption "Coming later".
  - Primary "Done".
- **Motion:** the rule cards stagger; the seal rocks once.

**D5 · Payment check** (`ENABLE_EXTRAS` only)

- **Layout:** a mock bank-transfer screen: "You're sending ₹50,000 to a new person right after a call. Did someone on the phone ask you to?" with "Verify first" (→ D1) / "No, continue".

---

### E · The verdict (Maa's screen) · Route `/verify/result/:requestId`

All five use `VerdictScreen`, with the full-screen verdict gradient (B5.2), `Seal` (120) in the verdict state, a display headline, body text, then actions.

Always present:

- **Why?** (opens E6) and **Check again** (a new request, same member and details → D3).
- The time since the answer: "{label}'s key · 4 s ago" for Confirmed and Not-them.
- Closing only through buttons (B9 #3).

**E1 · Confirmed** (VERIFIED)

- **Content:** title "Confirmed"; body "It's really {label}."; meta "{label}'s key · {n} s ago".
- **Actions:** "Done" (on-verdict primary), "Why?", "Check again".
- **E7 · Say-the-words** (a section inside E1, shown when `confirmationWords` exist): "Ask {label} to say these words:" with two large mono words (for example **MANGO · TIGER**) and the caption "Their phone shows the same two words."
- **Motion:** B6.4 #8 confirmed variant.

**E2 · Not {label}** (DENIED)

- **Content:** title "Not {label}"; body "{label}'s own phone says this is not them. **Do not send money.**"
- **Actions, stacked:**
  1. "What to say to the caller" (opens a small sheet with the safe-exit line in large type).
  2. `PhoneNumber` "Call {label}" with their saved number.
  3. A status row: "Family alerted: {names}" (a check icon when sent).
  4. "Report: call 1930".
  5. "Done".
- **Behaviour:** sends G1 alerts to all other family members, records history, strong haptic and sound.
- **Motion:** the denied variant.

**E3 · Not confirmed yet** (NO_RESPONSE)

- **Content:** title "Not confirmed yet"; body "{label} hasn't answered. Don't pay until they do."; a reason line for `offline` or `relay_unreachable`: "Couldn't reach the network."
- **Actions:** "Ask again" (primary), "Ask family to reach {label}" (sends G2 to the others, then shows "Sent to {names}"), `PhoneNumber` "Call {label}", "Done".
- **Motion:** the not-confirmed variant.

**E4 · Fake answer** (INVALID)

- **Content:** title "Fake answer"; body "Someone tried to fake {label}'s answer. Do not trust this call."; a "What happened" panel with one line per reason:

| Reason          | Line                                          |
| --------------- | --------------------------------------------- |
| `changed`       | The answer was changed on the way.            |
| `reused`        | An old answer was sent again.                 |
| `wrong_key`     | It was signed by a key that isn't {label}'s.  |
| `wrong_app`     | It didn't come from the Pehchaan app.         |
| `not_unlocked`  | The phone wasn't unlocked to answer.          |
| `bad_signature` | The signature doesn't match.                  |
| `expired`       | The answer arrived after the request expired. |

- **Actions:** "Why?" (primary here, because the checks tell the story), "Check again", "Done".
- **Motion:** the fake variant (glitch, then shield, with the hatch background).

**E5 · Can't verify** (UNKNOWN_PERSON)

- **Content:** title "Can't verify"; body (B8 `v.unknown.body`); advice list "Don't pay · Hang up · Call back on a number you already know".
- **Actions:** "Done".
- **Motion:** the unknown variant.

**E6 · Why? (sheet over E1–E4)**

- **Layout:**
  - Title "Why we trust this answer" (VERIFIED/DENIED) or "What failed" (INVALID).
  - `ChecksList` with the 7 checks (B4) using real labels and details.
  - The timing line "Answered in {elapsed} s".
  - A footnote: "{label}'s phone signed this answer. Our server only passed it along; it can't create or change a signature."
  - Button "Close".
- **Behaviour:** dismissible (unlike the verdict itself).
- **Motion:** B6.4 #9.

---

### F · Answering a request (Arjun's phone)

**F1 · Incoming request** · Route `/request/:requestId`. Opens automatically from any screen, as a takeover.

**Layout:**

- Deep ink background (`#0A0E1F` with the indigo glow in both themes) so it feels urgent and distinct from verdicts.
- `CountdownBar` pinned to the top.
- Asker's avatar (88) with a heartbeat pulse ring.
- `ask.title` ("{asker} is asking").
- If the asker isn't in your family list: a caution tag "Not in your family list", showing the name they gave.
- **The question** in display size. The amount is in mono and brighter. The question depends on the reason:

| Reason       | Question                                                     |
| ------------ | ------------------------------------------------------------ |
| Money        | "Are YOU on a call with them right now, asking for ₹50,000?" |
| OTP          | "…asking for an OTP or code?"                                |
| Bank details | "…asking for bank or card details?"                          |
| Install app  | "…asking them to install an app?"                            |
| Nothing yet  | "Are YOU on a call with them right now?"                     |

- "Expires in 0:51" in mono.
- Two stacked buttons, with the safest answer in the most reachable spot:
  - Upper: **Yes, it's me**. Secondary style with a green outline, 56px tall.
  - Bottom: **NO, NOT ME**. Danger-filled, 64px tall, subtle glow.
- Caption: "You'll unlock with your fingerprint or PIN."
- If more than one request is waiting: a chip "1 more request".

**Behaviour:**

- Vibration and sound loop (B7) until answered or expired.
- Wake lock on.
- Tap an answer → F2 → `key.signAnswer(req, decision)` → `relay.sendAnswer` → F3.
- Queued requests are handled one at a time, oldest first.

**States:**

- **F4 · Expired:** the question fades to 40% and a panel appears: "This request expired. If {asker} still needs you, they can ask again." with "Done".
- **F5 · Couldn't confirm** (unlock cancelled or failed): both buttons return with an inline note "Not confirmed. Tap to try again." while time remains.
- **Offline while answering:** "Couldn't send your answer. Reconnecting…" with an automatic retry until expiry.

**Motion:** B6.4 #10.

**F2 · Unlock to confirm**

- **Real build:** the phone's own fingerprint or PIN sheet appears (system UI). Behind it, dim F1 and show "Waiting for your fingerprint or PIN…".
- **Simulation build:** an in-app sheet that looks like a system biometric prompt:
  - a fingerprint glyph, "Confirm it's you", and "Touch the sensor";
  - a large fingerprint button (tap = success), "Use PIN" (any 4 digits), "Cancel";
  - a small caption "Simulated unlock".

  The glyph fills with brand colour from the bottom on success (400 ms).

**F3 · Answer sent** · Route `/request/:requestId/sent`

- **NOT ME variant:**
  - The sealed-envelope animation (B6.4 #11).
  - Title "We told {asker} it's not you".
  - Body "Someone may be pretending to be you. Call {asker} now."
  - `PhoneNumber` for the asker's saved number.
  - "Done".
- **YES variant:**
  - Title "{asker} can see it's really you".
  - If confirmation words exist: "Say these words to {asker}:" with two large mono words.
  - "Done".
- Both record a History "answered" event.

---

### G · Family alerts

**G0 · Alerts** · Route `/alerts`

- **Layout:** a list of alerts newest first, each a card with an icon, title, body, relative time and an unread dot. "Mark all read".
- **States:** empty → "No alerts. Pehchaan tells you here if someone pretends to be a family member."
- **Motion:** cards stagger; a card slides out when marked read.

**G1 · Someone pretended to be {about}** (sent to every other family member after a DENIED)

- **Banner** (on any screen): a red-edged banner (B6.4 #12), "Someone pretended to be {about}", "On a call to {victim}, {n} min ago."
- **Card** (in G0 and Home): the same, plus "{about}'s phone said NOT them." and `PhoneNumber` "Call {victim}".

**G2 · Can you check on {about}?** (sent when Maa taps "Ask family to reach {label}" on E3)

- **Card:** "{victim} couldn't confirm a money request from someone claiming to be {about}. Can you reach {about}?"
- **Actions:** `PhoneNumber` "Call {about}" and "I've reached them" (marks it resolved).

---

### H · History

**H1 · History** · Route `/history` (tab)

- **Layout:**
  - h1 "History".
  - A segmented control **My checks** / **Asked of me** (the active indicator slides).
  - Events grouped by day ("Today", "Yesterday", "12 Sep").
  - Each row: avatar, "Checked Arjun" or "Answered Maa", a verdict chip (Confirmed / Not them / Fake answer / Not confirmed / Can't verify) or a decision chip (Yes / NOT ME), the amount if any, and the time.
- **Behaviour:** pull to refresh (B6.3); tap a row → H2.
- **States:** empty → "Nothing yet. Your checks and answers will appear here."

**H2 · History detail** · Route `/history/:eventId`

- **Layout:**
  - A summary card in the verdict colour (small seal, headline, amount, reason).
  - A timeline: Asked 10:41:02 → Answered 10:41:06 → Result 10:41:06.
  - `ChecksList` (static; no draw animation after the first view).
  - "Delete this entry" (`InlineConfirm`).

---

### I · Settings and help

**I1 · Settings** · Route `/settings` (tab). Grouped list with icons and chevrons:

1. **Profile card:** avatar, name, role → I1a.
2. **My key** → I1b (can-be-verified). For checks-only users this row reads "Let family verify you" and starts A6.
3. **Display** → I1c.
4. **Language** → I1d (English / हिन्दी, instant switch).
5. **Notifications:** a stub row "Coming soon" is **not** allowed on family screens; instead show "Requests arrive while Pehchaan is open" as an info row.
6. **Help:** How it works (I2) · What Pehchaan can't protect against (I3) · During a suspicious call (I4).
7. **Privacy:** "What's stored on this phone" (an expandable explainer: your profile, family cards, history; never recordings; nothing on a server) · Delete all data (I5).
8. **About:** "Pehchaan 1.0.0". Tapping the version 5 times shows the toast "Diagnostics unlocked" and adds a Diagnostics row.

**I1a · Profile** · Route `/settings/profile`

- Edit name, phone, colour and Hindi form.
- Note: "Family members keep the name they saved. Share your code again after changing it."

**I1b · My key** · Route `/settings/key`

- Status: "Key ready · created 12 Sep".
- Safety words.
- Toggle "Family can verify me". Turning it off uses `InlineConfirm`: "Family won't be able to verify you until you turn this on and share your code again."
- "Replace my key": `InlineConfirm` "Your family will need to scan your new code." Then an A6-style flow.

**I1c · Display** · Route `/settings/display`

- Theme: System / Light / Dark, with a live mini preview.
- Text size: Normal / Large / Extra large, with a live preview of a verdict card.
- Reduce motion (toggle).
- Sounds (toggle).

**I1d · Language** · Route `/settings/language`. Two big cards as in A2.

**I2 · How it works** · Route `/help/how-it-works`

- Four steps, each with a looping mini animation:
  1. "Maa taps Verify"
  2. "Arjun's phone asks him"
  3. "He unlocks and answers"
  4. "Maa's phone checks the signed answer"
- Two short sections:
  - **"Why a copied voice can't pass":** the check never listens to the voice; only the key inside Arjun's phone can answer.
  - **"What our server can and can't do":** it passes messages; it can't create or change a signed answer; if it fails, you see "Not confirmed yet", never green.

**I3 · What Pehchaan can't protect against** · Route `/help/limits`

- Four cards:
  1. Someone who knows {your family member}'s PIN.
  2. Harmful apps already on your phone.
  3. A family member being forced to say yes.
  4. People who aren't in your family list.
- Closing line: "Pehchaan confirms who answered. It can't tell whether they're safe. In an emergency, call 112."

**I4 · During a suspicious call** · Route `/help/suspicious-call`

- Five numbered steps:
  1. Pause. Real emergencies can wait a minute.
  2. Tap Verify a caller.
  3. Never share an OTP or install an app a caller asks for.
  4. Call back on a number you already know.
  5. Report fraud: 1930 or cybercrime.gov.in.

**I5 · Delete all data** · Route `/settings/delete`

- Explains what is deleted: profile, family, history, and your key.
- Two-step `InlineConfirm` ("Delete everything" → "Yes, delete").
- Clears IndexedDB, calls `key.deleteKey()` → A2.

**I6 · Practice a scam call** (`ENABLE_EXTRAS` only)

- A pretend call screen with chat-style captions of a scam script and coach marks guiding the user to tap Verify, ending in a practice red verdict marked "Practice".

---

### J · Laptop tools and Diagnostics

**J1 · Security Lab** · Route `/lab` (laptop; lazy-loaded)

**Purpose:** anyone (including a judge) can act as an attacker who controls the relay and see every attack rejected. Also keeps a permanent log of every attack ever run.

**Layout:**

1. **Header:**
   - Seal (40), "Security Lab", and a brass-outlined tag "Test environment".
   - Relay connection status.
   - **Attacker mode** switch (off by default). When on, the header gets a red hairline and the Relay node turns "controlled by attacker".
2. **Pipeline** (full width, about 220px tall):
   - Three nodes: **Maa's phone** · **Relay** · **Arjun's phone**, each with device-name dropdowns filled from presence.
   - Capsules animate along the lines for every real message (B6.5).
3. **Attacks.** Three large cards in a row, each with a title, one-line description and an **Arm** button:

| Card                        | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| **Change the next answer**  | Turns Arjun's NOT ME into ME on the way                    |
| **Replay Arjun's last yes** | Sends his genuine "Yes" from earlier instead of asking him |
| **Forge a yes**             | Answers "Yes" using the attacker's own key                 |

- Only one attack can be armed at a time. Armed state: a pulsing border and "Armed: waiting for the next check from Maa's phone".
- It auto-disarms after firing.
- Replay is disabled until a genuine YES has been seen ("Run one genuine check first so there's a real 'Yes' to replay").

4. **Result panel** (large type, readable from a metre away): the last attack and what Maa's phone showed, for example "Maa's phone: **Fake answer**. The answer was changed on the way. Failed check 3 of 7." Include the verdict chip.
5. **Counters:** "Attacks run" and "False greens" (always 0, shown in green) as large mono numbers, with "since {date}".
6. **Traffic log:** a table of `RelayEvent`s with time, from → to, kind, summary (for example "request · Money ₹50,000 · nonce 9f2c…"), a tampered tag, and the verdict seen. Newest first, virtualised.
7. **Footer tools:** "Clear log" · "Reset counters" · "Export attack log (JSON)". The all-time attack log is kept in IndexedDB; export uses a Blob download (it works on the laptop's own browser).

**Behaviour:**

- Without attacker mode the Lab only observes.
- With an attack armed, it rewrites the next matching message (change: the answer's decision; replay: it holds the new request back from Arjun and returns the stored genuine answer; forge: it holds the request and returns an answer signed by a Lab-generated key).
- It records each attack with its outcome.

**Motion:** B6.5.

**J2 · Call Guard** · Route `/guard` (laptop; lazy-loaded)

**Purpose:** listens to a call on speakerphone and suggests a check to the parent's phone. It never decides anything.

**Layout:**

1. **Header:**
   - Seal, "Call Guard", and a status pill (Listening / Paused).
   - Mode switch: **Microphone** / **Scripted**.
   - Dropdown "Send prompts to:" (devices from presence, for example "Maa's phone").
   - Start/Stop button.
2. **Left column:** a live waveform (canvas) and a transcript panel. Lines appear as they're recognised; matched keywords are highlighted with `--brand-soft`.
3. **Right column:**
   - **"What we're hearing":** tactic chips (Identity claim: {name} · Money {amount} · Urgency · Secrecy · OTP · Authority).
   - **Stage bar:** Idle → Claim → Pressure → Secrecy → Money.
   - **Prompt card:** "Send 'Verify now?' to Maa's phone" button, plus an **Auto-send** toggle (sends automatically once there's an identity claim and the stage reaches Money).
   - A "Sent" state with a timestamp.
4. **Rules drawer** (collapsible, a transparency feature): lists every keyword rule in plain text.
5. **Footer note:** "Call Guard only suggests a check. It never decides who is calling."

**Keyword rules.** Case-insensitive; match both Devanagari and Latin transliteration.

| Signal         | Keywords and patterns                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Identity claim | "main {name}", "मैं {name}", "{name} bol raha / bol rahi", "it's me", "maa main" (use every family member's label and name)     |
| Money          | "₹", "rupaye", "rupees", "paise", "पैसे", "UPI", "transfer", "bhejo", "भेजो", numbers followed by "hazaar / हज़ार / lakh / लाख" |
| Urgency        | "abhi", "अभी", "jaldi", "जल्दी", "turant", "तुरंत", "urgent", "emergency"                                                       |
| Secrecy        | "mat batana", "मत बताना", "kisi ko", "किसी को", "don't tell", "phone mat rakhna", "फ़ोन मत रखना"                                |
| OTP            | "OTP", "code", "number batao"                                                                                                   |
| Authority      | "police", "पुलिस", "CBI", "ED", "customs", "arrest", "गिरफ़्तार", "digital arrest"                                              |

**Stage logic:** claim → pressure (urgency or authority) → secrecy → money. The stage never goes backwards within a session.

**Scripted mode** plays these lines 3–5 s apart (and supports manual "Next line"):

1. "Maa, main Arjun bol raha hoon… mera phone toot gaya, dost ke phone se call kar raha hoon."
2. "Accident ho gaya hai, main hospital mein hoon. Abhi ₹50,000 chahiye."
3. "Papa ko mat batana please, woh pareshaan ho jaayenge."
4. "Haan Maa, main hi hoon… jaldi karo please."
5. "Phone mat rakhna, bas UPI kar do."
6. "Please Maa, abhi bhejo."

**J3 · Diagnostics** · Route `/diagnostics` (phone; hidden)

- **Device:** name, device ID (copy), role, key status, app version, flags.
- **Connection:** state, relay address, round-trip time ("Ping" button), last message time, reachable devices.
- **Last verdict:** summary + `ChecksList`.
- **Tools:**
  - **Clear requests and history** (`InlineConfirm`); used between judging sessions.
  - Reset used request numbers.
  - Reconnect now.
  - Copy debug info.
- **Simulation panel** (only when `SIMULATION`):
  - Auto-answer selector (B3, simulated implementations, item 5).
  - Force the connection state.
  - "Load example family".
  - Quick links "Open as Maa" / "Open as Arjun" (`?device=`).

---

## B13. Error and empty states (summary)

| When                       | Where  | What the person sees                                                                                  |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| No screen lock             | A6     | "Set a screen lock (fingerprint or PIN) in your phone settings, then come back."                      |
| Passkeys unsupported       | A6     | "This phone can't create a key here. Use a 6-digit Pehchaan PIN instead."                             |
| Unlock cancelled           | A6, F2 | "Not confirmed. Tap to try again."                                                                    |
| Camera refused             | C4     | "Camera is off for Pehchaan. Paste their code instead, or allow the camera in your browser settings." |
| Not a Pehchaan code        | C4, C8 | "This isn't a Pehchaan code. Ask them to open My code."                                               |
| Own code                   | C4     | "That's your own code. Scan the other person's phone."                                                |
| Already added              | C4     | "{name} is already in your family."                                                                   |
| Words don't match          | C5, C8 | "Don't add this person. Scan again, face to face."                                                    |
| Offline on Verify          | D1–D3  | "You're offline, so we can't check. Don't pay until you can."                                         |
| No answer in 60 s          | E3     | "{label} hasn't answered. Don't pay until they do."                                                   |
| Relay unreachable          | E3     | "Couldn't reach the network." (plus the E3 body)                                                      |
| Tampered answer            | E4     | The reason line (E4 table)                                                                            |
| Request expired            | F4     | "This request expired. If {asker} still needs you, they can ask again."                               |
| Answer failed to send      | F1     | "Couldn't send your answer. Reconnecting…"                                                            |
| No family yet              | B1, C1 | "Add the people a scammer might pretend to be."                                                       |
| No history                 | H1     | "Nothing yet. Your checks and answers will appear here."                                              |
| No alerts                  | G0     | "No alerts. Pehchaan tells you here if someone pretends to be a family member."                       |
| Unsupported browser        | A1, C8 | "Open this link in Chrome or Safari."                                                                 |
| Live listening unavailable | J2     | "Live listening needs Chrome. Use Scripted mode."                                                     |

## B14. PWA, install and offline

**Manifest:**

| Field                              | Value                            |
| ---------------------------------- | -------------------------------- |
| `name` / `short_name`              | "Pehchaan"                       |
| `start_url`                        | "/"                              |
| `display`                          | "standalone"                     |
| `orientation`                      | "portrait"                       |
| `background_color` / `theme_color` | "#0A0E1F"                        |
| `icons`                            | 192, 512 and 512 maskable (seal) |

- **iOS:** `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`.
- **Service worker:**
  - Precache the app shell, icons and fonts.
  - Runtime-cache Google Fonts.
  - Never cache relay traffic.
- **Update flow:** when a new version is ready, show the toast "Update ready · Reload". Never show it or reload during D3, F1, or a verdict screen.
- **Offline:** the app opens normally; the pill shows Offline; Verify leads to amber (B9 #6).
- **Install:** capture `beforeinstallprompt` for A1; detect standalone mode with `matchMedia('(display-mode: standalone)')` and `navigator.standalone`.
- **Laptop tools:** `/lab` and `/guard` are excluded from the family app's navigation and aren't required offline.

## B15. Performance budget

- Family app initial JavaScript under 250 KB gzipped. Lazy-load `/lab`, `/guard`, `/diagnostics`, the scanner and the QR generator.
- First screen visible in under 2 s on a mid-range Android over 4G.
- Animations at 60 fps (B6.1 rules).
- Fonts use `font-display: swap`. Preload Mukta 400 and 700, and Anek Latin 600.
- SVG for all illustrations; no raster images except the app icons.

## B16. Never do this

- No login, sign-up, accounts, email, OTP login or user database. If the platform adds authentication by default, remove it and make all routes public.
- No backend, API server or cloud database. Don't use the platform's built-in database for anything.
- No analytics, trackers, ads or third-party scripts (Google Fonts is the only external resource).
- No chatbot, no LLM, no "AI-powered" badges.
- No blockchain.
- No stock photos, emoji icons, purple-to-blue gradient heroes, neon, or glass effects everywhere.
- No browser `alert`, `confirm` or `prompt`.
- None of the words "demo", "mock", "test" or "sample" on family screens. (Only the Security Lab shows "Test environment", and only the Simulation badge and panel mention simulation.)
- No family data in `localStorage` (IndexedDB only).
- No hard-coded names in components (everything comes from data).
- Nothing may produce a green verdict except `VerifierService`.
- Verdict screens can't be dismissed by swipe or tap-outside.
- No network or crypto calls outside the service layer.

## B17. Definition of done

- [ ] Every screen in B12 exists with every listed state, in English and Hindi, in light and dark themes.
- [ ] The full loop works across two tabs (`?device=maa`, `?device=arjun`), including all five verdicts.
- [ ] The Security Lab in a third tab can run Change, Replay and Forge, and each shows **Fake answer** with the correct reason on Maa's tab and 0 false greens.
- [ ] Call Guard in scripted mode sends a prompt that appears as B2 on Maa's tab.
- [ ] The family link (C8) works in a fresh browser profile and reaches a verdict.
- [ ] Every signature moment in B6.4 is implemented. Reduced motion replaces them with fades.
- [ ] Haptics, sounds and wake lock work on Android Chrome and fail silently where unsupported.
- [ ] Installs as a PWA on Android and iOS; opens offline; the update toast works.
- [ ] Contrast passes AA everywhere; keyboard focus is visible; verdicts are announced to screen readers.
- [ ] Nothing from B16 is present.
- [ ] The Simulation badge shows while simulation is on; `services/real/*` exist as documented stubs.

---

# PART C: Phase prompts (paste one at a time, after Part B)

Each prompt assumes the builder has Part B. After each phase:

1. Check the acceptance list.
2. Test on a real phone.
3. Have one teammate explain the new code to another.

If something is off, reply with the section number and the exact fix.

### Phase 0 · Plan only

```
Read the Pehchaan master specification (Part B) completely. Do not write code yet.
Reply with:
1. The core loop in five short lines, in your own words.
2. The folder structure you will create (B3).
3. A table of every screen ID, its route and its section (A0–J3, B11).
4. The libraries you will use, and any you must substitute on this platform, with the substitute.
5. Anything in the spec you find ambiguous, as numbered questions.
Confirm you will NOT add login, a backend, a database, analytics or AI features (B16).
```

### Phase 1 · Foundation

```
Build the foundation exactly as specified in Pehchaan master spec sections B3, B4, B5, B6.1, B7, B8, B10, B11, B14.
1. Design tokens from B5.2 as CSS variables (light, dark, system) wired into Tailwind. Fonts from B5.3. Type scale, spacing, radii, elevation, noise texture from B5.4.
2. Settings plumbing: theme (system/light/dark), text size (normal/large/xlarge scaling), reduce motion, sounds on/off, language (en/hi with instant switch), hindiForm.
3. Motion tokens (B6.1) in src/design/motion.ts; haptics (B7) and Web Audio sounds (B7) utilities with feature detection; wake-lock helper.
4. i18n with complete en.json and hi.json for every string in B8 (and every string you add later).
5. services/types.ts with all interfaces from B3 and types from B4. Simulated implementations: SimRelay (BroadcastChannel, latency, presence), per-tab devices via ?device=, SimKey, SimVerifier (all 7 checks and every INVALID reason), CardService (/join#c= links). Empty services/real/* stubs.
6. Dexie database and repositories; seed data for ?device=maa and ?device=arjun (B4).
7. Shared components from B12.0: AppShell, TopBar, TabBar (sliding pill), Seal (all states, with stroke-draw), ConnectionPill, SimulationBadge, Button, BigButton, Avatar, Sheet, InlineConfirm, Toast, Banner, EmptyState, PhoneNumber.
8. React Router with every route from B11 (placeholder pages showing the screen ID), page transitions from B6.2, and the global listeners from B11.
9. PWA manifest, icons (seal), iOS meta tags, service worker, and the update toast (B14).
Acceptance: two tabs (?device=maa, ?device=arjun) show each other as reachable within 6 s; theme, text size and language switch instantly; the Simulation badge shows; the app installs from Chrome on Android.
```

### Phase 2 · First launch and setup

```
Build screens A0–A7 exactly as in master spec B12 section A, with every state and error, the copy from B8 in both languages, and the motion from B6.4 (#1 launch, #2 onboarding waveform-to-seal, #3 key creation with safety-word flip-in).
- A0 routing rules in the exact order listed.
- A1 handles Android (beforeinstallprompt), iPhone (2-step Share guide), in-app browsers, and "Continue in browser".
- A6 covers: success, no screen lock, passkeys unsupported (6-digit Pehchaan PIN fallback), cancelled.
- Checks-only users skip A6.
Acceptance: a fresh device can reach Home as both roles; every error state in A6 can be triggered from the Simulation panel or a dev toggle; it works in Hindi and at Extra large text without clipping.
```

### Phase 3 · Home and Family

```
Build B1, C1–C8 exactly as in master spec B12 sections B and C, with shared-element transitions, QR reveal (B6.4 #4) and scanning (B6.4 #5).
- B1 includes: greeting, alerts bell with badge, ConnectionPill, the 120px breathing Verify button, the "Check again" recent chip, the incoming-request banner, alert cards, family row with reachable dots, family rule card, TabBar. Plus every empty and offline state.
- C3 QR encodes the full /join#c= link from CardService, with a "Larger" full-screen mode and "Copy link".
- C4 scanner with torch toggle, "Paste code instead", and all four errors.
- C5 safety-word check, relation chips, editable label, the "now let them scan you" sheet.
- C6 details with Verify now, Call (PhoneNumber), recent checks, and the C7 in-page remove.
- C8 family link flow for someone with no profile, finishing on "Verify {name} now".
Acceptance: Maa and Arjun tabs can add each other by pasting codes; opening Arjun's /join link in a private window creates a checks-only profile and reaches D2.
```

### Phase 4 · Verify and the verdicts

```
Build D1–D4, E1–E7 and the VerdictScreen and ChecksList components exactly as in master spec B12 sections D and E.
- D2 builds the VerifyRequest (requestId, 32-byte nonce, 60 s expiry) and sends it via RelayService only.
- D3 is the waiting screen with the two-avatar arc, travelling dot, CountdownRing (amber in the last 10 s), the "say" card, wake lock, and the Cancel confirm. It handles timeout, offline and relay-unreachable as NO_RESPONSE.
- Verdicts come ONLY from VerifierService.verify (B9 #1). Implement all five verdicts with the full choreography of B6.4 #8, including each per-verdict detail, haptics and sounds (B7), aria-live announcements, and the B9 #3 no-accidental-dismiss rule (in-page "Close this result?").
- E2 sends G1 alerts to all other family members; E3 "Ask family to reach them" sends G2.
- E4 shows the exact reason line for every INVALID reason.
- E6 sheet shows the 7 checks with draw animation and the timing count-up.
Acceptance: using the Simulation panel's auto-answer on Maa's tab, every verdict and every INVALID reason can be produced and looks as specified in light, dark, Hindi and reduced motion.
```

### Phase 5 · Answering and alerts

```
Build F1–F5, G0–G2 and the B2 Call Guard banner exactly as in master spec B12 sections F, G and B2.
- F1 opens as a takeover from ANY screen when a request arrives, with countdown bar, heartbeat avatar ring, reason-specific question, "Not in your family list" tag when relevant, NO, NOT ME as the bottom 64px button, vibration and sound loop, wake lock, and a request queue.
- F2 is the simulated unlock sheet (fingerprint tap / PIN / cancel) in simulation mode; in real mode it just waits for KeyService.signAnswer.
- F3 has both variants with the sealed-envelope animation; F4 expired and F5 couldn't-confirm states.
- G1 banner and card, G2 card, G0 list with mark-as-read.
Acceptance: the full loop works across the Maa and Arjun tabs for both answers; a third tab (?device=priya) receives the G1 alert after a NOT ME.
```

### Phase 6 · History, Settings and Help

```
Build H1, H2, I1, I1a–I1d, I2, I3, I4, I5 exactly as in master spec B12 sections H and I.
- History segmented control with sliding indicator, day grouping, pull-to-refresh seal animation, detail with timeline and ChecksList.
- Settings grouped list; version tapped 5 times unlocks Diagnostics.
- Display settings with live previews; the Language switch; My key with the toggle and Replace key flow; Delete all data two-step confirm.
- I2 How it works with four looping mini animations; I3 limits; I4 suspicious-call steps.
Acceptance: every history event created in Phases 4–5 appears correctly; delete-all returns to A2 with an empty database.
```

### Phase 7 · Security Lab, Call Guard and Diagnostics

```
Build J1 (/lab), J2 (/guard) and J3 (/diagnostics) exactly as in master spec B12 section J and motion B6.5. Lazy-load all three.
- Security Lab: header with "Test environment" tag and Attacker mode switch; animated pipeline (Maa's phone · Relay · Arjun's phone) with capsules; three attack cards (Change the next answer / Replay Arjun's last yes / Forge a yes) with arm, auto-disarm and the replay precondition; large result panel naming the failed check; counters (false greens always 0 in green); virtualised traffic log; all-time attack log in IndexedDB with JSON export.
- Call Guard: microphone mode (Web Speech API hi-IN, where available) and scripted mode (the six lines); transcript with keyword highlighting; tactic chips; stage bar; prompt card with Auto-send; rules drawer; footer note.
- Diagnostics: device, connection with ping, last verdict, tools (clear requests and history, reset used request numbers, reconnect, copy debug info), and the Simulation panel.
Acceptance: with tabs /?device=maa, /?device=arjun and /lab, each attack produces "Fake answer" with the right reason on Maa's tab and the Lab counters read N attacks, 0 false greens; Call Guard scripted mode makes the B2 banner appear on Maa's tab.
```

### Phase 8 · Motion polish

```
Do a motion pass against master spec B6, item by item.
For each item in B6.2, B6.3, B6.4 (#1–#12) and B6.5, confirm it is implemented as specified, using the tokens in B6.1 (durations, easings, springs, stagger), animating only transform/opacity/clip-path/stroke-dashoffset.
Fix anything janky on a mid-range Android phone (target 60 fps): remove layout animations on large lists, add will-change only during animations, and virtualise long lists.
Verify reduced motion (B6.6) replaces every movement with short fades while verdict colour, seal and text still appear.
Reply with a checklist of every B6 item marked done, with the component or file that implements it.
```

### Phase 9 · Accessibility, Hindi and final QA

```
Run a full quality pass against master spec B8, B9, B10, B13, B16 and B17.
1. Contrast: check every text/background pair in both themes and on every verdict colour; fix any below WCAG AA.
2. Screen readers: labels on all icon buttons; verdicts announced via aria-live assertive; focus order and visible focus rings.
3. Hindi: every string present in hi.json; gender forms via hindiForm; Hindi line height; no English left on Hindi screens (except names, ₹ amounts, 1930, OTP, UPI).
4. Text size Extra large and 200% zoom: nothing clips on any screen.
5. Every error and empty state in B13 is reachable and uses the exact copy.
6. Sweep for anything forbidden in B16 and remove it.
7. Reply with the B17 checklist, each item marked done or explaining what remains.
```

### Phase 10 · Optional extras (only if everything above is done)

```
With ENABLE_EXTRAS=true, build A8 (notifications stub), C9 (add someone far away by two approvals, UI only), D5 (payment check mock screen) and I6 (practice a scam call with coach marks) exactly as in master spec B12. With ENABLE_EXTRAS=false none of them may appear anywhere.
```

---

# PART D: Full walkthrough test (run it in simulation mode)

Use one laptop browser with four tabs:

- `/?device=maa`
- `/?device=arjun`
- `/?device=priya`
- `/lab?device=lab`

Add `/guard?device=guard` for Call Guard.

1. **Presence.** Maa's Home shows Arjun and Priya with reachable dots, and the pill reads Connected.
2. **Not him.**
   - On Maa: Verify a caller → Arjun → Money → ₹50,000 → Ask Arjun's phone. The waiting screen shows the travelling dot.
   - On Arjun: the takeover appears with sound (after one earlier click), the heartbeat ring and the question with ₹50,000. Tap **NO, NOT ME**, then the simulated fingerprint.
   - Arjun shows the sealed envelope and "We told Maa it's not you".
   - Maa shows the red seal stamp and "Not Arjun". Why? shows 7 green ticks.
   - Priya receives the G1 banner.
3. **Confirmed.** Repeat and tap **Yes, it's me**. Maa shows green "Confirmed", with the say-the-words section if confirmation words exist.
4. **Change the next answer.** In the Lab: Attacker mode on → Arm "Change the next answer". Maa checks Arjun; Arjun taps NOT ME. Maa shows **Fake answer**: "The answer was changed on the way", with check 3 failing. The Lab shows 1 attack, 0 false greens.
5. **Replay.** Arm "Replay Arjun's last yes". Maa checks again (Arjun gets no request). Maa: **Fake answer**, "An old answer was sent again".
6. **Forge.** Arm "Forge a yes". Maa: **Fake answer**, "It was signed by a key that isn't Arjun's". Lab: 3 attacks, 0 false greens.
7. **No answer.** Close the Arjun tab. Maa checks Arjun: the countdown turns amber at 10 s, then **Not confirmed yet**. "Ask family to reach Arjun" sends G2 to Priya.
8. **Offline.** In Maa's Diagnostics, force Offline. Verify shows the offline banner and ends in **Not confirmed yet** with "Couldn't reach the network."
9. **Someone else and officials.** "Someone else" → **Can't verify**. "Police, bank or government" → the D4 advice with 1930.
10. **Call Guard.** On `/guard`: Scripted mode, target Maa, Auto-send on, Start. As the lines play, the chips and stage fill. Maa's tab shows the B2 banner; "Verify now" jumps to the waiting screen.
11. **Family link.** Copy Arjun's link from My code. Open it in a private window. C8: compare the words, save, "Verify Arjun now". The (reopened) Arjun tab answers, and the private window shows the verdict.
12. **Presentation quality.** Switch Maa to Hindi, dark theme, Extra large text and Reduce motion, and repeat steps 2–4. Everything reads correctly and nothing clips.
13. **Reset.** Diagnostics → Clear requests and history on every tab.
14. **Real phones.** Install on an Android phone and an iPhone and repeat steps 2–3. In simulation mode two separate phones can't reach each other (BroadcastChannel only links tabs in one browser), so use the auto-answer option in the Simulation panel on each phone. Cross-device checks start working when the real relay is connected (Part E).

---

# PART E: Handover to the real backend (team-owned, not for the builder)

When the frontend passes Part D, the team replaces the simulations. **No screen should need to change.**

| Replace                    | With                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SimRelay`                 | `RealRelay`: a WebSocket client to the team's relay server | Same events as `RelayService`. Reconnect with backoff (1, 2, 4, 8 s, then every 8 s). Presence heartbeat. The relay stores no keys and makes no decisions.                                                                                                                                                                                                                                                                                                                                          |
| `SimKey`                   | `RealKey` using WebAuthn passkeys                          | `createKey`: `navigator.credentials.create` with a platform authenticator, `userVerification: 'required'`, ES256, `residentKey: 'preferred'`. Read the public key with `response.getPublicKey()` (SPKI) and derive the safety words from its SHA-256. `signAnswer`: `navigator.credentials.get` with `challenge = SHA-256(canonical(request) ‖ "\|" ‖ decision)`, `allowCredentials: [credentialId]`, `userVerification: 'required'`. Return `authenticatorData`, `clientDataJSON` and `signature`. |
| `SimVerifier`              | `RealVerifier`: **written by the team** (about 80 lines)   | The 7 checks with WebCrypto: challenge recomputation, `type`/`origin`, `rpIdHash`, UP and UV flags, ECDSA P-256 / SHA-256 over `authenticatorData ‖ SHA-256(clientDataJSON)` (convert the DER signature to raw r‖s), and the used-nonce cache. Each check maps to its `CheckResult` and INVALID reason (B4). This is the Ownership centrepiece: every teammate must be able to explain it.                                                                                                          |
| `SimLab`                   | The relay's lab channel                                    | The relay implements hold / modify / inject **only in the test environment**, controlled by the Lab page. Never in production.                                                                                                                                                                                                                                                                                                                                                                      |
| `SimGuard` microphone mode | Optional: a better speech-to-text engine                   | Same `GuardService` interface; keyword rules stay.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Flags                      | `SIMULATION=false`                                         | The Simulation badge disappears.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Domain                     | One fixed HTTPS domain                                     | Passkeys are bound to it (rpId). Never change it after keys are created.                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Canonical request format** (the real key and verifier must agree): JSON with keys sorted alphabetically, no whitespace, containing `v`, `requestId`, `nonce`, `fromDeviceId`, `toDeviceId`, `claimedLabel`, `reason` (if set), `amountInr` (if set), `createdAt`, `expiresAt`. The decision is appended after `|` before hashing.

**Before judging day:**

- Run Part D again with real phones on the real relay.
- Run at least 50 attacks from the Security Lab and keep the log.
- Every teammate walks through `RealVerifier` line by line.
