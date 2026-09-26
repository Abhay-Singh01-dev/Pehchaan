// VerdictScreen (spec B12 E1–E5, B6.4 #8) — the most important animation in the product.
//
//   0.00 s  the verdict colour floods the screen: a circular clip-path reveal from the origin
//           (done by the route frame, dur.verdict, ease.inOut)
//   0.39 s  at 60% of the reveal the seal STAMPS in: scale 1.35 → 1, rotation −8° → 0,
//           opacity 0 → 1 with spring.stamp
//   ~0.49   impact: one soft ink-ring ripple (500 ms) + the haptic + the sound
//           the icon inside the seal draws (300 ms)
//   +0.08   the headline rises 12px and fades in; then the body, then the buttons (60 ms apart)
//   detail  Confirmed: one slow brass sheen across the seal, then stillness
//           Not them: a firm 2-cycle horizontal shake of the seal only (±6px, 260 ms)
//           Fake answer: a 180 ms RGB-split glitch, then the shield; the hatch fades in behind
//           Not confirmed: the clock hand sweeps once, slowly
//           Can't verify: the question mark rocks once (±4°)
// Reduced motion: no reveal, no stamp — the colour, seal and text simply fade in (B6.6).
// Verdicts are announced with aria-live="assertive" (B10).
import { useEffect, useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import type { VerdictResult } from "@/services/types";
import { isGreenAllowed } from "@/services/verdict";
import { Seal, type SealState } from "./Seal";
import { useReduced } from "@/app/session";
import { haptic } from "@/design/haptics";
import { sounds } from "@/design/sounds";
import { ease, spring } from "@/design/motion";
import { cn } from "@/lib/cn";

export type VerdictTone = "ok" | "no" | "fake" | "amber";

export const VERDICT_TONE: Record<VerdictResult["verdict"], VerdictTone> = {
  VERIFIED: "ok",
  DENIED: "no",
  INVALID: "fake",
  NO_RESPONSE: "amber",
  UNKNOWN_PERSON: "amber",
};

const SEAL_STATE: Record<VerdictResult["verdict"], SealState> = {
  VERIFIED: "confirmed",
  DENIED: "denied",
  INVALID: "fake",
  NO_RESPONSE: "clock",
  UNKNOWN_PERSON: "unknown",
};

/** B9 #1, belt and braces: a VERIFIED result without 7 passing checks is shown as a fake. */
export function safeVerdict(result: VerdictResult): VerdictResult {
  if (result.verdict === "VERIFIED" && !isGreenAllowed(result)) {
    return { ...result, verdict: "INVALID", invalidReason: "bad_signature" };
  }
  return result;
}

export interface VerdictTiming {
  stamp: number;
  impact: number;
  headline: number;
  body: number;
  actions: number;
}

export function useVerdictTiming(): VerdictTiming {
  const reduced = useReduced();
  if (reduced) return { stamp: 0, impact: 0, headline: 0, body: 0, actions: 0 };
  const stamp = 0.39;
  const impact = stamp + 0.1;
  return { stamp, impact, headline: impact + 0.08, body: impact + 0.14, actions: impact + 0.2 };
}

/** Headline/body/button entrance: rise 12px and fade, at a given delay. */
export function useRise(delay: number) {
  const reduced = useReduced();
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.42, delay, ease: ease.out },
      };
}

