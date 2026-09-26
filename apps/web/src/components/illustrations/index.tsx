// In-app SVG illustrations (spec B5.5). Colours: --brand, --brass and --ink-2 only
// (verdict colours appear only where an illustration explains a verdict: the split seal).
import { useEffect, type ReactNode } from "react";
import * as m from "motion/react-m";
import { animate, useMotionValue, useTransform } from "motion/react";
import { PA_GLYPH_PATH } from "@/design/glyphs";
import { ease, spring } from "@/design/motion";
import { useReduced } from "@/app/session";

// ─── A dot travelling along a quadratic arc (A3 card 2, D3, I2) ─────────────

export function ArcTraveler({
  from,
  to,
  lift,
  duration = 1.1,
  color = "var(--brand)",
  loop = true,
  reverse = false,
  onArrive,
  radius = 5,
  glow = true,
}: {
  from: [number, number];
  to: [number, number];
  lift: number;
  duration?: number;
  color?: string;
  loop?: boolean;
  reverse?: boolean;
  onArrive?: () => void;
  radius?: number;
  glow?: boolean;
}) {
  const reduced = useReduced();
  const t = useMotionValue(reverse ? 1 : 0);
  const ctrl: [number, number] = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - lift];
  const at = (p: number, i: 0 | 1) => (1 - p) * (1 - p) * from[i] + 2 * (1 - p) * p * ctrl[i] + p * p * to[i];
  const cx = useTransform(t, (p) => at(p, 0));
  const cy = useTransform(t, (p) => at(p, 1));

  useEffect(() => {
    if (reduced) {
      t.set(reverse ? 0 : 1);
      return;
    }
    const controls = animate(t, reverse ? 0 : 1, {
      duration,
      ease: ease.inOut,
      repeat: loop ? Infinity : 0,
      repeatDelay: loop ? 0.25 : 0,
      onRepeat: onArrive,
      onComplete: onArrive,
    });
    return () => controls.stop();
  }, [t, duration, loop, reverse, reduced, onArrive]);

  return (
    <g>
      {glow && <m.circle cx={cx} cy={cy} r={radius * 2.6} fill={color} opacity={0.18} />}
      <m.circle cx={cx} cy={cy} r={radius} fill={color} />
    </g>
  );
}

export function arcPath(from: [number, number], to: [number, number], lift: number) {
  const c: [number, number] = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - lift];
  return `M${from[0]} ${from[1]} Q${c[0]} ${c[1]} ${to[0]} ${to[1]}`;
}

function Phone({ x, y, children }: { x: number; y: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={46} height={82} rx={10} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
      <rect x={17} y={5} width={12} height={3} rx={1.5} fill="var(--ink-2)" opacity={0.4} />
      {children}
    </g>
  );
}

/** A3 card 2: two phones with an arc and a dot travelling between them. */
export function TwoPhones({ size = 220 }: { size?: number }) {
  const from: [number, number] = [45, 74];
  const to: [number, number] = [155, 74];
  return (
    <svg
      viewBox="0 0 200 160"
      width={size}
      height={(size * 160) / 200}
      aria-hidden
      focusable="false"
      style={{ overflow: "visible" }}
    >
      <path
        d={arcPath(from, to, 58)}
        fill="none"
        stroke="var(--brass)"
        strokeWidth={2}
        strokeDasharray="2 6"
        strokeLinecap="round"
      />
      <Phone x={22} y={68}>
        {/* A caller's waveform */}
        {[0.4, 0.8, 1, 0.6, 0.9, 0.5].map((h, i) => (
          <rect
            key={i}
            x={9 + i * 5}
            y={41 - h * 12}
            width={3}
            height={h * 24}
            rx={1.5}
            fill="var(--ink-2)"
            opacity={0.55}
          />
        ))}
      </Phone>
      <Phone x={132} y={68}>
        <circle cx={23} cy={41} r={14} fill="none" stroke="var(--brass)" strokeWidth={1.6} />
        <g transform="translate(13 31) scale(0.2)">
          <path d={PA_GLYPH_PATH} fill="var(--brand)" />
        </g>
      </Phone>
      <ArcTraveler from={from} to={to} lift={58} duration={1.3} />
    </svg>
  );
}

