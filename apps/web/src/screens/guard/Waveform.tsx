// A live waveform on canvas (~30 fps), fed by GuardService.onLevel. Mirrored rounded bars that
// scroll left, in the brand colour.
import { useEffect, useRef } from "react";

export function WaveformCanvas({ subscribe, active }: { subscribe: (cb: (level: number) => void) => () => void; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>(Array.from({ length: 64 }, () => 0.04));

  useEffect(() => subscribe((l) => {
    levels.current.push(l);
    if (levels.current.length > 64) levels.current.shift();
  }), [subscribe]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33) return;
      last = t;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const styles = getComputedStyle(canvas);
      const brand = styles.getPropertyValue("--brand").trim() || "#3A45D6";
      const brass = styles.getPropertyValue("--brass").trim() || "#B8904A";
      const n = levels.current.length;
      const gap = 3;
      const bw = Math.max(2, (w - gap * (n - 1)) / n);
      for (let i = 0; i < n; i++) {
        const lv = levels.current[i]!;
        const bh = Math.max(3, lv * (h - 12));
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.globalAlpha = 0.25 + (i / n) * 0.75;
        ctx.fillStyle = i === n - 1 && active ? brass : brand;
        const r = Math.min(bw / 2, 4);
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return <canvas ref={ref} className="h-28 w-full" aria-hidden />;
}