function StampedSeal({ result, timing }: { result: VerdictResult; timing: VerdictTiming }) {
  const reduced = useReduced();
  const tone = VERDICT_TONE[result.verdict];
  const state = SEAL_STATE[result.verdict];
  const sealTone = tone === "amber" ? "dark" : "light";
  const glitch = state === "fake" && !reduced;
  const drawDelay = timing.impact + (glitch ? 0.18 : 0);

  // Per-verdict movement of the seal itself (never the whole screen).
  const detail = reduced
    ? {}
    : state === "denied"
      ? {
          animate: { x: [0, -6, 6, -6, 6, 0] },
          transition: { duration: 0.26, delay: timing.impact + 0.04, ease: "easeInOut" as const },
        }
      : state === "unknown"
        ? {
            animate: { rotate: [0, -4, 4, 0] },
            transition: { duration: 0.6, delay: timing.impact + 0.45, ease: "easeInOut" as const },
          }
        : {};

  return (
    <div className="relative grid place-items-center" style={{ width: 120, height: 120 }}>
      {/* Ink ring ripple on impact */}
      {!reduced && (
        <m.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 2px ${tone === "amber" ? "rgba(31,19,0,0.45)" : "rgba(255,255,255,0.55)"}` }}
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.9], opacity: [0.9, 0] }}
          transition={{ duration: 0.5, delay: timing.impact, ease: ease.out }}
        />
      )}
      <m.div
        initial={reduced ? { opacity: 0 } : { scale: 1.35, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={
          reduced
            ? { duration: 0.12 }
            : { default: { ...spring.stamp, delay: timing.stamp }, opacity: { duration: 0.1, delay: timing.stamp } }
        }
      >
        <m.div {...detail} className="relative">
          <Seal size={120} state={state} tone={sealTone} draw drawDelay={drawDelay} />
          {/* Fake answer: two RGB-split frames before the shield settles. */}
          {glitch && (
            <>
              <m.div
                aria-hidden
                className="absolute inset-0"
                style={{ mixBlendMode: "screen" }}
                initial={{ opacity: 0, x: 0 }}
                animate={{ opacity: [0, 0.9, 0, 0.9, 0], x: [0, -2, -2, 2, 0] }}
                transition={{ duration: 0.18, delay: timing.impact, times: [0, 0.2, 0.5, 0.7, 1] }}
              >
                <Seal size={120} state="fake" mono="#FF4D6A" />
              </m.div>
              <m.div
                aria-hidden
                className="absolute inset-0"
                style={{ mixBlendMode: "screen" }}
                initial={{ opacity: 0, x: 0 }}
                animate={{ opacity: [0, 0.8, 0, 0.8, 0], x: [0, 2, 2, -2, 0] }}
                transition={{ duration: 0.18, delay: timing.impact, times: [0, 0.2, 0.5, 0.7, 1] }}
              >
                <Seal size={120} state="fake" mono="#3FE0FF" />
              </m.div>
            </>
          )}
          {/* Confirmed: one slow brass sheen, then stillness. */}
          {state === "confirmed" && !reduced && (
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <m.span
                className="absolute inset-y-0 w-1/2"
                style={{ background: "linear-gradient(100deg, transparent, rgba(233,207,150,0.75), transparent)" }}
                initial={{ x: "-120%", opacity: 0 }}
                animate={{ x: "260%", opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.1, delay: timing.impact + 0.5, ease: ease.inOut }}
              />
            </span>
          )}
        </m.div>
      </m.div>
    </div>
  );
}

export function VerdictScreen({
  result,
  title,
  body,
  meta,
  announceBody,
  children,
  actions,
  className,
}: {
  result: VerdictResult;
  title: string;
  body: ReactNode;
  /** e.g. "Arjun's key · 4 s ago" */
  meta?: ReactNode;
  /** Plain-text body for the screen-reader announcement. */
  announceBody?: string;
  children?: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  const reduced = useReduced();
  const timing = useVerdictTiming();
  const tone = VERDICT_TONE[result.verdict];
  const [announce, setAnnounce] = useState("");
  const { t } = useTranslation();
  const bodyText = announceBody ?? (typeof body === "string" ? body : "");

  // Impact: haptic + sound + the screen-reader announcement.
  useEffect(() => {
    const id = window.setTimeout(() => {
      switch (result.verdict) {
        case "VERIFIED":
          haptic("confirmed");
          sounds.confirmed();
          break;
        case "DENIED":
          haptic("denied");
          sounds.denied();
          break;
        case "INVALID":
          haptic("fake");
          sounds.denied();
          break;
        default:
          haptic("amber");
          sounds.amber();
      }
      setAnnounce(t("announce.verdict", { title, body: bodyText }));
    }, timing.impact * 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headline = useRise(timing.headline);
  const bodyRise = useRise(timing.body);
  const metaRise = useRise(timing.body + 0.04);

  return (
    <div
      className={cn(
        "relative min-h-app overflow-hidden",
        tone === "ok" && "v-ok",
        tone === "no" && "v-no",
        tone === "fake" && "v-fake",
        tone === "amber" && "v-amber",
        className,
      )}
    >
      {tone === "fake" && (
        <m.div
          aria-hidden
          className="hatch pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0.12 : 0.6, delay: reduced ? 0 : timing.impact + 0.2 }}
        />
      )}
      {/* A soft light from above, so the seal sits on the brighter part and text on the darker. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60%] bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,255,255,0.16),transparent_70%)]"
      />

      <div
        className="relative mx-auto flex min-h-app w-full max-w-[480px] flex-col px-6"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 64px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
        }}
      >
        <div aria-live="assertive" className="sr-only">
          {announce}
        </div>
        <div className="flex flex-col items-center text-center">
          <StampedSeal result={result} timing={timing} />
          <m.h1 className="mt-7 font-display text-display font-semibold" {...headline}>
            {title}
          </m.h1>
          <m.div className="mt-3 max-w-[32ch] text-body font-medium opacity-95" {...bodyRise}>
            {body}
          </m.div>
          {meta && (
            <m.p className="mt-3 font-mono text-caption font-medium tracking-wide opacity-80" {...metaRise}>
              {meta}
            </m.p>
          )}
        </div>
        {children && <div className="mt-7">{children}</div>}
        <div className="flex-1" />
        <div className="mt-8 flex flex-col gap-2.5">{actions}</div>
      </div>
    </div>
  );
}

/** Buttons at the bottom of a verdict, staggered 60 ms after the body. */
export function VerdictAction({ index, children }: { index: number; children: ReactNode }) {
  const timing = useVerdictTiming();
  const rise = useRise(timing.actions + index * 0.06);
  return <m.div {...rise}>{children}</m.div>;
}
