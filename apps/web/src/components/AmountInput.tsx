// AmountInput (spec B6.3, B12.0): ₹ prefix, rolling digits, Indian grouping, numeric keypad,
// quick chips ₹5,000 / ₹10,000 / ₹25,000 / ₹50,000. A real (transparent) input captures typing
// for keyboards and screen readers; the visible number is the animated rendering of its value.
import { useRef, useState } from "react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { RollingText } from "./Rolling";
import { formatINR, groupIN } from "@/lib/format";
import { haptic } from "@/design/haptics";
import { spring } from "@/design/motion";
import { cn } from "@/lib/cn";

const QUICK = [5000, 10000, 25000, 50000];
const MAX_DIGITS = 8; // up to ₹9,99,99,999

export function AmountInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "relative flex h-[76px] items-center gap-2 rounded-[18px] bg-surface-2 px-5 transition-shadow duration-150",
          focused ? "shadow-[inset_0_0_0_2px_var(--brand)]" : "shadow-[inset_0_0_0_1px_var(--line)]",
        )}
      >
        <span className="font-display text-[1.75rem] font-semibold text-muted" aria-hidden>
          ₹
        </span>
        <span className="relative flex min-w-0 flex-1 items-center text-[2.125rem] font-semibold text-ink" aria-hidden>
          {value ? <RollingText text={groupIN(value)} /> : <span className="font-mono text-muted/60">0</span>}
          {focused && (
            <span
              className="ml-0.5 inline-block h-[1.05em] w-[2px] rounded bg-brand"
              style={{ animation: "caret-blink 1.05s steps(1) infinite" }}
            />
          )}
        </span>
        <input
          ref={inputRef}
          aria-label={t("verify.amountLabel")}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={value ? String(value) : ""}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
            onChange(digits ? Number(digits) : null);
          }}
          className="absolute inset-0 h-full w-full cursor-text rounded-[18px] bg-transparent text-transparent caret-transparent opacity-0"
        />
      </div>
      <div className="scroll-x -mx-5 mt-3 flex gap-2 px-5">
        {QUICK.map((q) => {
          const selected = value === q;
          return (
            <m.button
              key={q}
              type="button"
              whileTap={{ scale: 0.95 }}
              transition={spring.ui}
              onClick={() => {
                haptic("chip");
                onChange(q);
              }}
              aria-pressed={selected}
              className={cn(
                "h-11 shrink-0 rounded-full px-4 font-mono text-body-sm font-semibold transition-colors duration-150",
                selected
                  ? "bg-brand text-on-brand"
                  : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]",
              )}
            >
              {formatINR(q)}
            </m.button>
          );
        })}
      </div>
    </div>
  );
}
