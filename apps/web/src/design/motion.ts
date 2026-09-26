// Motion tokens (spec B6.1). Motion should feel calm, weighty and precise, like a heavy
// brass seal pressed onto paper: never bouncy. Durations are in seconds (Motion's unit).
import type { Transition } from "motion/react";

export const dur = {
  instant: 0.09,
  fast: 0.16,
  base: 0.24,
  slow: 0.38,
  verdict: 0.65,
  /** Reduced motion replaces every movement with this crossfade (B6.6). */
  reduced: 0.12,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const spring = {
  /** Buttons, chips, tabs */
  ui: { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } satisfies Transition,
  /** Sheets, cards, page elements */
  soft: { type: "spring", stiffness: 220, damping: 26 } satisfies Transition,
  /** The seal press */
  stamp: { type: "spring", stiffness: 520, damping: 22 } satisfies Transition,
} as const;

/** 45 ms between list items; at most 8 items are staggered, the rest appear together. */
export const STAGGER = 0.045;
export const MAX_STAGGERED = 8;
export const staggerDelay = (index: number, base = 0) => base + Math.min(index, MAX_STAGGERED - 1) * STAGGER;

export const reducedFade: Transition = { duration: dur.reduced, ease: "linear" };

/**
 * Standard list/card entrance: y 8 → 0, opacity 0 → 1, staggered (B6.3).
 * Per-property transitions keep the stagger delay off press (whileTap) animations.
 */
export const riseIn = (index = 0, reduced = false, base = 0) => {
  const delay = staggerDelay(index, base);
  return reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { default: spring.ui, opacity: reducedFade },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: {
          default: spring.ui,
          opacity: { duration: dur.base, ease: ease.out, delay },
          y: { ...spring.soft, delay },
        },
      };
};
