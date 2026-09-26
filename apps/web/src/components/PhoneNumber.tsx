// PhoneNumber (spec B8, B9 #8, B12.0): the number as selectable text, a call button (tel:)
// and a copy button. Calls to action for phoning someone always show the number.
import { Copy, Phone } from "@phosphor-icons/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { telHref } from "@/lib/format";
import { toast } from "@/app/ui";
import { spring } from "@/design/motion";
import { cn } from "@/lib/cn";

interface PhoneNumberProps {
  number: string;
  /** e.g. "Call Arjun" */
  label: string;
  /** "surface" on normal screens; "light"/"dark" on verdict colours. */
  tone?: "surface" | "light" | "dark";
  className?: string;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function PhoneNumber({ number, label, tone = "surface", className }: PhoneNumberProps) {
  const { t } = useTranslation();
  const onVerdict = tone !== "surface";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[18px] py-2.5 pl-4 pr-2.5",
        tone === "surface" && "bg-surface-2",
        tone === "light" && "bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
        tone === "dark" && "bg-black/[0.08] text-[#1F1300] shadow-[inset_0_0_0_1px_rgba(31,19,0,0.18)]",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-caption", onVerdict ? "opacity-80" : "text-muted")}>{label}</div>
        {/* The number itself never truncates (B9 #8): it wraps before it would be cut. */}
        <div className="select-text break-words font-mono text-[0.9375rem] font-semibold leading-snug tabular-nums tracking-[-0.02em]">
          {number}
        </div>
      </div>
      <m.button
        type="button"
        whileTap={{ scale: 0.92 }}
        transition={spring.ui}
        aria-label={t("common.copyNumber")}
        onClick={async () => {
          if (await copyText(number)) toast(t("common.numberCopied"), { tone: "success" });
        }}
        className={cn(
          "grid h-12 w-11 shrink-0 place-items-center rounded-full",
          onVerdict ? "active:bg-white/10" : "text-ink-2 active:bg-surface",
        )}
      >
        <Copy size={21} aria-hidden />
      </m.button>
      <m.a
        href={telHref(number)}
        whileTap={{ scale: 0.95 }}
        transition={spring.ui}
        aria-label={t("common.callNumber", { number })}
        className={cn(
          "inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-semibold",
          tone === "surface" && "bg-brand text-on-brand",
          tone === "light" && "bg-white text-[#0F1430]",
          tone === "dark" && "bg-[#1F1300] text-white",
        )}
      >
        <Phone size={20} weight="fill" aria-hidden />
        {t("common.call")}
      </m.a>
    </div>
  );
}
