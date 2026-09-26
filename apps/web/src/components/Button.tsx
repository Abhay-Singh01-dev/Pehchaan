// Buttons (spec B6.3, B12.0): press scales to 0.97 and releases with spring.ui; primary
// buttons carry a soft inner highlight that shifts 2px on press. Disabled buttons don't animate.
import { forwardRef, type ReactNode } from "react";
import * as m from "motion/react-m";
import type { HTMLMotionProps } from "motion/react";
import { spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger-outline"
  | "danger"
  | "success-outline"
  | "on-verdict"
  | "on-verdict-ghost";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg" | "xl";
  /** For on-verdict variants: light text on dark verdicts, dark text on amber. */
  tone?: "light" | "dark";
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

const sizes = {
  sm: "h-10 px-4 text-body-sm gap-1.5",
  md: "h-12 px-5 text-body gap-2",
  lg: "h-14 px-6 text-body gap-2.5",
  xl: "h-16 px-6 text-h3 gap-3",
};

function variantClass(v: ButtonVariant, tone: "light" | "dark") {
  switch (v) {
    case "primary":
      return "bg-brand text-on-brand font-semibold shadow-[0_12px_28px_-14px_var(--brand)] dark:shadow-none active:bg-brand-strong";
    case "secondary":
      return "bg-surface text-ink font-medium shadow-[inset_0_0_0_1px_var(--line)] active:bg-surface-2";
    case "ghost":
      return "bg-transparent text-brand-ink font-medium active:bg-brand-soft";
    case "danger-outline":
      return "bg-transparent text-chip-no font-medium shadow-[inset_0_0_0_1.5px_currentColor] active:bg-[color-mix(in_oklab,var(--no)_10%,transparent)]";
    case "danger":
      return "bg-[var(--no)] text-white font-bold shadow-[0_14px_32px_-12px_rgba(229,70,58,0.75)]";
    case "success-outline":
      return "bg-white/[0.04] text-white font-semibold shadow-[inset_0_0_0_2px_#3fd48a]";
    case "on-verdict":
      return tone === "dark"
        ? "bg-[#1F1300] text-white font-semibold"
        : "bg-white text-[#0F1430] font-semibold shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)]";
    case "on-verdict-ghost":
      return tone === "dark"
        ? "bg-transparent text-[#1F1300] font-semibold shadow-[inset_0_0_0_1.5px_rgba(31,19,0,0.45)] active:bg-black/5"
        : "bg-white/[0.06] text-white font-semibold shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.45)] active:bg-white/10";
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "lg",
    tone = "light",
    icon,
    iconRight,
    full,
    loading,
    disabled,
    className,
    children,
    onPointerDown,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const highlight = variant === "primary" || variant === "danger" || variant === "on-verdict";
  return (
    <m.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={spring.ui}
      onPointerDown={(e) => {
        if (!isDisabled && (variant === "primary" || variant === "danger")) haptic("press");
        onPointerDown?.(e);
      }}
      className={cn(
        "group relative inline-flex select-none items-center justify-center overflow-hidden rounded-full font-body leading-none whitespace-nowrap",
        "transition-[background-color,box-shadow,color,opacity] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
        sizes[size],
        variantClass(variant, tone),
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {highlight && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0)_55%)] transition-transform duration-100 group-active:translate-y-[2px]"
        />
      )}
      {loading ? (
        <span
          aria-hidden
          className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
        />
      ) : (
        icon && <span className="relative inline-flex shrink-0">{icon}</span>
      )}
      {children !== undefined && (
        <span className="relative min-w-0 overflow-hidden text-ellipsis whitespace-normal text-center leading-tight">
          {children}
        </span>
      )}
      {iconRight && <span className="relative inline-flex shrink-0">{iconRight}</span>}
    </m.button>
  );
});

/** A tappable surface (cards, rows): press scale 0.985 (spec B6.3). */
export const Pressable = forwardRef<HTMLButtonElement, HTMLMotionProps<"button">>(function Pressable(
  { className, type = "button", disabled, ...rest },
  ref,
) {
  return (
    <m.button
      ref={ref}
      type={type}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={spring.ui}
      className={cn("block w-full text-left", className)}
      {...rest}
    />
  );
});
