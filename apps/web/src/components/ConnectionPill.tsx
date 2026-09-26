// ConnectionPill (spec B6.3): Connected / Reconnecting… / Offline. Colour crossfades between
// states; "Reconnecting" pulses three dots in sequence; "Offline" slides a small ✕ in.
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ConnectionState } from "@/services/types";
import { dur, ease } from "@/design/motion";
import { cn } from "@/lib/cn";

export function ConnectionPill({ state, className }: { state: ConnectionState; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full pl-2.5 pr-3 text-caption font-medium transition-colors duration-300",
        state === "offline"
          ? "bg-[color-mix(in_oklab,var(--ink)_10%,transparent)] text-ink"
          : "bg-surface-2 text-ink-2",
        className,
      )}
    >
      <span className="relative grid h-3 w-5 place-items-center" aria-hidden>
        <AnimatePresence mode="popLayout" initial={false}>
          {state === "connected" && (
            <m.span
              key="c"
              className="h-2 w-2 rounded-full bg-reachable shadow-[0_0_0_3px_color-mix(in_oklab,var(--reachable)_22%,transparent)]"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: dur.fast, ease: ease.out }}
            />
          )}
          {state === "reconnecting" && (
            <m.span
              key="r"
              className="flex items-center gap-[3px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.fast }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-[4px] w-[4px] rounded-full bg-current"
                  style={{ animation: `dots 1.1s ${i * 0.16}s infinite ease-in-out` }}
                />
              ))}
            </m.span>
          )}
          {state === "offline" && (
            <m.span
              key="o"
              className="grid h-4 w-4 place-items-center rounded-full bg-ink text-bg"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: dur.base, ease: ease.out }}
            >
              <X size={10} weight="bold" />
            </m.span>
          )}
        </AnimatePresence>
      </span>
      <span className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <m.span
            key={state}
            className="block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: dur.fast, ease: ease.out }}
          >
            {t(`conn.${state}`)}
          </m.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
