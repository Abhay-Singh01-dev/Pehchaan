// Form controls: ChipGroup, Switch, Segmented, TextField, SelectCard.
import { useId, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Check } from "@phosphor-icons/react";
import { dur, ease, spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

// ─── ChipGroup ─────────────────────────────────────────────────────────────
// Single-select chips. Selection fills from the centre (fill layer scales 0.9 → 1) and the
// text colour crossfades (spec B6.3).

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: "md" | "sm";
}) {
  const reduced = useReduced();
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <m.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              if (!selected) haptic("chip");
              onChange(o.value);
            }}
            whileTap={{ scale: 0.96 }}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              default: spring.ui,
              opacity: { duration: dur.base, delay: Math.min(i, 7) * 0.035 },
              y: { ...spring.soft, delay: Math.min(i, 7) * 0.035 },
            }}
            className={cn(
              "relative inline-flex items-center gap-2 overflow-hidden rounded-[12px] font-medium",
              size === "md" ? "min-h-12 px-4 text-body" : "min-h-10 px-3.5 text-body-sm",
              "shadow-[inset_0_0_0_1px_var(--line)]",
            )}
          >
            <AnimatePresence initial={false}>
              {selected && (
                <m.span
                  aria-hidden
                  className="absolute inset-0 rounded-[12px] bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduced ? 1 : 0.94 }}
                  transition={reduced ? { duration: dur.reduced } : spring.ui}
                />
              )}
            </AnimatePresence>
            {o.icon && <span className="relative">{o.icon}</span>}
            <span
              className={cn(
                "relative transition-colors",
                selected ? "text-brand-ink" : "text-ink-2",
              )}
              style={{ transitionDuration: `${dur.fast * 1000}ms` }}
            >
              {o.label}
            </span>
          </m.button>
        );
      })}
    </div>
  );
}

// ─── Switch ────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic("chip");
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full p-1 transition-colors duration-200",
        checked ? "bg-brand" : "bg-[color-mix(in_oklab,var(--ink)_18%,transparent)]",
        "disabled:opacity-50",
      )}
    >
      <m.span
        className="block h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_rgba(10,14,31,0.25)]"
        animate={{ x: checked ? 20 : 0 }}
        transition={spring.ui}
      />
    </button>
  );
}

// ─── Segmented ─────────────────────────────────────────────────────────────
// A segmented control with a sliding active indicator (History, Display settings).

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  id,
  className,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  id: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) haptic("chip");
              onChange(o.value);
            }}
            className={cn(
              "relative min-h-11 rounded-full px-3 text-body-sm font-semibold transition-colors duration-150",
              active ? "text-ink" : "text-muted",
            )}
          >
            {active && (
              <m.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_2px_rgba(15,20,48,0.08),0_4px_12px_rgba(15,20,48,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                transition={spring.ui}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── TextField ─────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  prefix,
  placeholder,
  inputMode,
  autoFocus,
  maxLength,
  autoComplete,
  type = "text",
  onBlur,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string | null;
  prefix?: ReactNode;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "tel";
  autoFocus?: boolean;
  maxLength?: number;
  autoComplete?: string;
  type?: string;
  onBlur?: () => void;
  onEnter?: () => void;
}) {
  const id = useId();
  const reduced = useReduced();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-body-sm font-medium text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-14 items-center gap-2 rounded-[12px] bg-surface-2 px-4 transition-shadow duration-150",
          "focus-within:shadow-[inset_0_0_0_2px_var(--brand)]",
          error ? "shadow-[inset_0_0_0_2px_var(--chip-no)]" : "shadow-[inset_0_0_0_1px_var(--line)]",
        )}
      >
        {prefix && <span className="font-mono text-body font-medium text-muted">{prefix}</span>}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEnter?.();
          }}
          placeholder={placeholder}
          inputMode={inputMode}
          autoFocus={autoFocus}
          maxLength={maxLength}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className="min-w-0 flex-1 bg-transparent py-3 text-body text-ink outline-none placeholder:text-muted"
          style={{ outline: "none" }}
        />
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {error ? (
          <m.p
            key="err"
            id={`${id}-err`}
            role="alert"
            className="mt-2 text-body-sm font-medium text-chip-no"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -4 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, x: [0, -4, 4, -2, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: ease.out }}
          >
            {error}
          </m.p>
        ) : hint ? (
          <m.p
            key="hint"
            id={`${id}-hint`}
            className="mt-2 text-body-sm text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {hint}
          </m.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ─── SelectCard ────────────────────────────────────────────────────────────
// A large selectable card (A2 language, A5 role, I1d language). The selected card lifts
// (y: -2, shadow-2) and its border animates to --brand; its fill grows from the centre.

export function SelectCard({
  selected,
  dimmed,
  onClick,
  icon,
  title,
  hint,
  lang,
  className,
  role = "radio",
}: {
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  lang?: string;
  className?: string;
  role?: "radio" | "button";
}) {
  const reduced = useReduced();
  return (
    <m.button
      type="button"
      role={role}
      aria-checked={role === "radio" ? selected : undefined}
      lang={lang}
      onClick={() => {
        haptic("chip");
        onClick();
      }}
      whileTap={{ scale: 0.985 }}
      animate={{
        y: selected && !reduced ? -2 : 0,
        opacity: dimmed ? 0.4 : 1,
      }}
      transition={spring.ui}
      className={cn(
        "relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] bg-surface p-5 text-left",
        "transition-shadow duration-300",
        selected
          ? "shadow-[var(--shadow-2),inset_0_0_0_2px_var(--brand)]"
          : "shadow-[var(--shadow-1),inset_0_0_0_1px_var(--line)]",
        className,
      )}
    >
      <AnimatePresence>
        {selected && (
          <m.span
            aria-hidden
            className="absolute inset-0 bg-brand-soft"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 0.55, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: dur.reduced } : { duration: dur.slow, ease: ease.out }}
            style={{ borderRadius: "inherit" }}
          />
        )}
      </AnimatePresence>
      {icon && (
        <span
          className={cn(
            "relative grid h-14 w-14 shrink-0 place-items-center rounded-[18px] transition-colors duration-300",
            selected ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-ink",
          )}
        >
          {icon}
        </span>
      )}
      <span className="relative min-w-0 flex-1">
        <span className="block font-display text-h3 font-semibold text-ink">{title}</span>
        {hint && <span className="mt-1 block text-body-sm text-ink-2">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-200",
          selected ? "bg-brand text-on-brand" : "shadow-[inset_0_0_0_2px_var(--line)]",
        )}
        aria-hidden
      >
        {selected && (
          <m.span initial={reduced ? false : { scale: 0.4 }} animate={{ scale: 1 }} transition={spring.ui}>
            <Check size={16} weight="bold" />
          </m.span>
        )}
      </span>
    </m.button>
  );
}
