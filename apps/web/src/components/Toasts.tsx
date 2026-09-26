// Toasts (spec B6.2): drop in from the top with spring.soft, auto-dismiss after 3.5 s with a
// fade, and can be swiped up to dismiss.
import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { dismissToast, useUi, type ToastItem } from "@/app/ui";
import { dur, spring } from "@/design/motion";
import { useReduced } from "@/app/session";
import { SIM_OFFSET } from "./SimulationBadge";

function ToastView({ item }: { item: ToastItem }) {
  const reduced = useReduced();
  useEffect(() => {
    if (!item.duration) return;
    const id = window.setTimeout(() => dismissToast(item.id), item.duration);
    return () => window.clearTimeout(id);
  }, [item]);

  const Icon = item.tone === "success" ? CheckCircle : item.tone === "error" ? WarningCircle : Info;
  return (
    <m.div
      layout={!reduced}
      role="status"
      className="pointer-events-auto flex min-h-14 items-center gap-3 rounded-[18px] bg-[#0F1430] py-2.5 pl-4 pr-2.5 text-[#EEF0FF] shadow-[0_18px_40px_rgba(10,14,31,0.35)] dark:bg-[#EEF0FF] dark:text-[#0F1430]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: dur.base } }}
      transition={reduced ? { duration: dur.reduced } : spring.soft}
      drag={reduced ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.8, bottom: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -24 || info.velocity.y < -400) dismissToast(item.id);
      }}
    >
      <Icon size={22} weight="duotone" aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 text-body-sm font-medium">{item.text}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            dismissToast(item.id);
          }}
          className="h-10 shrink-0 rounded-full bg-white/12 px-4 text-body-sm font-semibold dark:bg-black/8"
        >
          {item.action.label}
        </button>
      )}
    </m.div>
  );
}

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] mx-auto flex max-w-[480px] flex-col gap-2 px-4"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 10}px)` }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {[...toasts].reverse().map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
