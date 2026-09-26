// SimulationBadge (spec B12.0): a fixed top-left chip "Simulated network" shown on every
// screen whenever SIMULATION is true. Never show judges a build with this badge.
import { Flask } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { flags } from "@/app/flags";

export function SimulationBadge() {
  const { t } = useTranslation();
  if (!flags.SIMULATION) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] mx-auto max-w-[480px]">
      <span
        className="absolute left-5 inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-2 px-2 text-caption font-medium text-muted shadow-[inset_0_0_0_1px_var(--line)]"
        style={{ top: "calc(env(safe-area-inset-top) + 3px)" }}
      >
        <Flask size={12} weight="bold" aria-hidden />
        {t("sim.badge")}
      </span>
    </div>
  );
}

/** Screens push their content down by this much while the badge is shown. */
export const SIM_OFFSET = flags.SIMULATION ? 26 : 0;
