# The real services (backend spec Part C, section 22)

The frontend is connected to the Pehchaan relay. Screens still use only the interfaces in `src/services/types.ts`;
`src/services/index.ts` picks each implementation by flag, and every combination works (APP-01).

| Flag | Simulated (`true`) | Real (`false`) |
| --- | --- | --- |
| `VITE_SIM_RELAY` | `sim/SimRelay.ts`: tabs talk over a BroadcastChannel | `real/relay/RealRelay.ts`: the relay's WebSocket protocol |
| `VITE_SIM_KEY` | `sim/SimKey.ts`: a software authenticator behind the simulated unlock sheet (D-008) | `real/RealKey.ts`: the phone's passkey (WebAuthn, ES256, user verification required) |
| `VITE_SIM_VERIFIER` | `sim/SimVerifier.ts`: the 7 checks, expecting this page's own address | `real/RealVerifier.ts`: the 7 checks, expecting `VITE_ORIGIN` / `VITE_RP_ID` |

`VITE_SIMULATION` is the default for all three. Both verifiers run the **same** code
(`services/verifier.ts` over `packages/crypto/src/verifier.ts`); there is no second, weaker path to a green.

## Where each backend rule lives

| Rule (backend spec) | Code |
| --- | --- |
| Device identity: signing and encryption keys (non-extractable), grant, derived device ID (5, FC-2) | `services/identity.ts` |
| Card v2, derived safety words, the new-phone guard (6, FC-3) | `services/card.ts` over `@pehchaan/crypto/card` |
| Relay protocol client: login, outbox, receipts, reconnect, dedupe, tombstones, push inbox (7–8, FC-6) | `services/real/relay/` (`RealRelay.ts`, `socket.ts`, `outbox.ts`) |
| End-to-end seal and open; plain only between Security-Lab-opted-in phones (9, FC-7) | `services/real/relay/envelope.ts` |
| Passkey create and sign, challenges precomputed when F1 opens (10.3–10.4, FC-4) | `services/real/RealKey.ts` |
| The 7 checks, the late policy, unreadable seals (10.5–10.7, FC-5) | `services/verifier.ts` |
| Asking: receipts, refusals, the late window, used nonces, family alerts (10.7–10.9, 13.1, FC-12, FC-13) | `app/verification.ts` |
| Answering: F1's countdown from `ttlMs`, cancellations, sanity checks (8.6–8.7, FC-14, FC-15, FC-27) | `app/answering.ts` |
| Remove / add in person on the relay (6.4, FC-19) | `app/contacts.ts` |
| Presence on demand (12, FC-17) | `app/presence.ts` |
| Web Push on the phone: A8, the subscription kept fresh at each login, VAPID rotation, the alert check (11.2, 11.8, 11.9, FC-8) | `app/push.ts`, A8 in `screens/setup/Done.tsx`, `screens/settings/AlertsSettings.tsx` |
| Battery-saver guidance by phone maker (11.8, FC-9) | `app/phoneBrand.ts` |
| The service worker: precache, push → notification (never an amount or reason), taps, re-subscription (11.4–11.6) | `sw.ts` over `sw/handle.ts` and `sw/describe.ts` |

## Push notifications

The service worker (`src/sw.ts`, built by vite-plugin-pwa's `injectManifest`) opens each push with this phone's
key, names the sender from this phone's own family list, and always shows a notification: silent while the app is
on screen, and the generic "Open Pehchaan." when a push can't be opened. The frame also goes to the push inbox, which
the app handles exactly once however it arrives. Taps open the app on the notification's own screen (`/request/:id`,
`/verify/waiting/:id`, `/alerts`…). The app registers the service worker only in production builds, so push works
in `pnpm build && pnpm preview` or a deployed build, not in `pnpm dev`. Alerts also need a VAPID key pair: generate
one with `pnpm tsx infra/scripts/vapid-keys.ts` and set it on both the relay and the app (`.env.example`).

## Security Lab and Call Guard

- **Security Lab** (spec 14, FC-21): `real/RealLab.ts` speaks the relay's Lab protocol over the laptop's own
  device connection. It joins with the Lab password, then change, replay and forge are held, rebuilt and injected
  through the relay; forged answers are made in WebCrypto (`@pehchaan/crypto/soft-authenticator`). Test phones
  allow the Lab in Diagnostics. The asker's phone verifies with the normal verifier; the page only shows its report.
  The relay side is `apps/relay/src/lab/module.ts`; switch it on with `admin lab on` (it turns itself off after 12 h).
- **Call Guard** (13.2, FC-22): "+ Add a phone" pairs the laptop with a phone by its family card after comparing
  the four safety words (`screens/guard/AddPhone.tsx`, `store/guardTargets.ts`); prompts are sealed to that card.

## Running it

See the repository README: `pnpm db:up`, then `pnpm dev` runs the relay and this app with the real relay
(simulated keys and verifier by default in development; set the `VITE_SIM_*` flags in `.env.local`).
