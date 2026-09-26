// Sheet (spec B6.2, B12.0): rises from y: 100% with spring.soft over a backdrop that fades to
// rgba(10,14,31,.45) + blur(8px). Drag down to dismiss (velocity-aware) unless `dismissible`
// is false — sheets that must not be dismissed accidentally close only with their buttons.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { dur, spring } from "@/design/motion";
import { useReduced } from "@/app/session";
import { portalTarget } from "@/design/origin";
import { cn } from "@/lib/cn";

interface SheetProps {
  open: boolean;
  onClose?: () => void;
  dismissible?: boolean;
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  className?: string;
  /** Visual tone of the sheet surface. */
  tone?: "surface" | "ink";
}

export function Sheet({ open, onClose, dismissible = true, children, labelledBy, label, className, tone = "surface" }: SheetProps) {
  const reduced = useReduced();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose?.();
      if (e.key === "Tab" && panelRef.current) {
        // Keep focus inside the sheet.
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]" key="sheet">
          <m.div
            aria-hidden
            className="absolute inset-0"
            style={{ background: "var(--scrim)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? dur.reduced : dur.base }}
            onClick={dismissible ? onClose : undefined}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto max-w-[480px]">
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              aria-label={labelledBy ? undefined : label}
              tabIndex={-1}
              className={cn(
                "pointer-events-auto relative max-h-[calc(var(--app-h)*0.88)] overflow-y-auto rounded-t-[24px] px-5 pt-3 outline-none",
                tone === "ink" ? "bg-[#121834] text-[#EEF0FF]" : "bg-surface text-ink",
                "shadow-[0_-18px_48px_rgba(10,14,31,0.22)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
                className,
              )}
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
              initial={reduced ? { opacity: 0 } : { y: "100%" }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: "100%" }}
              transition={reduced ? { duration: dur.reduced } : spring.soft}
              drag={dismissible && !reduced ? "y" : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.7 }}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.y > 110 || info.velocity.y > 650) onClose?.();
              }}
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[color-mix(in_oklab,currentColor_22%,transparent)]" aria-hidden />
              {children}
            </m.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    portalTarget(),
  );
}
