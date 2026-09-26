// A0 · Splash (spec B12 A0, B6.4 #1). At most 1.1 s:
//   the brass ring draws clockwise (500 ms) → the dashed ring fades in turning 20° →
//   "प" scales 0.8 → 1 → the wordmark fades up. The seal then hands over (shared layoutId)
//   to the next screen's seal. Reduced motion: the seal fades in for 200 ms.
import { useEffect } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { Seal } from "@/components/Seal";
import { Guilloche } from "@/components/Guilloche";
import { decideStart } from "@/app/startRoute";
import { useReduced } from "@/app/session";
import { ease } from "@/design/motion";

export function Splash() {
  const navigate = useNavigate();
  const reduced = useReduced();

  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    void decideStart().then((dest) => {
      const wait = Math.max(0, (reduced ? 350 : 1100) - (performance.now() - t0));
      window.setTimeout(() => alive && navigate(dest, { replace: true }), wait);
    });
    return () => {
      alive = false;
    };
  }, [navigate, reduced]);

  return (
    <main className="relative grid min-h-app place-items-center overflow-hidden" aria-label="Pehchaan">
      <m.div
        aria-hidden
        className="pointer-events-none absolute text-brand"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.1, ease: ease.out }}
      >
        <Guilloche size={420} opacity={0.08} petals={24} />
      </m.div>
      <div className="relative flex flex-col items-center">
        <m.div
          layoutId="brand-seal"
          initial={reduced ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <Seal size={120} intro={!reduced} title="Pehchaan" />
        </m.div>
        <m.div
          className="mt-6 text-center"
          initial={{ opacity: 0, y: reduced ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.2 : 0.4, delay: reduced ? 0 : 0.62, ease: ease.out }}
        >
          <div className="font-display text-display font-semibold tracking-[-0.01em] text-ink" lang="en">
            Pehchaan
          </div>
          <div className="font-display text-h3 font-semibold text-brass-ink" lang="hi">
            पहचान
          </div>
        </m.div>
      </div>
    </main>
  );
}
