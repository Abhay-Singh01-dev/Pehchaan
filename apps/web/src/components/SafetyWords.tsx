// SafetyWords (spec B12.0): four words in mono, separated by thin dots, in a --brand-soft
// panel, flipping in one by one (rotateX 90° → 0, staggered 80 ms).
import { Fragment } from "react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ease } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

export function SafetyWords({
  words,
  size = "md",
  flip = true,
  delay = 0,
  className,
  label,
}: {
  words: readonly string[];
  size?: "md" | "lg";
  flip?: boolean;
  delay?: number;
  className?: string;
  label?: string;
}) {
  const reduced = useReduced();
  const { t } = useTranslation();
  const animate = flip && !reduced;
  return (
    <div
      className={cn("rounded-[18px] bg-brand-soft px-4 py-4", className)}
      style={{ perspective: 700 }}
      role="group"
      aria-label={label ?? t("family.words")}
    >
      {size === "lg" ? (
        // Large: two pairs, read aloud as "GOLD · SPRING — WHEAT · CANDLE". Never wraps mid-pair.
        <div className="flex flex-col items-center gap-1.5 font-mono text-mono-lg font-semibold tracking-[0.06em] text-brand-ink">
          {[0, 2].map((row) => (
            <p key={row} className="flex items-center justify-center gap-3 whitespace-nowrap">
              {words.slice(row, row + 2).map((w, j) => (
                <Fragment key={`${w}-${row + j}`}>
                  <m.span
                    className="inline-block"
                    style={{ transformOrigin: "50% 100%", backfaceVisibility: "hidden" }}
                    initial={animate ? { rotateX: 90, opacity: 0 } : false}
                    animate={{ rotateX: 0, opacity: 1 }}
                    transition={{ duration: 0.42, delay: delay + (row + j) * 0.08, ease: ease.out }}
                  >
                    {w}
                  </m.span>
                  {j === 0 && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brass opacity-80" />}
                </Fragment>
              ))}
            </p>
          ))}
        </div>
      ) : (
        <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 font-mono text-mono font-semibold tracking-[0.08em] text-brand-ink">
          {words.map((w, i) => (
            <Fragment key={`${w}-${i}`}>
              <m.span
                className="inline-block"
                style={{ transformOrigin: "50% 100%", backfaceVisibility: "hidden" }}
                initial={animate ? { rotateX: 90, opacity: 0 } : false}
                animate={{ rotateX: 0, opacity: 1 }}
                transition={{ duration: 0.42, delay: delay + i * 0.08, ease: ease.out }}
              >
                {w}
              </m.span>
              {i < words.length - 1 && <span aria-hidden className="h-1 w-1 rounded-full bg-brass opacity-80" />}
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}
