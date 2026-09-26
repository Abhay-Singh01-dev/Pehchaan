// CountdownRing and CountdownBar (spec B6.3): an SVG ring / thin bar that depletes smoothly
// (not per second). The number ticks with a subtle vertical roll. In the last 10 s it turns
// amber. Reduced motion still counts down (B6.6).
import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { RollingText } from "./Rolling";
import { cn } from "@/lib/cn";

/** Seconds left until `expiresAt`, updated a few times per second. */
export function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

const WARN_AT = 10;

export function CountdownRing({
  expiresAt,
  totalMs = 60_000,
  size = 132,
  stroke = 4,
  showNumber = false,
  className,
}: {
  expiresAt: number;
  totalMs?: number;
  size?: number;
  stroke?: number;
  showNumber?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const seconds = useSecondsLeft(expiresAt);
  const [start] = useState(() => {
    const remaining = Math.max(0, expiresAt - Date.now());
    return { frac: Math.min(1, remaining / totalMs), remaining };
  });
  const warn = seconds <= WARN_AT;
  const r = 50 - (stroke * 100) / size / 2 - 0.5;

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={(stroke * 100) / size} />
        <m.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={(stroke * 100) / size}
          strokeLinecap="round"
          style={{ stroke: warn ? "#FDB022" : "rgba(255,255,255,0.92)", transition: "stroke 400ms ease" }}
          initial={{ pathLength: start.frac }}
          animate={{ pathLength: 0 }}
          transition={{ duration: start.remaining / 1000, ease: "linear" }}
        />
      </svg>
      {showNumber && (
        <div className="absolute inset-0 grid place-items-center text-mono-lg font-semibold text-white">
          <RollingText text={String(seconds)} label={t("a11y.secondsLeft", { count: seconds })} />
        </div>
      )}
    </div>
  );
}

export function CountdownBar({
  expiresAt,
  totalMs = 60_000,
  className,
}: {
  expiresAt: number;
  totalMs?: number;
  className?: string;
}) {
  const seconds = useSecondsLeft(expiresAt);
  const [start] = useState(() => {
    const remaining = Math.max(0, expiresAt - Date.now());
    return { frac: Math.min(1, remaining / totalMs), remaining };
  });
  const warn = seconds <= WARN_AT;
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-white/10", className)} aria-hidden>
      <m.div
        className="h-full w-full origin-left rounded-full"
        style={{ background: warn ? "#FDB022" : "#8C95FF", transition: "background-color 400ms ease" }}
        initial={{ scaleX: start.frac }}
        animate={{ scaleX: 0 }}
        transition={{ duration: start.remaining / 1000, ease: "linear" }}
      />
    </div>
  );
}
