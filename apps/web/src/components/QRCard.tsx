// QRCard (spec B12.0, B6.4 #4): QR code + name + brass hairline frame.
//   - modules appear from the centre outward in a quick ripple (400 ms): the code is drawn
//     as 10 concentric ring layers, so only 10 elements animate (cheap on low-end phones)
//   - a brass hairline frame draws around the code
//   - every 6 s a single light sweep glides across the code to show it's live
import { useMemo, type ReactNode } from "react";
import * as m from "motion/react-m";
import QRCode from "qrcode";
import { ease } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

const RINGS = 10;

function useQrRings(text: string) {
  return useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const c = (size - 1) / 2;
    const maxD = Math.hypot(c, c);
    const rings: string[] = Array.from({ length: RINGS }, () => "");
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!data[y * size + x]) continue;
        const d = Math.hypot(x - c, y - c) / maxD;
        const r = Math.min(RINGS - 1, Math.floor(d * RINGS));
        rings[r] += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size, rings };
  }, [text]);
}

export function QRImage({
  text,
  size = 248,
  label,
  animate = true,
  className,
  sweep = true,
}: {
  text: string;
  size?: number;
  label: string;
  animate?: boolean;
  className?: string;
  sweep?: boolean;
}) {
  const reduced = useReduced();
  const { size: n, rings } = useQrRings(text);
  const quiet = 3;
  const play = animate && !reduced;

  return (
    <div
      className={cn("relative overflow-hidden rounded-[14px] bg-white", className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
        width={size}
        height={size}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
      >
        {rings.map((d, i) =>
          d ? (
            <m.path
              key={i}
              d={d}
              fill="#0A0E1F"
              style={{ transformOrigin: `${(n - 1) / 2}px ${(n - 1) / 2}px` }}
              initial={play ? { opacity: 0, scale: 0.94 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, delay: (i / RINGS) * 0.4, ease: ease.out }}
            />
          ) : null,
        )}
      </svg>
      {sweep && !reduced && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          <span
            className="absolute inset-y-[-20%] left-0 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(58,69,214,0.14), rgba(255,255,255,0.5), rgba(58,69,214,0.14), transparent)",
              animation: "qr-sweep 6s cubic-bezier(0.65,0,0.35,1) 1.2s infinite",
            }}
          />
        </span>
      )}
    </div>
  );
}

export function QRCard({
  text,
  label,
  size = 248,
  children,
  className,
}: {
  text: string;
  label: string;
  size?: number;
  children?: ReactNode;
  className?: string;
}) {
  const reduced = useReduced();
  const pad = 18;
  const outer = size + pad * 2;
  return (
    <div className={cn("card relative mx-auto flex flex-col items-center px-5 pb-5 pt-6", className)}>
      <div className="relative" style={{ width: outer, height: outer }}>
        {/* Brass hairline frame, drawn around the code. */}
        <svg className="absolute inset-0" width={outer} height={outer} aria-hidden>
          <m.rect
            x={1}
            y={1}
            width={outer - 2}
            height={outer - 2}
            rx={20}
            fill="none"
            stroke="var(--brass)"
            strokeWidth={1.25}
            initial={reduced ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.25, ease: ease.inOut }}
          />
          {[
            [1, 1],
            [outer - 1, 1],
            [1, outer - 1],
            [outer - 1, outer - 1],
          ].map(([x, y], i) => (
            <m.circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill="var(--brass)"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
            />
          ))}
        </svg>
        <div className="absolute" style={{ left: pad, top: pad }}>
          <QRImage text={text} size={size} label={label} />
        </div>
      </div>
      {children}
    </div>
  );
}
