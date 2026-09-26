// TopBar (spec B12.0): back button (CaretLeft), a centred title that fades in once the page
// scrolls past its big heading, and an optional right action.
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { motionValue, useTransform } from "motion/react";
import { CaretLeft } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useScreenScroll } from "./ScrollContext";
import { spring } from "@/design/motion";
import { SIM_OFFSET } from "../SimulationBadge";
import { cn } from "@/lib/cn";

interface TopBarProps {
  title?: string;
  /** Where Back goes; defaults to history back (or Home when there is no history). */
  backTo?: string | (() => void);
  hideBack?: boolean;
  right?: ReactNode;
  /** Always show the title (for screens without a big heading). */
  titleAlways?: boolean;
  tone?: "default" | "onDark";
  className?: string;
}

export function TopBar({ title, backTo, hideBack, right, titleAlways, tone = "default", className }: TopBarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const scrollY = useScreenScroll();
  const fallback = useTransformSafe(scrollY);
  const titleOpacity = titleAlways ? 1 : fallback.title;
  const barOpacity = fallback.bar;

  const goBack = () => {
    if (typeof backTo === "function") return backTo();
    if (typeof backTo === "string") return navigate(backTo);
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/home", { replace: true });
  };

  return (
    <header
      className={cn("sticky top-0 z-30", className)}
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET}px)` }}
    >
      {tone === "default" && (
        <m.div aria-hidden className="absolute inset-0 border-b border-line bg-bg" style={{ opacity: barOpacity }} />
      )}
      <div className="relative flex h-14 items-center gap-1 px-2">
        <div className="flex w-14 shrink-0 justify-start">
          {!hideBack && (
            <m.button
              type="button"
              onClick={goBack}
              aria-label={t("a11y.back")}
              whileTap={{ scale: 0.92 }}
              transition={spring.ui}
              className={cn(
                "grid h-12 w-12 place-items-center rounded-full",
                tone === "onDark" ? "text-white active:bg-white/10" : "text-ink active:bg-surface-2",
              )}
            >
              <CaretLeft size={24} weight="bold" />
            </m.button>
          )}
        </div>
        <m.div
          className={cn(
            "min-w-0 flex-1 truncate text-center font-display text-h3 font-semibold",
            tone === "onDark" ? "text-white" : "text-ink",
          )}
          style={{ opacity: titleOpacity }}
          aria-hidden={!titleAlways}
        >
          {title}
        </m.div>
        <div className="flex w-14 shrink-0 justify-end">{right}</div>
      </div>
    </header>
  );
}

const zero = motionValue(0);

function useTransformSafe(scrollY: ReturnType<typeof useScreenScroll>) {
  // Hooks must run unconditionally; when there's no scroll container, stay at the top state.
  const title = useTransform(scrollY ?? zero, [36, 76], [0, 1]);
  const bar = useTransform(scrollY ?? zero, [4, 24], [0, 1]);
  return { title, bar };
}
