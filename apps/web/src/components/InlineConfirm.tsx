// InlineConfirm (spec B9 #10, B12.0): an in-page confirmation panel. Never a browser dialog.
// It appears in place of the action that triggered it, so the person never loses context.
import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { WarningCircle } from "@phosphor-icons/react";
import { Button } from "./Button";
import { spring, dur } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

interface InlineConfirmProps {
  open: boolean;
  message: ReactNode;
  detail?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
  /** "verdict": white panel on a verdict colour. */
  tone?: "default" | "verdict" | "amber";
  className?: string;
}

export function InlineConfirm({
  open,
  message,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger,
  busy,
  tone = "default",
  className,
}: InlineConfirmProps) {
  const reduced = useReduced();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          role="alertdialog"
          aria-live="assertive"
          className={cn(
            "rounded-[18px] p-4",
            tone === "default" && "card",
            tone === "verdict" && "bg-white text-[#0F1430] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)]",
            tone === "amber" && "bg-[#1F1300] text-white",
            className,
          )}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
          transition={reduced ? { duration: dur.reduced } : spring.soft}
        >
          <div className="flex gap-3">
            <WarningCircle
              size={24}
              weight="duotone"
              className={cn("mt-0.5 shrink-0", danger && tone === "default" ? "text-chip-no" : "opacity-80")}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-body font-medium">{message}</p>
              {detail && <p className="mt-1 text-body-sm opacity-80">{detail}</p>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              variant={tone === "amber" ? "on-verdict" : "secondary"}
              tone="light"
              size="md"
              onClick={onCancel}
              disabled={busy}
              autoFocus
            >
              {cancelLabel}
            </Button>
            <Button
              variant={danger ? "danger" : tone === "amber" ? "on-verdict" : "primary"}
              size="md"
              onClick={onConfirm}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
