// Onboarding card 1 (spec B6.4 #2): a live audio waveform — 12 bars animating at different
// phases. When `morph` turns on, the bars collapse into the seal's dashed ring, the brass ring
// draws around them and "प" appears: voices can be copied, the seal can't.
import * as m from "motion/react-m";
import { PA_GLYPH_PATH } from "@/design/glyphs";
import { ease } from "@/design/motion";
import { useReduced } from "@/app/session";

const BARS = 12;
const HEIGHTS = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.45, 0.85, 0.6, 0.95, 0.5, 0.3];

export function WaveformSeal({ morph, size = 200 }: { morph: boolean; size?: number }) {
  const reduced = useReduced();
  const t = reduced ? { duration: 0.12 } : { duration: 0.7, ease: ease.inOut };

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden focusable="false" style={{ overflow: "visible" }}>
      {/* Soft halo */}
      <circle cx="100" cy="100" r="84" fill="var(--brand-soft)" opacity={0.55} />

      {Array.from({ length: BARS }, (_, i) => {
        const x = 34 + i * 12;
        const h = 18 + HEIGHTS[i]! * 70;
        // Target on the ring: evenly spaced, tangent to the circle.
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const r = 62;
        const tx = 100 + Math.cos(a) * r;
        const ty = 100 + Math.sin(a) * r;
        const rot = (a * 180) / Math.PI + 90 + 90;
        return (
          <m.g
            key={i}
            initial={false}
            animate={morph ? { x: tx, y: ty, rotate: rot } : { x, y: 100, rotate: 0 }}
            transition={{ ...t, delay: morph && !reduced ? i * 0.025 : 0 }}
          >
            <m.rect
              x={-3}
              width={6}
              rx={3}
              fill="var(--brand)"
              initial={false}
              animate={
                morph
                  ? { height: 12, y: -6, opacity: 1 }
                  : reduced
                    ? { height: h, y: -h / 2 }
                    : {
                        height: [h * 0.35, h, h * 0.55, h * 0.9, h * 0.35],
                        y: [-h * 0.175, -h / 2, -h * 0.275, -h * 0.45, -h * 0.175],
                      }
              }
              transition={
                morph || reduced
                  ? t
                  : { duration: 1.3 + (i % 4) * 0.18, repeat: Infinity, ease: "easeInOut", delay: (i * 0.11) % 0.9 }
              }
            />
          </m.g>
        );
      })}

      {/* Brass ring draws once the bars have become the dashed ring. */}
      <m.circle
        cx="100"
        cy="100"
        r="76"
        fill="none"
        stroke="var(--brass)"
        strokeWidth={3}
        style={{ rotate: -90, transformOrigin: "100px 100px" }}
        initial={false}
        animate={{ pathLength: morph ? 1 : 0, opacity: morph ? 1 : 0 }}
        transition={{ ...t, delay: morph && !reduced ? 0.35 : 0 }}
      />
      <g transform="translate(40 40) scale(1.2)">
        <m.path
          d={PA_GLYPH_PATH}
          fill="var(--brand)"
          initial={false}
          animate={{ opacity: morph ? 1 : 0, scale: morph ? 1 : 0.8 }}
          style={{ transformOrigin: "50px 50px" }}
          transition={{ duration: reduced ? 0.12 : 0.4, delay: morph && !reduced ? 0.6 : 0, ease: ease.out }}
        />
      </g>
    </svg>
  );
}
