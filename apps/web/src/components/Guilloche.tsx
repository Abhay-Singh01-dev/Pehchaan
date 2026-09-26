// A guilloché rosette: the fine interlaced line-work printed on banknotes and stamp paper to
// make them hard to forge. It is the natural background for a "brass seal on an official
// document" brand: used very faintly on the Verify button, the splash and the QR frame.
import { memo, useMemo } from "react";

interface GuillocheProps {
  size?: number;
  color?: string;
  opacity?: number;
  /** Number of interlaced curves. */
  layers?: number;
  className?: string;
  /** Petals of the rosette. */
  petals?: number;
}

// Hypotrochoid: x = (R - r)cos t + d cos((R - r)/r · t), y = (R - r)sin t − d sin((R - r)/r · t)
function rosettePath(R: number, r: number, d: number, phase: number, steps: number) {
  const k = (R - r) / r;
  const turns = r / gcd(R, r);
  const total = Math.PI * 2 * turns;
  let out = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const x = 50 + (R - r) * Math.cos(t + phase) + d * Math.cos(k * t + phase);
    const y = 50 + (R - r) * Math.sin(t + phase) - d * Math.sin(k * t + phase);
    out += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
  }
  return out + "Z";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const cache = new Map<string, string[]>();

function paths(petals: number, layers: number) {
  const key = `${petals}:${layers}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const R = 40;
  const r = R / petals;
  const out: string[] = [];
  for (let l = 0; l < layers; l++) {
    out.push(rosettePath(R, r, 11 + l * 1.6, (l * Math.PI) / (petals * layers), 900));
  }
  cache.set(key, out);
  return out;
}

export const Guilloche = memo(function Guilloche({
  size = 240,
  color = "currentColor",
  opacity = 0.12,
  layers = 3,
  petals = 20,
  className,
}: GuillocheProps) {
  const ds = useMemo(() => paths(petals, layers), [petals, layers]);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
      style={{ opacity }}
    >
      {ds.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      ))}
      <circle cx="50" cy="50" r="48.5" fill="none" stroke={color} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
      <circle cx="50" cy="50" r="47" fill="none" stroke={color} strokeWidth={0.3} strokeDasharray="0.6 0.8" />
    </svg>
  );
});
