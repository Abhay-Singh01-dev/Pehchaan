// Grouped lists (Settings, member details): rounded cards with hairline dividers.
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { CaretRight } from "@phosphor-icons/react";
import { spring } from "@/design/motion";
import { cn } from "@/lib/cn";

export function ListGroup({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  return (
    <div className={className}>
      {title && (
        <div className="mb-2 px-1 text-caption font-medium uppercase tracking-[0.06em] text-muted">{title}</div>
      )}
      <div className="card divide-y divide-line overflow-hidden">{children}</div>
    </div>
  );
}

interface ListRowProps {
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  className?: string;
  as?: "button" | "div";
}

export function ListRow({ icon, label, sub, value, right, onClick, chevron, danger, className }: ListRowProps) {
  const inner = (
    <>
      {icon && (
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-[12px]",
            danger ? "bg-[color-mix(in_oklab,var(--no)_12%,transparent)] text-chip-no" : "bg-surface-2 text-ink-2",
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-body font-medium", danger ? "text-chip-no" : "text-ink")}>{label}</span>
        {sub && <span className="mt-0.5 block text-body-sm text-muted">{sub}</span>}
      </span>
      {value && <span className="shrink-0 text-body-sm text-muted">{value}</span>}
      {right}
      {chevron && <CaretRight size={18} className="shrink-0 text-muted" aria-hidden />}
    </>
  );
  const cls = cn("flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left", className);
  if (onClick) {
    return (
      <m.button
        type="button"
        onClick={onClick}
        whileTap={{ scale: 0.985 }}
        transition={spring.ui}
        className={cn(cls, "active:bg-surface-2")}
      >
        {inner}
      </m.button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
