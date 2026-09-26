// Rolling digits (spec B6.3): each digit is its own column and rolls vertically when it
// changes; Indian grouping commas slide into place. Used by AmountInput, countdowns and the
// Lab counters. Digits are keyed by their position from the right, so growing a number adds
// new columns on the left while existing ones roll in place.
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { spring } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function DigitColumn({ digit, reduced }: { digit: number; reduced: boolean }) {
  return (
    <span className="relative inline-block h-[1.2em] w-[1ch] overflow-hidden align-bottom" aria-hidden>
      <m.span
        className="absolute left-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-digit * 1.2}em` }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1.2em] leading-[1.2em]">
            {d}
          </span>
        ))}
      </m.span>
    </span>
  );
}

/** Renders `text` (digits and separators) with rolling digit columns. */
export function RollingText({ text, className, label }: { text: string; className?: string; label?: string }) {
  const reduced = useReduced();
  const chars = Array.from(text);
  return (
    <span className={cn("inline-flex items-end font-mono tabular-nums leading-[1.2em]", className)} aria-label={label ?? text} role="text">
      <AnimatePresence initial={false} mode="popLayout">
        {chars.map((ch, i) => {
          const fromRight = chars.length - i;
          const isDigit = /\d/.test(ch);
          return (
            <m.span
              key={`${isDigit ? "d" : "s"}${fromRight}${isDigit ? "" : ch}`}
              layout={!reduced}
              className="inline-block"
              initial={reduced ? false : { opacity: 0, y: isDigit ? "0.4em" : 0, x: isDigit ? 0 : 4 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={spring.ui}
            >
              {isDigit ? <DigitColumn digit={Number(ch)} reduced={reduced} /> : <span aria-hidden>{ch}</span>}
            </m.span>
          );
        })}
      </AnimatePresence>
    </span>
  );
}