/** A3 card 3: a split seal — green check on one side, red ✕ on the other. */
export function SplitSeal({ size = 200 }: { size?: number }) {
  const reduced = useReduced();
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden focusable="false" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="split-ok" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#12A35C" />
          <stop offset="1" stopColor="#065C34" />
        </linearGradient>
        <linearGradient id="split-no" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#E5463A" />
          <stop offset="1" stopColor="#8E1B12" />
        </linearGradient>
      </defs>
      <m.g initial={reduced ? false : { x: 8 }} animate={{ x: -6 }} transition={{ ...spring.soft, delay: 0.1 }}>
        <path d="M100 22 A78 78 0 0 0 100 178 Z" fill="url(#split-ok)" />
        <path d="M100 22 A78 78 0 0 0 100 178" fill="none" stroke="var(--brass)" strokeWidth={3} />
        <m.path
          d="M52 102 L66 116 L88 90"
          fill="none"
          stroke="#fff"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.35, ease: ease.out }}
        />
      </m.g>
      <m.g initial={reduced ? false : { x: -8 }} animate={{ x: 6 }} transition={{ ...spring.soft, delay: 0.1 }}>
        <path d="M100 22 A78 78 0 0 1 100 178 Z" fill="url(#split-no)" />
        <path d="M100 22 A78 78 0 0 1 100 178" fill="none" stroke="var(--brass)" strokeWidth={3} />
        <m.path
          d="M116 86 L144 114 M144 86 L116 114"
          fill="none"
          stroke="#fff"
          strokeWidth={9}
          strokeLinecap="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.5, ease: ease.out }}
        />
      </m.g>
    </svg>
  );
}

/** A6: a key sliding into a vault ring; the ring locks with a 30° click (spec B6.4 #3). */
export function KeyVault({ phase, size = 180 }: { phase: "idle" | "waiting" | "locked"; size?: number }) {
  const reduced = useReduced();
  const keyIn = phase !== "idle";
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden focusable="false" style={{ overflow: "visible" }}>
      <circle cx="100" cy="100" r="86" fill="var(--brand-soft)" opacity={0.6} />
      {/* Vault ring: rotates slowly while waiting, locks with a 30° click on success. */}
      <m.g
        style={{ transformOrigin: "100px 100px" }}
        animate={
          phase === "locked" ? { rotate: 30 } : phase === "waiting" && !reduced ? { rotate: [0, 360] } : { rotate: 0 }
        }
        transition={
          phase === "locked"
            ? spring.stamp
            : phase === "waiting" && !reduced
              ? { duration: 9, repeat: Infinity, ease: "linear" }
              : { duration: 0.3 }
        }
      >
        <circle cx="100" cy="100" r="62" fill="none" stroke="var(--brand)" strokeWidth={10} opacity={0.9} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <rect
              key={i}
              x={-3}
              y={-8}
              width={6}
              height={16}
              rx={3}
              fill="var(--surface)"
              transform={`translate(${100 + Math.cos(a) * 62} ${100 + Math.sin(a) * 62}) rotate(${(a * 180) / Math.PI + 90})`}
            />
          );
        })}
        <circle cx="100" cy="100" r="74" fill="none" stroke="var(--brass)" strokeWidth={2.5} />
      </m.g>
      {/* The key */}
      <m.g
        initial={false}
        animate={{ x: keyIn ? 0 : -58, opacity: phase === "locked" ? 0 : 1 }}
        transition={phase === "locked" ? { duration: 0.25, delay: 0.2 } : { ...spring.soft }}
      >
        <circle cx="82" cy="100" r="15" fill="none" stroke="var(--ink-2)" strokeWidth={7} />
        <path
          d="M96 100 H128 M116 100 V112 M126 100 V110"
          stroke="var(--ink-2)"
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
      </m.g>
      {/* Success check */}
      <m.path
        d="M78 101 L94 117 L124 85"
        fill="none"
        stroke="var(--brand)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: phase === "locked" ? 1 : 0, opacity: phase === "locked" ? 1 : 0 }}
        transition={{ duration: 0.3, delay: phase === "locked" ? 0.35 : 0, ease: ease.out }}
      />
    </svg>
  );
}

