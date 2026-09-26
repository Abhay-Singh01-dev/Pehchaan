// Skeletons (spec B6.3): a soft shimmer (a 1.4 s gradient sweep) — only where data takes more
// than 300 ms. Nothing is shown before that, so fast loads never flash a placeholder.
import { useEffect, useState } from "react";
import { SIM_OFFSET } from "./SimulationBadge";

export function useDelayed(ms = 300): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return show;
}

/** A page-shaped placeholder: heading, a large card and a few rows. */
export function PageSkeleton() {
  const show = useDelayed();
  if (!show) return <div className="min-h-app" aria-busy="true" />;
  return (
    <div
      className="min-h-app px-5"
      aria-busy="true"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 72}px)` }}
    >
      <div className="skeleton h-9 w-2/3" />
      <div className="skeleton mt-6 h-[120px] w-full rounded-[28px]" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-12 w-12 rounded-full" />
            <div className="flex-1">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton mt-2 h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
