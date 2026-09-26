// Avatar (spec B12.0): initials on the avatar colour; sizes 28 / 40 / 56 / 88; an optional
// "reachable" dot (green 10px with a surface ring) and an optional pulse ring.
import * as m from "motion/react-m";
import type { AvatarColor } from "@/services/types";
import { initials } from "@/lib/format";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";
import { useTranslation } from "react-i18next";

interface AvatarProps {
  name: string;
  color: AvatarColor;
  size?: number;
  reachable?: boolean;
  /** "gentle": one soft ring (waiting); "heartbeat": two beats, pause, repeat (incoming request). */
  pulse?: "gentle" | "heartbeat" | null;
  layoutId?: string;
  className?: string;
  /** Show the reachable dot slot even when not reachable (with a hollow dot). */
  showPresence?: boolean;
}

export function Avatar({ name, color, size = 40, reachable, pulse, layoutId, className, showPresence }: AvatarProps) {
  const reduced = useReduced();
  const { t } = useTranslation();
  const dot = Math.max(10, Math.round(size * 0.18));
  const content = (
    <span
      className="relative grid h-full w-full place-items-center overflow-hidden rounded-full"
      style={{ background: `var(--av-${color})` }}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(120% 120% at 25% 15%, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
        }}
      />
      <span
        className="relative font-display font-semibold leading-none text-white"
        style={{ fontSize: Math.round(size * 0.38), letterSpacing: "0.01em" }}
      >
        {initials(name)}
      </span>
    </span>
  );

  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {pulse && !reduced && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {(pulse === "heartbeat" ? [0, 0.28] : [0]).map((delay) => (
            <m.span
              key={delay}
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: `0 0 0 2px var(--av-${color})` }}
              initial={{ scale: 1, opacity: 0 }}
              animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
              transition={{
                duration: pulse === "heartbeat" ? 0.9 : 1.1,
                delay,
                repeat: Infinity,
                repeatDelay: pulse === "heartbeat" ? 0.9 : 0.1,
                ease: "easeOut",
              }}
            />
          ))}
        </span>
      )}
      {layoutId ? (
        <m.span layoutId={layoutId} className="block h-full w-full" transition={{ type: "spring", stiffness: 220, damping: 26 }}>
          {content}
        </m.span>
      ) : (
        content
      )}
      {(reachable || showPresence) && (
        <span
          role="img"
          aria-label={reachable ? t("a11y.reachable") : t("a11y.notReachable")}
          className={cn(
            "absolute rounded-full ring-2 ring-[var(--surface)] transition-colors duration-300",
            reachable ? "bg-reachable" : "bg-surface-2",
          )}
          style={{ width: dot, height: dot, right: size > 60 ? 4 : 0, bottom: size > 60 ? 4 : 0 }}
        />
      )}
    </span>
  );
}
