// Layout primitives shared by the family-app screens: the page body (20px side padding,
// bottom inset for the tab bar or bottom actions), the big heading, sections and footers.
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { riseIn } from "@/design/motion";
import { useReduced } from "@/app/session";
import { SIM_OFFSET } from "../SimulationBadge";
import { cn } from "@/lib/cn";

export function PageBody({
  children,
  className,
  withTabBar,
  noTopBar,
}: {
  children: ReactNode;
  className?: string;
  /** Leaves room for the floating tab bar. */
  withTabBar?: boolean;
  /** The page has no TopBar, so it must clear the status bar (and the simulation badge). */
  noTopBar?: boolean;
}) {
  return (
    <div
      className={cn("relative px-5", className)}
      style={{
        paddingTop: noTopBar ? `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 16}px)` : undefined,
        paddingBottom: withTabBar
          ? "calc(env(safe-area-inset-bottom) + 112px)"
          : "calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      {children}
    </div>
  );
}

/** The screen's big heading (h1). The TopBar title fades in once this scrolls away. */
export function PageTitle({
  children,
  sub,
  className,
  size = "h1",
}: {
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
  size?: "h1" | "display" | "h2";
}) {
  const reduced = useReduced();
  return (
    <m.div className={cn("mb-6", className)} {...riseIn(0, reduced)}>
      <h1
        className={cn(
          "font-display font-semibold text-ink",
          size === "display" ? "text-display" : size === "h2" ? "text-h2" : "text-h1",
        )}
      >
        {children}
      </h1>
      {sub && <p className="mt-2 text-body text-ink-2">{sub}</p>}
    </m.div>
  );
}

export function Section({
  title,
  children,
  className,
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("mt-8", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          {title && <h2 className="font-display text-h3 font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Bottom action area: primary action within thumb reach (spec B9 #9). */
export function BottomActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("sticky bottom-0 z-20 -mx-5 mt-8 px-5 pt-4", className)}
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        // Same grain as the page, so the action area never reads as a flat band.
        backgroundImage: "var(--noise), linear-gradient(180deg, transparent, var(--bg) 32%)",
        backgroundSize: "160px 160px, 100% 100%",
      }}
    >
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** Small uppercase label (caption + 0.06em tracking, tiny labels only). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-caption font-medium uppercase tracking-[0.06em] text-muted", className)}>{children}</div>
  );
}