/** A1: a phone with the seal dropping into its home-screen grid, floating ±3px. */
export function PhoneHome({ size = 180 }: { size?: number }) {
  const reduced = useReduced();
  return (
    <div style={{ animation: reduced ? undefined : "float-y 4s ease-in-out infinite" }}>
      <svg
        viewBox="0 0 160 220"
        width={size}
        height={(size * 220) / 160}
        aria-hidden
        focusable="false"
        style={{ overflow: "visible" }}
      >
        <rect
          x="20"
          y="8"
          width="120"
          height="204"
          rx="24"
          fill="var(--surface)"
          stroke="var(--ink-2)"
          strokeWidth={2.5}
        />
        <rect x="64" y="17" width="32" height="6" rx="3" fill="var(--ink-2)" opacity={0.35} />
        {Array.from({ length: 12 }, (_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          if (i === 4) return null;
          return (
            <rect
              key={i}
              x={36 + col * 32}
              y={42 + row * 36}
              width="24"
              height="24"
              rx="7"
              fill="var(--ink-2)"
              opacity={0.14}
            />
          );
        })}
        {/* The Pehchaan icon drops into its slot once. */}
        <m.g
          initial={reduced ? false : { y: -70, opacity: 0, scale: 1.3 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ ...spring.stamp, delay: 0.5 }}
          style={{ transformOrigin: "80px 90px" }}
        >
          <rect x="66" y="76" width="28" height="28" rx="8" fill="#0A0E1F" />
          <circle cx="80" cy="90" r="10" fill="none" stroke="#D9B874" strokeWidth={1.4} />
          <g transform="translate(73 83) scale(0.14)">
            <path d={PA_GLYPH_PATH} fill="#B3B9FF" />
          </g>
        </m.g>
      </svg>
    </div>
  );
}

/** Empty family: three soft avatar discs and a dashed "+". */
export function FamilyIllustration({ size = 132 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 100" width={size} height={(size * 100) / 160} aria-hidden focusable="false">
      <circle cx="44" cy="54" r="24" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth={2} />
      <circle cx="80" cy="46" r="28" fill="var(--surface)" stroke="var(--brass)" strokeWidth={2} />
      <circle cx="116" cy="54" r="24" fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="4 5" />
      <path d="M116 45 V63 M107 54 H125" stroke="var(--ink-2)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx="80" cy="40" r="8" fill="var(--brand)" opacity={0.85} />
      <path
        d="M66 62 C68 54 92 54 94 62"
        stroke="var(--brand)"
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
      />
    </svg>
  );
}

/** A shield (alerts empty state, official callers). */
export function ShieldIllustration({ size = 96 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden focusable="false">
      <path
        d="M50 10 L82 22 V48 C82 70 68 84 50 91 C32 84 18 70 18 48 V22 Z"
        fill="var(--brand-soft)"
        stroke="var(--brand)"
        strokeWidth={3}
      />
      <path
        d="M50 18 L75 27.5 V48 C75 65 64 76.5 50 82.5"
        fill="none"
        stroke="var(--brass)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M38 50 L47 59 L64 41"
        fill="none"
        stroke="var(--brand)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A8: a bell with a brass clapper, swinging gently. */
export function BellIllustration({ size = 150 }: { size?: number }) {
  const reduced = useReduced();
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden focusable="false">
      <circle cx="60" cy="60" r="54" fill="var(--brand-soft)" opacity={0.6} />
      <m.g
        style={{ transformOrigin: "60px 24px" }}
        animate={reduced ? undefined : { rotate: [0, 12, -10, 6, -3, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
      >
        <path
          d="M60 24 C44 24 36 36 36 52 V66 L28 78 H92 L84 66 V52 C84 36 76 24 60 24 Z"
          fill="var(--surface)"
          stroke="var(--brand)"
          strokeWidth={4}
          strokeLinejoin="round"
        />
        <circle cx="60" cy="86" r="7" fill="var(--brass)" />
      </m.g>
      <circle cx="60" cy="20" r="4" fill="var(--brand)" />
    </svg>
  );
}
