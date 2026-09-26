// One screen in the transition stack. Each frame is its own scroll container with an opaque
// page background (bg + top glow + noise), exposes its scroll position to the TopBar, and runs
// the enter/exit animation chosen in transitions.ts.
import { Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { useIsPresent, useScroll, type Variants } from "motion/react";
import { ScrollContext } from "@/components/screen/ScrollContext";
import { PageSkeleton } from "@/components/Skeleton";
import { centre, coverRadius, takeOrigin, toFrame, type Point } from "@/design/origin";
import { dur, ease } from "@/design/motion";
import type { TransitionKind } from "./transitions";

export interface FrameCustom {
  kind: TransitionKind;
  reduced: boolean;
}

const variants: Variants = {
  initial: ({ kind, reduced }: FrameCustom) => {
    if (reduced) return kind === "none" ? { opacity: 1 } : { opacity: 0 };
    switch (kind) {
      case "forward":
        return { x: 28, opacity: 0 };
      case "back":
        return { x: -28, opacity: 0 };
      case "tab":
      case "fade":
        return { opacity: 0 };
      default:
        return { opacity: 1 };
    }
  },
  enter: ({ kind, reduced }: FrameCustom) => {
    if (reduced) return { x: 0, opacity: 1, transition: { duration: dur.reduced } };
    switch (kind) {
      case "forward":
      case "back":
        return { x: 0, opacity: 1, transition: { duration: dur.base, ease: ease.out } };
      case "tab":
        return { opacity: 1, transition: { duration: dur.fast } };
      case "fade":
        return { opacity: 1, transition: { duration: dur.base, ease: ease.out } };
      default:
        return { x: 0, opacity: 1, transition: { duration: 0 } };
    }
  },
  exit: ({ kind, reduced }: FrameCustom) => {
    if (reduced) return { opacity: 0, transition: { duration: dur.reduced } };
    switch (kind) {
      case "forward":
        return { x: -12, opacity: 0, transition: { duration: dur.fast, ease: ease.out } };
      case "back":
        return { x: 12, opacity: 0, transition: { duration: dur.fast, ease: ease.out } };
      case "tab":
        return { opacity: 0, transition: { duration: dur.fast } };
      case "reveal":
      case "takeover":
      case "brand":
        // Stay put underneath while the new screen reveals over it.
        return { opacity: 1, transition: { duration: dur.verdict + 0.05 } };
      case "fade":
        return { opacity: 1, transition: { duration: dur.base } };
      default:
        return { opacity: 0, transition: { duration: 0 } };
    }
  },
};

/** Circular clip-path reveal (spec B6.2 full-screen takeovers, B6.4 #6 Verify button). */
function RevealLayer({ kind, origin, children }: { kind: TransitionKind; origin: Point; children: ReactNode }) {
  if (kind !== "reveal" && kind !== "takeover" && kind !== "brand") return <>{children}</>;
  const r = coverRadius(origin);
  const duration = kind === "brand" ? dur.slow + 0.06 : dur.verdict;
  return (
    <m.div
      className="frame-bg relative min-h-full"
      initial={{ clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }}
      // Once revealed, drop the clip entirely so content taller than the screen isn't cut off.
      animate={{ clipPath: `circle(${r}px at ${origin.x}px ${origin.y}px)`, transitionEnd: { clipPath: "none" } }}
      transition={{ duration, ease: ease.inOut }}
    >
      {children}
      {kind === "brand" && (
        // The Verify button's colour floods out from the tap, then clears to the new screen.
        <m.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50"
          style={{ background: "linear-gradient(150deg, var(--brand), var(--brand-strong))" }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: dur.base, delay: duration - 0.02, ease: ease.out }}
        />
      )}
    </m.div>
  );
}

export function RouteFrame({ kind, reduced, children }: { kind: TransitionKind; reduced: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: ref });
  const isPresent = useIsPresent();
  // Captured once, on mount: where this screen reveals from.
  // (In the phone frame's own coordinates: the clip-path circle is drawn inside it.)
  const [origin] = useState<Point>(() => toFrame(kind === "takeover" ? centre() : takeOrigin()));
  const [animating, setAnimating] = useState(kind !== "none");
  const effectiveKind: TransitionKind = reduced ? "none" : kind;
  // Reveal kinds clip their content; the (opaque) page background must be clipped with it.
  const clipped = effectiveKind === "reveal" || effectiveKind === "takeover" || effectiveKind === "brand";

  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, []);

  return (
    <m.div
      ref={ref}
      custom={{ kind, reduced }}
      variants={variants}
      initial="initial"
      animate="enter"
      exit="exit"
      onAnimationComplete={() => setAnimating(false)}
      className={`scroll-y absolute inset-0 overflow-x-hidden ${clipped ? "" : "frame-bg"}`}
      style={{
        zIndex: isPresent ? 2 : 1,
        willChange: animating ? "transform, opacity" : undefined,
        pointerEvents: isPresent ? undefined : "none",
      }}
      data-transition={kind}
    >
      {effectiveKind === "takeover" && (
        // Whatever was open blurs behind the incoming request as it rises (B6.4 #10).
        <m.div
          aria-hidden
          className="fixed inset-0"
          style={{ background: "var(--scrim)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: dur.verdict + 0.25, times: [0, 0.3, 0.85, 1] }}
        />
      )}
      <ScrollContext.Provider value={scrollY}>
        <RevealLayer kind={effectiveKind} origin={origin}>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </RevealLayer>
      </ScrollContext.Provider>
    </m.div>
  );
}
