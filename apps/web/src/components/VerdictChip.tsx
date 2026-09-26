// Small verdict / decision chips (spec B5.2): the base colour at 14% for the background and a
// chip text colour tuned for AA in each theme.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Decision, Verdict } from "@/services/types";
import { verdictTone } from "@/lib/labels";
import { cn } from "@/lib/cn";

const toneStyle = {
  ok: { bg: "var(--ok)", fg: "var(--chip-ok)" },
  no: { bg: "var(--no)", fg: "var(--chip-no)" },
  fake: { bg: "var(--fake)", fg: "var(--chip-fake)" },
  amber: { bg: "var(--amber)", fg: "var(--chip-amber)" },
  wait: { bg: "var(--wait)", fg: "var(--chip-wait)" },
  neutral: { bg: "var(--ink)", fg: "var(--ink-2)" },
};

export function Chip({
  tone,
  children,
  className,
  size = "md",
}: {
  tone: keyof typeof toneStyle;
  children: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  const s = toneStyle[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold whitespace-nowrap",
        size === "lg" ? "h-9 px-3.5 text-body" : "h-7 px-2.5 text-caption",
        className,
      )}
      style={{ background: `color-mix(in oklab, ${s.bg} 14%, transparent)`, color: s.fg }}
    >
      {children}
    </span>
  );
}

export function VerdictChip({ verdict, className, size }: { verdict: Verdict; className?: string; size?: "md" | "lg" }) {
  const { t } = useTranslation();
  return (
    <Chip tone={verdictTone(verdict)} className={className} size={size}>
      {t(`history.verdict.${verdict}`)}
    </Chip>
  );
}

export function DecisionChip({ decision, className }: { decision: Decision; className?: string }) {
  const { t } = useTranslation();
  return (
    <Chip tone={decision === "ME" ? "wait" : "no"} className={className}>
      {t(`history.decision.${decision}`)}
    </Chip>
  );
}
