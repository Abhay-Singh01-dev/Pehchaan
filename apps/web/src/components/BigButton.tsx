// BigButton (spec B12.0, B6.4 #6): the 120px Verify button on Home.
// Neel with a subtle inner gradient, a faint guilloché rosette, and an idle "breath" every 3.2 s
// (scale 1 → 1.012, inner glow +10%). On press it records the tap point, which becomes the
// origin of the next screen's circular reveal.
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { CaretRight } from "@phosphor-icons/react";
import { spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { useReduced } from "@/app/session";
import { Guilloche } from "./Guilloche";
import { cn } from "@/lib/cn";

interface BigButtonProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function BigButton({ icon, label, hint, onClick, disabled, className }: BigButtonProps) {
  const reduced = useReduced();
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && haptic("press")}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={spring.ui}
      className={cn(
        "group relative block min-h-[120px] w-full select-none text-left text-on-brand",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <span
        className="relative flex min-h-[120px] items-center gap-4 overflow-hidden rounded-[28px] px-5 py-5 shadow-[0_22px_44px_-22px_var(--brand)] dark:shadow-none"
        style={{
          background: "linear-gradient(150deg, var(--brand) 0%, var(--brand-strong) 115%)",
          animation: reduced || disabled ? undefined : "breathe 3.2s cubic-bezier(0.65,0,0.35,1) infinite",
        }}
      >
        {/* Inner glow that rises with each breath */}
        <span
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-16 h-56 w-56 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.28), rgba(255,255,255,0) 65%)",
            animation: reduced || disabled ? undefined : "glow-breathe 3.2s cubic-bezier(0.65,0,0.35,1) infinite",
          }}
        />
        <Guilloche
          size={300}
          color="var(--on-brand)"
          opacity={0.13}
          className="pointer-events-none absolute -right-24 -top-24"
        />
        {/* Brass hairline along the top edge: one of the few premium brass details. */}
        <span
          aria-hidden
          className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brass),transparent)] opacity-70"
        />
        <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--on-brand)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--on-brand)_22%,transparent)]">
          {icon}
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-display text-h2 font-semibold">{label}</span>
          {hint && <span className="mt-1 block text-body-sm opacity-85">{hint}</span>}
        </span>
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--on-brand)_12%,transparent)] transition-transform duration-200 group-hover:translate-x-0.5">
          <CaretRight size={20} weight="bold" />
        </span>
      </span>
    </m.button>
  );
}
