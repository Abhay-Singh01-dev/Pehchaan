// EmptyState (spec B12.0): illustration + one line + one action.
import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { riseIn } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

export function EmptyState({
  illustration,
  text,
  action,
  className,
}: {
  illustration: ReactNode;
  text: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const reduced = useReduced();
  return (
    <m.div
      className={cn("card flex flex-col items-center px-6 py-8 text-center", className)}
      {...riseIn(0, reduced)}
    >
      <div className="mb-4 text-brand">{illustration}</div>
      <p className="max-w-[28ch] text-body text-ink-2">{text}</p>
      {action && <div className="mt-5 w-full">{action}</div>}
    </m.div>
  );
}
